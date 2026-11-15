//! Batched parse and resolution across the native boundary.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use napi::bindgen_prelude::{Buffer, Uint32Array};
use napi::Either;
use napi_derive::napi;

use crate::acquire::{read_all, Answer, Outcome};
use crate::emitted::{Emitted, Listing};
use crate::git::Oid;
use crate::parse_origin::FromBlob;
use crate::read::Kind;
use crate::resolve::{Resolvers, Tsconfig};

#[path = "batch_walk.rs"]
mod walk;

use walk::{read_kept, resolve_all};
pub(crate) use walk::{is_module, walk_beyond, Kept, Walked};

/// What a batch of files said, in columns rather than per-file objects.
#[napi(object)]
pub struct ReadBatch {
    pub counts: Uint32Array,
    pub digests: Vec<String>,
    pub unknown: Vec<String>,
    pub values: Vec<String>,
    /// Each request kind as an index into [`kinds`].
    pub kinds: Buffer,
    /// Complete `Parsed` JSON per file when the caller requested it.
    pub parses: Vec<String>,
    /// One when bytes were parsed, including when JSON was not requested.
    pub parsed: Buffer,
    /// One when the bytes decided the file is not parsed — over the size the
    /// scan opens, or not UTF-8 — rather than a read that failed.
    pub declined: Buffer,
    pub declare_counts: Uint32Array,
    pub declares: Vec<String>,
}

/// A read batch with every request resolved before it crosses N-API.
#[napi(object)]
pub struct ScanBatch {
    pub files: Vec<String>,
    /// A parse-only generation in the existing source-index format.
    pub parse_segment: Buffer,
    pub counts: Uint32Array,
    pub digests: Vec<String>,
    pub unknown: Vec<String>,
    pub values: Vec<String>,
    pub kinds: Buffer,
    pub parses: Vec<String>,
    pub parsed: Buffer,
    pub declined: Buffer,
    pub declare_counts: Uint32Array,
    pub declares: Vec<String>,
    /// Repository-relative target per request, or empty when unresolved.
    pub targets: Vec<String>,
    /// One when the parse came from the cache's parse store rather than from
    /// the bytes: its row in `parses` is empty, and the store holds it whole.
    pub kept: Buffer,
}

pub(crate) struct ScanOptions {
    pub root: String,
    pub files: Vec<String>,
    pub largest_file: Option<u32>,
    pub digests: Option<bool>,
    pub readers: Option<u32>,
    pub tsconfig: Tsconfig,
    pub condition_names: Option<Vec<String>>,
}

pub(crate) struct GraphOptions {
    pub root: String,
    pub seeds: Vec<String>,
    pub largest_file: Option<u32>,
    pub readers: Option<u32>,
    pub tsconfig: Tsconfig,
    pub condition_names: Option<Vec<String>>,
    pub include_parses: bool,
}

/// Read, parse and extract a batch without resolving its requests.
#[napi(catch_unwind)]
#[allow(dead_code, reason = "called through the generated N-API export")]
pub fn read_batch(
    root: String,
    files: Vec<String>,
    largest_file: Option<u32>,
    digests: Option<bool>,
    readers: Option<u32>,
) -> ReadBatch {
    columns(
        read_all(root, files, largest_file, digests, readers, true),
        true,
        &[],
    )
}

/// Read, parse, extract and resolve a frontier on one native side.
///
/// `listed` is what a listing the addon does not hold says about the paths
/// the disk alone declines: the files Git lists under a `build/`. A scan over
/// a tree the addon built passes nothing here, because that tree resolves
/// with the whole listing.
#[napi(catch_unwind)]
#[allow(dead_code, reason = "called through the generated N-API export")]
#[allow(clippy::too_many_arguments, reason = "stable positional N-API contract")]
pub fn scan_batch(
    root: String,
    files: Vec<String>,
    largest_file: Option<u32>,
    digests: Option<bool>,
    readers: Option<u32>,
    tsconfig: Option<Either<String, bool>>,
    condition_names: Option<Vec<String>>,
    listed: Option<Vec<String>>,
) -> ScanBatch {
    let listed: Option<HashMap<String, u32>> = listed.map(|paths| paths.into_iter().zip(0..).collect());
    scan_batch_with_oids(
        ScanOptions {
            root,
            files,
            largest_file,
            digests,
            readers,
            tsconfig: Tsconfig::from_js(tsconfig),
            condition_names,
        },
        None,
        listed.as_ref(),
        None,
        &|_, _| None,
        &FromBlob::default(),
    )
}

