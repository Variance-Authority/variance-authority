//! A save's layers written onto the source-index chain, and a worktree's chain
//! started from the primary checkout's: every decision about what the next
//! manifest names is made here, and `log.rs` writes it.
//!
//! A chain is the base the index was readied with and at most one working
//! layer over it. A save onto a chain rewrites the working layer — the one it
//! read, folded with what the save adds (`merged`) — and never the base, the
//! same as a native update (`source_update.rs`). Folding the working layer into
//! the base is readying (`ready_index.rs`), and happens before work, never
//! during it. A save onto nothing publishes its layers as the base.

// compass: variance-authority.reach.source-index

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::compact::merged;
use crate::index_chain::{read_chain, Chain};
use crate::log::{written, LogSegment, Over};

/// Write `layers` over the chain at `path` as a save read it: the first
/// `read.len()` segments the manifest names, which must still be the ones it
/// names, or the legacy single-segment file when `legacy`. A segment past what
/// was read is replaced, since the save's layers are against the prefix. What
/// the file system refused, or why the chain could not take the layers, as the
/// one line a caller can say; `None` when they are written.
#[napi(catch_unwind)]
pub fn append_source_index(path: String, read: Vec<String>, legacy: bool, layers: Vec<Buffer>) -> Option<String> {
    let layers: Vec<&[u8]> = layers.iter().map(|bytes| bytes.as_ref()).collect();
    appended(&path, &read, legacy, &layers).err().map(|error| format!("{path}: {error}"))
}

fn appended(path: &str, read: &[String], legacy: bool, layers: &[&[u8]]) -> Result<(), String> {
    let chain = read_chain(path)?;
    let references: Vec<LogSegment> = chain.as_ref().map(named).unwrap_or_default();
    let kept = read.len();
    if references.len() < kept || references[..kept].iter().zip(read).any(|(reference, digest)| reference.digest != *digest) {
        return Err(MOVED.to_owned());
    }
    let published = chain.as_ref().map(|chain| chain.published().to_vec());
    let over = published.as_deref().map_or(Over::Nothing, Over::Published);
    let fail = |error: std::io::Error| error.to_string();
    let moved = |written: bool| if written { Ok(()) } else { Err(MOVED.to_owned()) };
    // A legacy file is its own one segment, written as the base it always was.
    if let Some(Chain { segments, .. }) = chain.as_ref().filter(|chain| legacy && chain.references.is_empty()) {
        let layer = working(&[], layers)?;
        return written(path, over, &[], &[&segments[0], &layer], &[], 1).map_err(fail).and_then(moved);
    }
    let Some(chain) = chain.filter(|_| kept > 0) else {
        // Nothing read to build on: the layers are the base.
        return written(path, over, &[], layers, &references, 0).map_err(fail).and_then(moved);
    };
    if chain.segments.len() < kept {
        return Err("a segment the save read is no longer there".to_owned());
    }
    let base = (references.len() - chain.working).min(kept);
    let under: Vec<&[u8]> = chain.segments[base..kept].iter().map(Vec::as_slice).collect();
    let layer = working(&under, layers)?;
    written(path, over, &references[..base], &[&layer], &references[base..], 1).map_err(fail).and_then(moved)
}

const MOVED: &str = "the chain moved after it was read, so these layers are not against it";

/// The working layer `under` was, with `layers` over it, as one layer.
fn working(under: &[&[u8]], layers: &[&[u8]]) -> Result<Vec<u8>, String> {
    let all: Vec<&[u8]> = under.iter().chain(layers).copied().collect();
    match all.as_slice() {
        [one] => Ok(one.to_vec()),
        _ => merged(&all),
    }
}

fn named(chain: &Chain) -> Vec<LogSegment> {
    chain.references.iter()
        .map(|reference| LogSegment { digest: reference.digest.clone(), length: reference.length as i64 })
        .collect()
}

/// Start the chain at `path` from the committed chain at `from`, when `path`
/// has none: a copy, not a reference, because the owner of `from` readies its
/// chain and removes what it folded. Each segment is checked against its digest
/// as it is read, the copy keeps which of them are the working layer, and one
/// manifest commits it, so a reader of `path` sees the whole copy or nothing.
/// Anything that stops the copy leaves `path` as it was and answers `false`.
#[napi(catch_unwind)]
pub fn seed_source_index(path: String, from: String) -> bool {
    if !matches!(read_chain(&path), Ok(None)) {
        return false;
    }
    let Ok(Some(source)) = read_chain(&from) else { return false };
    if source.references.is_empty() || source.segments.is_empty() {
        return false;
    }
    // A prefix cut inside the working layer keeps the part of it that read.
    let base = source.references.len() - source.working;
    let working = source.segments.len().saturating_sub(base);
    let segments: Vec<&[u8]> = source.segments.iter().map(Vec::as_slice).collect();
    matches!(written(&path, Over::Nothing, &[], &segments, &[], working), Ok(true))
}
