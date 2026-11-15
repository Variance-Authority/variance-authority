//! Publishing a chain: `append_index.rs`, `source_update.rs` and
//! `ready_index.rs` decide what the next manifest names, and this writes it.
//! It is the only writer of the log.
//!
//! Writers are serialized by an exclusive lock on `<path>.lock`, held from the
//! check that the chain is still the one the writer read until its manifest is
//! in place. Each decision is made against a chain read without the lock, so
//! the check is what makes it safe: a writer that finds the chain moved writes
//! nothing, and says so, rather than publishing a manifest that drops what the
//! other writer added.
//!
//! The order of the renames is the whole of the protocol: each segment lands
//! under its digest before the manifest that names it, and the manifest lands
//! last, so a reader never opens a manifest naming a segment that is not
//! there. A compaction names none of the segments it replaced, and they are
//! removed only after the manifest that stopped naming them is in place. A
//! cold build's two segments are made on this side, and publishing them from
//! here means the bytes never become a JavaScript buffer at all.
//!
//! The questions published from the chain ride in its manifest: a store under
//! its digest, and the segments it was read over. Every write carries them
//! forward and keeps on disk every file they name, so a question reads the
//! chain as it was published while writers move it on; [`publish_workspace`]
//! replaces them, and drops what only the replaced value named.

// compass: variance-authority.reach.source-index

use std::collections::HashSet;
use std::fs::{self, File};
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::index_chain::{workspace_of, Workspace};

const MAGIC: &[u8] = b"VAIDXLSM";
static TEMPORARY: AtomicU64 = AtomicU64::new(0);

/// A segment a manifest names: `SegmentReference` in `immutable-log.ts`.
#[derive(Clone, Serialize)]
pub struct LogSegment {
    pub digest: String,
    pub length: i64,
}

#[derive(Serialize)]
struct Manifest<'a> {
    format: &'static str,
    version: u8,
    segments: &'a [LogSegment],
    /// How many of the last segments are the working layer: absent when none
    /// is, so a chain with no working layer is written as it always was.
    #[serde(skip_serializing_if = "is_zero")]
    working: usize,
    /// The questions published from the chain, carried by every write.
    #[serde(skip_serializing_if = "Option::is_none")]
    workspace: Option<&'a Workspace>,
    /// One more than the manifest this one replaced, so no two publishes leave
    /// the same bytes: a reader that compares bytes to learn whether the chain
    /// held still is never fooled by a writer republishing what it read, after
    /// another removed a segment it named.
    generation: u64,
}

/// The `generation` a manifest carries, or none: a legacy or malformed file.
#[derive(serde::Deserialize)]
struct Generation {
    #[serde(default)]
    generation: u64,
}

fn generation_of(bytes: &[u8]) -> u64 {
    bytes
        .strip_prefix(MAGIC)
        .and_then(|rest| rest.get(4..))
        .and_then(|json| serde_json::from_slice::<Generation>(json).ok())
        .map_or(0, |manifest| manifest.generation)
}

fn is_zero(count: &usize) -> bool {
    *count == 0
}

fn scratch(path: &str) -> String {
    let at = TEMPORARY.fetch_add(1, Ordering::Relaxed);
    format!("{path}.{}.{at}.tmp", std::process::id())
}

pub(crate) fn file_name(directory: &str, digest: &str) -> String {
    format!("{directory}/{}.bin", digest.replacen(':', "-", 1))
}

/// What a writer expects to find at the chain's path when it publishes.
#[derive(Clone, Copy)]
pub(crate) enum Over<'a> {
    /// Whatever is there: a cold build, which replaces it.
    Anything,
    /// Nothing ever published.
    Nothing,
    /// These bytes, as `Chain::published` read them.
    Published(&'a [u8]),
}