pub(crate) fn scan_batch_with_oids(
    options: ScanOptions,
    oids: Option<Vec<Option<Oid>>>,
    known: Option<&HashMap<String, u32>>,
    listing: Option<Arc<Listing>>,
    kept: Kept,
    from_blob: &FromBlob,
) -> ScanBatch {
    let ScanOptions {
        root,
        files,
        largest_file,
        digests,
        readers,
        tsconfig,
        condition_names,
    } = options;
    let root_path = Path::new(&root);
    let resolvers = Resolvers::over(tsconfig, condition_names, Emitted::listed(root_path, listing));
    let (read, answered) = match oids {
        Some(oids) => read_kept(&root, &files, oids, largest_file, digests, readers, kept, from_blob),
        None => (
            read_all(
                root.clone(),
                files.clone(),
                largest_file,
                digests,
                readers,
                true,
            ),
            Vec::new(),
        ),
    };
    let targets = resolve_all(root_path, &files, &read, &resolvers, known);
    let columns = columns(read, true, &answered);
    scan_columns(files, Vec::new(), columns, targets, answered)
}

/// Follow the complete module closure without crossing N-API per frontier.
pub(crate) fn scan_graph_with_tree(
    options: GraphOptions,
    at: &HashMap<String, u32>,
    tree_oids: &[Oid],
    listing: Arc<Listing>,
    kept: Kept,
    from_blob: &FromBlob,
) -> ScanBatch {
    let include_parses = options.include_parses;
    let Walked { files, identities, read, targets, kept: answered } =
        walk_beyond(options, at, tree_oids, listing, &|_| false, kept, from_blob);
    // A kept row's parse is the store's, whole; the one the walk holds is only
    // what records need, so it is not published as a parse.
    let parse_segment = crate::index::parse_segment(&files, &identities, &read, &answered);
    let columns = columns(read, include_parses, &answered);
    scan_columns(files, parse_segment, columns, targets, answered)
}

fn scan_columns(
    files: Vec<String>,
    parse_segment: Vec<u8>,
    columns: ReadBatch,
    targets: Vec<Vec<String>>,
    kept: Vec<bool>,
) -> ScanBatch {
    // One byte per row, whatever read it: a scan no store answered keeps nothing.
    let kept: Vec<u8> = (0..files.len()).map(|row| u8::from(kept.get(row).copied().unwrap_or(false))).collect();
    ScanBatch {
        files,
        parse_segment: parse_segment.into(),
        counts: columns.counts,
        digests: columns.digests,
        unknown: columns.unknown,
        values: columns.values,
        kinds: columns.kinds,
        parses: columns.parses,
        parsed: columns.parsed,
        declined: columns.declined,
        declare_counts: columns.declare_counts,
        declares: columns.declares,
        targets: targets.into_iter().flatten().collect(),
        kept: kept.into(),
    }
}

/// `kept` names the rows whose parse the store holds whole; none past its end.
fn columns(read: Vec<Answer>, include_parses: bool, kept: &[bool]) -> ReadBatch {
    let total = read.iter().map(|(held, _, _)| held.requests.len()).sum();
    let mut counts = Vec::with_capacity(read.len());
    let mut unknown = Vec::with_capacity(read.len());
    let mut held_digests = Vec::with_capacity(read.len());
    let mut values = Vec::with_capacity(total);
    let mut kinds = Vec::with_capacity(total);
    let mut parses = Vec::with_capacity(read.len());
    let mut parsed_flags = Vec::with_capacity(read.len());
    let mut declined = Vec::with_capacity(read.len());
    let mut declare_counts = Vec::with_capacity(read.len());
    let mut declares = Vec::new();

    for (row, (held, digest, outcome)) in read.into_iter().enumerate() {
        parsed_flags.push(u8::from(outcome.parsed()));
        declined.push(u8::from(outcome == Outcome::Declined));
        parses.push(if outcome.parsed() && include_parses && !kept.get(row).copied().unwrap_or(false) {
            serde_json::to_string(&held).unwrap_or_default()
        } else {
            String::new()
        });
        declare_counts.push(held.declares.len() as u32);
        declares.extend(held.declares.iter().cloned());
        counts.push(held.requests.len() as u32);
        unknown.push(held.unknown.unwrap_or_default());
        held_digests.push(digest);
        for request in held.requests {
            values.push(request.value);
            kinds.push(request.kind.code());
        }
    }

    ReadBatch {
        counts: Uint32Array::new(counts),
        digests: held_digests,
        unknown,
        values,
        kinds: kinds.into(),
        parses,
        parsed: parsed_flags.into(),
        declined: declined.into(),
        declare_counts: Uint32Array::new(declare_counts),
        declares,
    }
}

/// Kind names indexed by the codes `ReadBatch.kinds` carries.
#[napi(catch_unwind)]
pub fn kinds() -> Vec<String> {
    Kind::ALL
        .iter()
        .map(|kind| kind.as_str().to_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_kinds_the_way_the_oracle_does() {
        assert_eq!(kinds(), ["imports", "reexports", "dynamic", "type", "depends"]);
    }

    #[test]
    fn a_code_indexes_the_name() {
        for (code, kind) in Kind::ALL.iter().enumerate() {
            assert_eq!(kind.code() as usize, code);
        }
    }
}
