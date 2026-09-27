//! Publishing a chain: `publishAll` in `immutable-log.ts` decides what the
//! next manifest names, and this writes it. It is the only writer of the log.
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
use std::fs;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use serde::Serialize;
use sha2::{Digest, Sha256};

const MAGIC: &[u8] = b"VAIDXLSM";
static TEMPORARY: AtomicU64 = AtomicU64::new(0);

/// A segment a manifest names: `SegmentReference` in `immutable-log.ts`.
#[napi(object)]
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
}

fn scratch(path: &str) -> String {
    let at = TEMPORARY.fetch_add(1, Ordering::Relaxed);
    format!("{path}.{}.{at}.tmp", std::process::id())
}

fn file_name(directory: &str, digest: &str) -> String {
    format!("{directory}/{}.bin", digest.replacen(':', "-", 1))
}

/// Write `segments`, then a manifest at `path` naming `kept` and them, in
/// that order; then remove every one of `replaced` the manifest no longer
/// names. A segment already under its digest is the same bytes, and is
/// written again rather than trusted.
pub fn publish(path: &str, kept: &[LogSegment], segments: &[&[u8]], replaced: &[LogSegment]) -> io::Result<()> {
    let directory = format!("{path}.segments");
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
    })
    .map_err(io::Error::other)?;
    let mut scratch_files = Scratch(Vec::new());
    fs::create_dir_all(&directory)?;
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
    Ok(())
}

/// `publishAll`'s write: `segments` appended after `kept`, and `replaced`
/// removed once nothing names them. What the file system refused, when it
/// did, as the one line a caller can say; the log is then as it was. Anything
/// else that goes wrong here is a defect, and throws.
#[napi(catch_unwind)]
pub fn publish_log(path: String, kept: Vec<LogSegment>, segments: Vec<Buffer>, replaced: Vec<LogSegment>) -> Option<String> {
    let segments: Vec<&[u8]> = segments.iter().map(|bytes| bytes.as_ref()).collect();
    publish(&path, &kept, &segments, &replaced).err().map(|error| format!("{path}: {error}"))
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