/// Write `segments`, then a manifest at `path` naming `kept` and them, in
/// that order; then remove every one of `replaced` the manifest no longer
/// names. A segment already under its digest is the same bytes, and is
/// written again rather than trusted. A cold build's: whatever was at `path`
/// is replaced.
pub fn publish(path: &str, kept: &[LogSegment], segments: &[&[u8]], replaced: &[LogSegment]) -> io::Result<()> {
    written(path, Over::Anything, kept, segments, replaced, 0).map(drop)
}

/// [`publish`] under the writer lock, when `path` still holds what `over`
/// says, and `working` of the segments named the working layer. `false`, with
/// nothing written, when another writer moved the chain after it was read.
pub(crate) fn written(path: &str, over: Over, kept: &[LogSegment], segments: &[&[u8]], replaced: &[LogSegment], working: usize) -> io::Result<bool> {
    write(path, over, kept, segments, replaced, working, false)
}

/// [`written`] for a fold: one segment holding what the chain read held. The
/// questions published over exactly that chain are then read over the fold,
/// and what they named alone is let go; questions over any other chain keep
/// theirs.
pub(crate) fn folded(path: &str, over: Over, one: &[u8], replaced: &[LogSegment]) -> io::Result<bool> {
    write(path, over, &[], &[one], replaced, 0, true)
}

fn write(path: &str, over: Over, kept: &[LogSegment], segments: &[&[u8]], replaced: &[LogSegment], working: usize, fold: bool) -> io::Result<bool> {
    let directory = format!("{path}.segments");
    fs::create_dir_all(&directory)?;
    let _lock = locked(path)?;
    let now = current(path)?;
    let still = match over {
        Over::Anything => true,
        Over::Nothing => now.is_none(),
        Over::Published(bytes) => now.as_deref() == Some(bytes),
    };
    if !still {
        return Ok(false);
    }
    let added: Vec<LogSegment> = segments
        .iter()
        .map(|bytes| LogSegment {
            digest: crate::digest::of_sha256(Sha256::digest(bytes).as_slice()),
            length: bytes.len() as i64,
        })
        .collect();
    let next: Vec<LogSegment> = kept.iter().chain(&added).cloned().collect();
    let mut workspace = now.as_deref().and_then(workspace_of);
    if let Some(held) = workspace.as_mut().filter(|held| fold && over_chain(held, now.as_deref())) {
        held.over = added.iter().map(|reference| reference.digest.clone()).collect();
    }
    let mut scratch_files = Scratch(Vec::new());
    for (reference, bytes) in added.iter().zip(segments) {
        put(&mut scratch_files, &file_name(&directory, &reference.digest), bytes)?;
    }
    put_manifest(&mut scratch_files, path, &next, working, workspace.as_ref(), now.as_deref())?;
    let named = named(&next, workspace.as_ref());
    for reference in replaced.iter().filter(|reference| !named.contains(reference.digest.as_str())) {
        // Published already: a segment left behind costs disk, never an answer.
        let _ = fs::remove_file(file_name(&directory, &reference.digest));
    }
    Ok(true)
}

/// Publish `store` as the questions read from the chain at `path` over the
/// segments `over`, in the manifest's place beside them: the store under its
/// digest first, then the manifest naming the same segments it named, and
/// then every file only the questions it replaced named is let go. `given`
/// marks a store that holds what no chain says. `false`, with nothing
/// written, when there is no manifest at `path` to carry it, or a segment of
/// `over` is no longer on disk: another writer let it go after it was read.
pub(crate) fn publish_workspace(path: &str, store: &[u8], over: &[String], given: bool) -> io::Result<bool> {
    let directory = format!("{path}.segments");
    let _lock = locked(path)?;
    let Some(now) = current(path)? else { return Ok(false) };
    let Some((references, working)) = crate::index_chain::manifest_references(&now) else { return Ok(false) };
    if over.iter().any(|digest| !Path::new(&file_name(&directory, digest)).exists()) {
        return Ok(false);
    }
    let next: Vec<LogSegment> = references.into_iter().map(|reference| LogSegment { digest: reference.digest, length: reference.length as i64 }).collect();
    let workspace = Workspace {
        digest: crate::digest::of_sha256(Sha256::digest(store).as_slice()),
        length: store.len() as u64,
        over: over.to_vec(),
        given,
    };
    let previous = workspace_of(&now);
    let mut scratch_files = Scratch(Vec::new());
    put(&mut scratch_files, &file_name(&directory, &workspace.digest), store)?;
    put_manifest(&mut scratch_files, path, &next, working, Some(&workspace), Some(&now))?;
    if let Some(previous) = previous {
        let named = named(&next, Some(&workspace));
        for digest in previous.over.iter().chain([&previous.digest]).filter(|digest| !named.contains(digest.as_str())) {
            let _ = fs::remove_file(file_name(&directory, digest));
        }
    }
    Ok(true)
}

