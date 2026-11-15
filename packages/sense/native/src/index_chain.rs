//! The committed source-index chain, read on this side.
//!
//! `openImmutableLog` in `immutable-log.ts` is the reader the scan uses, and
//! this is the same protocol read again for a question that never goes through
//! JavaScript: the package graph (`package_graph.rs`) folds a chain of a
//! hundred megabytes on a repository the size of Kibana, and handing those
//! bytes over as buffers only for them to come straight back would be a round
//! trip with nothing to add. So the manifest is read here, and each segment is
//! checked against the length the manifest published for it. The digest is not
//! computed again: it names the file, the writer computed it from the bytes it
//! renamed into place, and hashing every byte was most of what one question's
//! open cost.
//!
//! The answers are the log's own. A missing manifest is no chain. A file
//! without the magic is one legacy segment. A malformed manifest is refused,
//! and a segment that is missing or of another length ends the chain there, with
//! `dropped` counting what that cost.

// compass: variance-authority.reach.source-index

use rayon::prelude::*;
use serde::Deserialize;

const MAGIC: &[u8] = b"VAIDXLSM";
const HEADER_BYTES: usize = MAGIC.len() + 4;

#[derive(Deserialize)]
struct Manifest {
    format: String,
    version: u32,
    segments: Vec<Reference>,
    /// How many of the last segments are the working layer (`log.rs`).
    #[serde(default)]
    working: usize,
}

#[derive(Deserialize)]
pub(crate) struct Reference {
    pub(crate) digest: String,
    pub(crate) length: u64,
}

/// The valid prefix of a committed chain, oldest segment first.
pub(crate) struct Chain {
    pub segments: Vec<Vec<u8>>,
    /// Segments the manifest names past the first one that could not be used.
    pub dropped: u32,
    /// Whether the manifest moved under every read: `dropped` then counts
    /// segments writers replaced, and the prefix is an older whole generation,
    /// not damage.
    pub moved: bool,
    /// The manifest as read, when the file is one; a legacy file is its own
    /// single segment.
    manifest: Option<Vec<u8>>,
    /// What the manifest names, whether or not each could be read: a writer
    /// appending to the chain keeps all of it.
    pub references: Vec<Reference>,
    /// How many of the last `references` are the working layer an update
    /// rewrites; the rest is the base the index was readied with.
    pub working: usize,
}

impl Chain {
    /// Segments lost to damage: a manifest that held still while one it named
    /// was missing. A read that lost the race to writers lost none, unless it
    /// kept nothing, which is no answer, late or not.
    pub(crate) fn damaged(&self) -> u32 {
        if self.moved && !self.segments.is_empty() { 0 } else { self.dropped }
    }

    /// The bytes published at the chain's path, read once with the segments
    /// they name, so a digest of them describes exactly this chain.
    pub(crate) fn published(&self) -> &[u8] {
        self.manifest.as_deref().or_else(|| self.segments.first().map(Vec::as_slice)).unwrap_or(&[])
    }
}

/// How many manifests a reader follows while writers keep moving it, before it
/// keeps what it read: `MOVED_ATTEMPTS` in `immutable-log.ts`.
const MOVED_ATTEMPTS: usize = 8;

/// The chain at `path`, or `None` when nothing was ever published there. A
/// segment missing because a writer published past it is read again from the
/// manifest that writer left, so only damage costs segments; a read the
/// manifest moved under on every attempt keeps its prefix as `moved`.
pub(crate) fn read_chain(path: &str) -> Result<Option<Chain>, String> {
    follow(|| read_chain_once(path), || match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("{path}: {error}")),
    })
}

/// `read_chain`'s retry, over a reader of the chain and of the manifest's
/// current bytes.
fn follow(
    mut read: impl FnMut() -> Result<Option<Chain>, String>,
    mut current: impl FnMut() -> Result<Option<Vec<u8>>, String>,
) -> Result<Option<Chain>, String> {
    let mut attempt = 1;
    loop {
        let Some(mut chain) = read()? else { return Ok(None) };
        if chain.dropped == 0 || current()?.as_deref() == chain.manifest.as_deref() {
            return Ok(Some(chain));
        }
        if attempt == MOVED_ATTEMPTS {
            chain.moved = true;
            return Ok(Some(chain));
        }
        attempt += 1;
    }
}

