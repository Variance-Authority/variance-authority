//! Batched parse and resolution across the native boundary.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use napi::bindgen_prelude::{Buffer, Uint32Array};
use napi_derive::napi;
use rayon::prelude::*;
use rayon::ThreadPoolBuilder;

use crate::acquire::{read_all, read_git};
use crate::emitted::{Emitted, Listing};
use crate::git::{self, Oid};
use crate::read::{Kind, Read};
use crate::resolve::Resolvers;

const RESOLVERS: usize = 6;

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
    pub declare_counts: Uint32Array,
    pub declares: Vec<String>,
    /// Repository-relative target per request, or empty when unresolved.
    pub targets: Vec<String>,
}

pub(crate) struct ScanOptions {
    pub root: String,
    pub files: Vec<String>,
    pub largest_file: Option<u32>,
    pub digests: Option<bool>,
    pub readers: Option<u32>,
    pub tsconfig: Option<String>,
    pub condition_names: Option<Vec<String>>,
}

pub(crate) struct GraphOptions {
    pub root: String,
    pub seeds: Vec<String>,
    pub largest_file: Option<u32>,
    pub readers: Option<u32>,
    pub tsconfig: Option<String>,
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
    tsconfig: Option<String>,
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
            tsconfig,
            condition_names,
        },
        None,
        listed.as_ref(),
        None,
    )
}

pub(crate) fn scan_batch_with_oids(
    options: ScanOptions,
    oids: Option<Vec<Option<Oid>>>,
    known: Option<&HashMap<String, u32>>,
    listing: Option<Arc<Listing>>,
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
    let read = match oids {
        Some(oids) => read_git(
            root.clone(),
            files.clone(),
            oids,
            largest_file,
            digests,
            readers,
            true,
        ),
        None => read_all(
            root.clone(),
            files.clone(),
            largest_file,
            digests,
            readers,
            true,
        ),
    };
    let targets = resolve_all(root_path, &files, &read, &resolvers, known);
    let columns = columns(read, true);
    scan_columns(files, Vec::new(), columns, targets)
}

/// Follow the complete module closure without crossing N-API per frontier.
pub(crate) fn scan_graph_with_tree(
    options: GraphOptions,
    at: &HashMap<String, u32>,
    tree_oids: &[Oid],
    listing: Arc<Listing>,
) -> ScanBatch {
    let include_parses = options.include_parses;
    let Walked { files, identities, read, targets } = walk(options, at, tree_oids, listing);
    let parse_segment = crate::index::parse_segment(&files, &identities, &read);
    let columns = columns(read, include_parses);
    scan_columns(files, parse_segment, columns, targets)
}

/// What a walk of the module closure read: one row per file, in the order the
/// waves reached them, with the digest each row is named by and the target of
/// each request.
pub(crate) struct Walked {
    pub files: Vec<String>,
    /// Git's object name for a file the tree holds, the read digest otherwise.
    pub identities: Vec<String>,
    pub read: Vec<(Read, String, bool)>,
    pub targets: Vec<Vec<String>>,
}

/// The walk itself, shared by the batch that crosses as columns and the graph
/// that stays on this side (`graph_index.rs`), so the two cannot reach
/// different closures.
pub(crate) fn walk(
    options: GraphOptions,
    at: &HashMap<String, u32>,
    tree_oids: &[Oid],
    listing: Arc<Listing>,
) -> Walked {
    walk_beyond(options, at, tree_oids, listing, &|_| false)
}

