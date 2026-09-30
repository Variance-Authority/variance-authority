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

// compass: variance-authority.reach.source-index

use std::collections::HashSet;
use std::fs::{self, File};
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use sha2::{Digest, Sha256};

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
}

fn is_zero(count: &usize) -> bool {
    *count == 0
}

fn scratch(path: &str) -> String {
    let at = TEMPORARY.fetch_add(1, Ordering::Relaxed);
    format!("{path}.{}.{at}.tmp", std::process::id())
}

fn file_name(directory: &str, digest: &str) -> String {
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
    let directory = format!("{path}.segments");
    fs::create_dir_all(&directory)?;
    let lock = File::options().create(true).truncate(false).write(true).open(format!("{path}.lock"))?;
    lock.lock()?;
    let now = match fs::read(path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
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
    let manifest = serde_json::to_vec(&Manifest {
        format: "variance-authority-immutable-log",
        version: 1,
        segments: &next,
        working,
    })
    .map_err(io::Error::other)?;
    let mut scratch_files = Scratch(Vec::new());
    for (reference, bytes) in added.iter().zip(segments) {
        let name = file_name(&directory, &reference.digest);
        let temporary = scratch_files.name(&name);
        fs::write(&temporary, bytes)?;
        fs::rename(&temporary, &name)?;
    }
    let temporary = scratch_files.name(path);
    let mut out = Vec::with_capacity(MAGIC.len() + 4 + manifest.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(manifest.len() as u32).to_le_bytes());
    out.extend_from_slice(&manifest);
    fs::write(&temporary, out)?;
    fs::rename(&temporary, path)?;
    let named: HashSet<&str> = next.iter().map(|reference| reference.digest.as_str()).collect();
    for reference in replaced.iter().filter(|reference| !named.contains(reference.digest.as_str())) {
        // Published already: a segment left behind costs disk, never an answer.
        let _ = fs::remove_file(file_name(&directory, &reference.digest));
    }
    Ok(true)
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