fn read_chain_once(path: &str) -> Result<Option<Chain>, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("{path}: {error}")),
    };
    if !bytes.starts_with(MAGIC) {
        return Ok(Some(Chain { segments: vec![bytes], dropped: 0, moved: false, manifest: None, references: Vec::new(), working: 0 }));
    }
    let (references, working) = manifest(&bytes).ok_or_else(|| format!("{path}: invalid immutable log manifest"))?;
    let directory = format!("{path}.segments");
    let read: Vec<Option<Vec<u8>>> = references
        .par_iter()
        .map(|reference| {
            let name = format!("{directory}/{}.bin", reference.digest.replacen(':', "-", 1));
            let segment = std::fs::read(name).ok()?;
            (segment.len() as u64 == reference.length).then_some(segment)
        })
        .collect();
    let count = read.iter().position(Option::is_none).unwrap_or(read.len());
    let dropped = (references.len() - count) as u32;
    let segments = read.into_iter().take(count).map(Option::unwrap).collect();
    Ok(Some(Chain { segments, dropped, moved: false, manifest: Some(bytes), references, working }))
}

/// `decodeManifest` and `manifestIsValid`: the header's length is the rest of
/// the file, and every reference is a `v1:` digest with a length.
fn manifest(bytes: &[u8]) -> Option<(Vec<Reference>, usize)> {
    let length = u32::from_le_bytes(bytes.get(MAGIC.len()..HEADER_BYTES)?.try_into().ok()?) as usize;
    if length != bytes.len() - HEADER_BYTES {
        return None;
    }
    let parsed: Manifest = serde_json::from_slice(&bytes[HEADER_BYTES..]).ok()?;
    let digests = parsed.segments.iter().all(|reference| {
        let hex = reference.digest.strip_prefix("v1:").unwrap_or("");
        hex.len() == 32 && hex.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    });
    let working = parsed.working.min(parsed.segments.len());
    (parsed.format == "variance-authority-immutable-log" && parsed.version == 1 && digests).then_some((parsed.segments, working))
}

/// The segments the manifest at `path` names, oldest first: their digests are the chain's identity, read
/// without opening a segment, with how many of the last are the working layer. A missing file, a legacy
/// single-segment file and a malformed manifest have none, and a refresh that finds none reads the chain.
pub(crate) fn manifest_references(path: &str) -> Option<(Vec<Reference>, usize)> {
    manifest_references_of(&std::fs::read(path).ok()?)
}

/// `manifest_references` over manifest bytes a caller already read.
pub(crate) fn manifest_references_of(bytes: &[u8]) -> Option<(Vec<Reference>, usize)> {
    if !bytes.starts_with(MAGIC) { return None; }
    manifest(bytes)
}