/// `walk`, not entering a target `held` names: the seeds are read whatever
/// they are, and the files the caller already holds a record for are the
/// boundary of what a warm update has to open (`source_update.rs`).
pub(crate) fn walk_beyond(
    options: GraphOptions,
    at: &HashMap<String, u32>,
    tree_oids: &[Oid],
    listing: Arc<Listing>,
    held: &dyn Fn(&str) -> bool,
) -> Walked {
    let GraphOptions {
        root,
        seeds,
        largest_file,
        readers,
        tsconfig,
        condition_names,
        include_parses: _,
    } = options;
    let root_path = Path::new(&root);
    let resolvers = Resolvers::over(tsconfig, condition_names, Emitted::listed(root_path, Some(listing)));
    let mut files = Vec::new();
    let mut read = Vec::new();
    let mut targets = Vec::new();
    let mut identities = Vec::new();
    let mut queue = Vec::new();
    let mut seen = HashSet::with_capacity(seeds.len() * 2);
    for file in seeds {
        if seen.insert(file.clone()) {
            queue.push(file);
        }
    }
    let mut head = 0;

    while head < queue.len() {
        let wave = queue[head..].to_vec();
        head = queue.len();
        let oids: Vec<Option<Oid>> = wave
            .iter()
            .map(|file| at.get(file).map(|index| tree_oids[*index as usize]))
            .collect();
        let wave_identities = oids
            .iter()
            .map(|oid| oid.as_ref().map(git::spell))
            .collect::<Vec<_>>();
        // The wave's OIDs already name every tracked file's content, so the blobs
        // come out of the pack rather than off the disk. `read_git` falls back to
        // opening the file whenever a blob is missing or unreadable, which is what
        // answers for the dirty and untracked members of the wave.
        let opened = read_git(
            root.clone(),
            wave.clone(),
            oids,
            largest_file,
            Some(true),
            Some(readers.unwrap_or(6).max(1)),
            false,
        );
        let resolved = resolve_all(root_path, &wave, &opened, &resolvers, Some(at));
        for target in resolved.iter().flatten() {
            if is_module(target) && !held(target) && seen.insert(target.clone()) {
                queue.push(target.clone());
            }
        }
        files.extend(wave);
        identities.extend(
            wave_identities
                .into_iter()
                .zip(&opened)
                .map(|(identity, (_, digest, _))| identity.unwrap_or_else(|| digest.clone())),
        );
        read.extend(opened);
        targets.extend(resolved);
    }
    Walked { files, identities, read, targets }
}

fn resolve_all(
    root: &Path,
    files: &[String],
    read: &[(Read, String, bool)],
    resolvers: &Resolvers,
    known: Option<&HashMap<String, u32>>,
) -> Vec<Vec<String>> {
    let resolving = ThreadPoolBuilder::new()
        .num_threads(RESOLVERS.min(files.len().max(1)))
        .build();
    let work = || {
        files
            .par_iter()
            .zip(read.par_iter())
            .map(|(file, (held, _, parsed))| {
                if !parsed {
                    return Vec::new();
                }
                let from = root.join(file);
                held.requests
                    .iter()
                    .map(|request| {
                        resolvers
                            .resolve(root, &from, &request.value, known)
                            .unwrap_or_default()
                    })
                    .collect()
            })
            .collect()
    };
    match resolving {
        Ok(pool) => pool.install(work),
        Err(_) => work(),
    }
}

fn scan_columns(
    files: Vec<String>,
    parse_segment: Vec<u8>,
    columns: ReadBatch,
    targets: Vec<Vec<String>>,
) -> ScanBatch {
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
        declare_counts: columns.declare_counts,
        declares: columns.declares,
        targets: targets.into_iter().flatten().collect(),
    }
}

pub(crate) fn is_module(file: &str) -> bool {
    matches!(
        Path::new(file).extension().and_then(|part| part.to_str()),
        Some("ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs")
    )
}

fn columns(read: Vec<(Read, String, bool)>, include_parses: bool) -> ReadBatch {
    let total = read.iter().map(|(held, _, _)| held.requests.len()).sum();
    let mut counts = Vec::with_capacity(read.len());
    let mut unknown = Vec::with_capacity(read.len());
    let mut held_digests = Vec::with_capacity(read.len());
    let mut values = Vec::with_capacity(total);
    let mut kinds = Vec::with_capacity(total);
    let mut parses = Vec::with_capacity(read.len());
    let mut parsed_flags = Vec::with_capacity(read.len());
    let mut declare_counts = Vec::with_capacity(read.len());
    let mut declares = Vec::new();

    for (held, digest, parsed) in read {
        parsed_flags.push(u8::from(parsed));
        parses.push(if parsed && include_parses {
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
