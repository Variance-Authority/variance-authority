//! The committed source-index chain, read on this side.
//!
//! `openImmutableLog` in `immutable-log.ts` is the reader the scan uses, and
//! this is the same protocol read again for a question that never goes through
//! JavaScript: the package graph (`package_graph.rs`) folds a chain of a
//! hundred megabytes on a repository the size of Kibana, and handing those
//! bytes over as buffers only for them to come straight back would be a round
//! trip with nothing to add. So the manifest is read here, and each segment is
//! checked against the length and digest the manifest published for it, in
//! parallel, because hashing is most of what reading a warm chain costs.
//!
//! The answers are the log's own. A missing manifest is no chain. A file
//! without the magic is one legacy segment. A malformed manifest is refused,
//! and a segment that is missing or fails its digest ends the chain there, with
//! `dropped` counting what that cost.

// compass: variance-authority.reach.source-index

use rayon::prelude::*;
use serde::Deserialize;
use sha2::{Digest, Sha256};

const MAGIC: &[u8] = b"VAIDXLSM";
const HEADER_BYTES: usize = MAGIC.len() + 4;

#[derive(Deserialize)]
struct Manifest {
    format: String,
    version: u32,
    segments: Vec<Reference>,
}

#[derive(Deserialize)]
struct Reference {
    digest: String,
    length: u64,
}

/// The valid prefix of a committed chain, oldest segment first.
pub(crate) struct Chain {
    pub segments: Vec<Vec<u8>>,
    /// Segments the manifest names past the first one that could not be used.
    pub dropped: u32,
}

/// The chain at `path`, or `None` when nothing was ever published there.
pub(crate) fn read_chain(path: &str) -> Result<Option<Chain>, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("{path}: {error}")),
    };
    if !bytes.starts_with(MAGIC) {
        return Ok(Some(Chain { segments: vec![bytes], dropped: 0 }));
    }
    let references = manifest(&bytes).ok_or_else(|| format!("{path}: invalid immutable log manifest"))?;
    let directory = format!("{path}.segments");
    let read: Vec<Option<Vec<u8>>> = references
        .par_iter()
        .map(|reference| {
            let name = format!("{directory}/{}.bin", reference.digest.replacen(':', "-", 1));
            let segment = std::fs::read(name).ok()?;
            let holds = segment.len() as u64 == reference.length
                && crate::digest::of_sha256(Sha256::digest(&segment).as_slice()) == reference.digest;
            holds.then_some(segment)
        })
        .collect();
    let count = read.iter().position(Option::is_none).unwrap_or(read.len());
    let dropped = (references.len() - count) as u32;
    let segments = read.into_iter().take(count).map(Option::unwrap).collect();
    Ok(Some(Chain { segments, dropped }))
}

/// `decodeManifest` and `manifestIsValid`: the header's length is the rest of
/// the file, and every reference is a `v1:` digest with a length.
fn manifest(bytes: &[u8]) -> Option<Vec<Reference>> {
    let length = u32::from_le_bytes(bytes.get(MAGIC.len()..HEADER_BYTES)?.try_into().ok()?) as usize;
    if length != bytes.len() - HEADER_BYTES {
        return None;
    }
    let parsed: Manifest = serde_json::from_slice(&bytes[HEADER_BYTES..]).ok()?;
    let digests = parsed.segments.iter().all(|reference| {
        let hex = reference.digest.strip_prefix("v1:").unwrap_or("");
        hex.len() == 32 && hex.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    });
    (parsed.format == "variance-authority-immutable-log" && parsed.version == 1 && digests).then_some(parsed.segments)
}