/// The segments of `chain` past its first `known`, for a reader that already holds the first `known`, each
/// checked against the length it is named with, as [`read_chain_once`] checks them. `None` says one was
/// missing or of another length, so the caller reads it all.
pub(crate) fn read_tail(path: &str, chain: &[Reference], known: usize) -> Option<Vec<Vec<u8>>> {
    let directory = format!("{path}.segments");
    chain.get(known..)?.par_iter().map(|reference| {
        let segment = std::fs::read(format!("{directory}/{}.bin", reference.digest.replacen(':', "-", 1))).ok()?;
        (segment.len() as u64 == reference.length).then_some(segment)
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn chain(manifest: &[u8], dropped: u32) -> Chain {
        Chain { segments: vec![Vec::new()], dropped, moved: false, manifest: Some(manifest.to_vec()), references: Vec::new(), working: 0 }
    }

    #[test]
    fn a_manifest_moving_under_every_read_is_late_not_damaged() {
        let mut generation = 0u8;
        let read = follow(
            || { generation += 1; Ok(Some(chain(&[generation], 1))) },
            || Ok(Some(vec![u8::MAX])),
        ).unwrap().unwrap();
        assert_eq!((read.moved, read.dropped, read.damaged()), (true, 1, 0));
    }

    #[test]
    fn a_missing_segment_under_a_manifest_that_held_still_is_damage() {
        let mut reads = 0;
        let read = follow(|| { reads += 1; Ok(Some(chain(b"m", 1))) }, || Ok(Some(b"m".to_vec()))).unwrap().unwrap();
        assert_eq!((reads, read.moved, read.damaged()), (1, false, 1));
    }

    #[test]
    fn a_read_after_the_manifest_settles_is_whole() {
        let mut reads = 0u32;
        let read = follow(
            || { reads += 1; Ok(Some(chain(b"m", if reads < 3 { 1 } else { 0 }))) },
            || Ok(Some(b"next".to_vec())),
        ).unwrap().unwrap();
        assert_eq!((reads, read.moved, read.damaged()), (3, false, 0));
    }

    #[test]
    fn a_republish_of_the_manifest_a_reader_held_is_late_not_damaged() {
        use crate::log::{written, LogSegment, Over};
        let directory = std::env::temp_dir().join(format!("va-chain-republish-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("index.bin");
        let path = path.to_str().unwrap();
        let named = |bytes: &[u8]| LogSegment {
            digest: crate::digest::of_sha256(Sha256::digest(bytes).as_slice()),
            length: bytes.len() as i64,
        };
        assert!(written(path, Over::Nothing, &[], &[b"a"], &[], 0).unwrap());
        let held = std::fs::read(path).unwrap();
        // Writer B replaces segment a, then writer A publishes a again: the
        // manifest names what the reader held, and a is back where it was.
        assert!(written(path, Over::Published(&held), &[], &[b"b"], &[named(b"a")], 0).unwrap());
        let between = std::fs::read(path).unwrap();
        assert!(written(path, Over::Published(&between), &[], &[b"a"], &[named(b"b")], 0).unwrap());
        // The reader read the held manifest before B, and found a gone.
        let mut first = true;
        let read = follow(
            || if std::mem::take(&mut first) { Ok(Some(Chain { segments: Vec::new(), ..chain(&held, 1) })) } else { read_chain_once(path) },
            || Ok(std::fs::read(path).ok()),
        ).unwrap().unwrap();
        assert_eq!((read.damaged(), read.segments), (0, vec![b"a".to_vec()]));
        std::fs::remove_dir_all(directory).unwrap();
    }

    /// A chain of one index segment written as the writer writes it, in a fresh directory.
    fn published(name: &str) -> (std::path::PathBuf, String, Vec<u8>) {
        let directory = std::env::temp_dir().join(format!("va-chain-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("index.bin").to_str().unwrap().to_owned();
        let segment = crate::graph_index::merged(&[], &crate::generation::Delta::of(vec![
            r#"{"config":"v1:c","directories":[],"records":[],"parses":[]}"#.to_owned(),
        ]).unwrap());
        assert!(crate::log::written(&path, crate::log::Over::Nothing, &[], &[&segment], &[], 0).unwrap());
        (directory, path, segment)
    }

    fn segment_file(path: &str) -> std::path::PathBuf {
        let (references, _) = manifest_references(path).unwrap();
        std::path::PathBuf::from(format!("{path}.segments/{}.bin", references[0].digest.replacen(':', "-", 1)))
    }

    #[test]
    fn a_segment_of_the_published_length_is_read_without_hashing_it() {
        let (directory, path, segment) = published("unhashed");
        let mut changed = segment.clone();
        *changed.last_mut().unwrap() ^= 1;
        std::fs::write(segment_file(&path), &changed).unwrap();
        let (references, _) = manifest_references(&path).unwrap();
        let read = read_chain_once(&path).unwrap().unwrap();
        assert_eq!((read.dropped, read.segments), (0, vec![changed.clone()]));
        assert_eq!(read_tail(&path, &references, 0), Some(vec![changed]));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn a_segment_of_another_length_ends_the_chain() {
        let (directory, path, segment) = published("short");
        std::fs::write(segment_file(&path), &segment[1..]).unwrap();
        let (references, _) = manifest_references(&path).unwrap();
        assert_eq!(read_chain_once(&path).unwrap().unwrap().dropped, 1);
        assert_eq!(read_tail(&path, &references, 0), None);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn a_segment_whose_header_was_damaged_is_refused_not_a_crash() {
        let (directory, path, mut segment) = published("damaged");
        for byte in &mut segment[4..12] {
            *byte = 0xff;
        }
        std::fs::write(segment_file(&path), &segment).unwrap();
        let read = read_chain_once(&path).unwrap().unwrap();
        assert!(crate::compact::Layer::open(&read.segments[0]).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn a_moved_read_that_kept_nothing_is_damage() {
        let mut generation = 0u8;
        let read = follow(
            || { generation += 1; Ok(Some(Chain { segments: Vec::new(), ..chain(&[generation], 2) })) },
            || Ok(Some(vec![u8::MAX])),
        ).unwrap().unwrap();
        assert_eq!((read.moved, read.damaged()), (true, 2));
    }
}