/// Whether the questions `held` were read over every segment the manifest
/// `bytes` names, in its order: the chain a fold of it holds the same as.
fn over_chain(held: &Workspace, bytes: Option<&[u8]>) -> bool {
    bytes.and_then(crate::index_chain::manifest_digests_of).is_some_and(|(digests, _)| digests == held.over)
}

/// Every digest a manifest naming `segments` and `workspace` keeps on disk.
fn named<'a>(segments: &'a [LogSegment], workspace: Option<&'a Workspace>) -> HashSet<&'a str> {
    let questions = workspace.into_iter().flat_map(|held| held.over.iter().chain([&held.digest]));
    segments.iter().map(|reference| reference.digest.as_str()).chain(questions.map(String::as_str)).collect()
}

/// The writer lock on the chain at `path`, held until it is dropped.
fn locked(path: &str) -> io::Result<File> {
    if let Some(parent) = Path::new(path).parent().filter(|parent| !parent.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    let lock = File::options().create(true).truncate(false).write(true).open(format!("{path}.lock"))?;
    lock.lock()?;
    Ok(lock)
}

/// The manifest at `path`, or `None` when nothing was ever published there.
fn current(path: &str) -> io::Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// `bytes` under `name`, through a scratch name, so a reader never opens half of it.
fn put(scratch_files: &mut Scratch, name: &str, bytes: &[u8]) -> io::Result<()> {
    let temporary = scratch_files.name(name);
    fs::write(&temporary, bytes)?;
    fs::rename(&temporary, name)
}

/// The manifest naming `segments`, `working` and `workspace` at `path`, one
/// generation past `now`.
fn put_manifest(scratch_files: &mut Scratch, path: &str, segments: &[LogSegment], working: usize, workspace: Option<&Workspace>, now: Option<&[u8]>) -> io::Result<()> {
    let manifest = serde_json::to_vec(&Manifest {
        format: "variance-authority-immutable-log",
        version: 1,
        segments,
        working,
        workspace,
        generation: now.map_or(0, generation_of) + 1,
    })
    .map_err(io::Error::other)?;
    let mut out = Vec::with_capacity(MAGIC.len() + 4 + manifest.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(manifest.len() as u32).to_le_bytes());
    out.extend_from_slice(&manifest);
    put(scratch_files, path, &out)
}

/// Every scratch name handed out, removed when the publish is over whichever
/// way it ends — an error returned, or a panic unwinding to the N-API
/// boundary — so a failed publish leaves only what it renamed into place. A
/// name that was renamed is no longer there and costs one failed `stat`.
struct Scratch(Vec<String>);

impl Scratch {
    fn name(&mut self, path: &str) -> String {
        let temporary = scratch(path);
        self.0.push(temporary.clone());
        temporary
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        for file in &self.0 {
            if Path::new(file).exists() {
                let _ = fs::remove_file(file);
            }
        }
    }
}

#[cfg(all(test, unix))]
#[path = "log_tests.rs"]
mod tests;

#[cfg(all(test, unix))]
#[path = "log_workspace_tests.rs"]
mod workspace_tests;
