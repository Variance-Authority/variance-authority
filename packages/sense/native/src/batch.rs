//! Batched parse and resolution across the native boundary.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use napi::bindgen_prelude::{Buffer, Uint32Array};
use napi::Either;
use napi_derive::napi;

use crate::acquire::{read_all, Answer, Outcome, TreeObjects};
use crate::emitted::{Emitted, Listing};
use crate::git::Oid;
use crate::parse_origin::FromBlob;
use crate::read::Kind;
use crate::read_any::{language_of, Language};
use crate::record::{records_json, RecordOptions, Settled};
use crate::resolve::{Resolvers, Tsconfig};
use crate::world::World;

#[path = "batch_walk.rs"]
mod walk;

use walk::{read_kept, resolve_all};
pub(crate) use walk::{neighbours, texting, walk_beyond, Kept, Reached, Walked};

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
    /// One per request the reader guessed at, as [`ScanBatch::guessed`].
    pub guessed: Buffer,
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
    /// Every row's record as a JSON `IndexedRecord[]`, built by `built` in
    /// `record.rs`, when the caller said what records are settled against.
    pub records: Option<String>,
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
/// `listed` is Git's listing, when the caller holds one the addon does not:
/// what decides a tracked `build/`, and what every language that resolves over
/// the tree asks about. Without it those languages ask the disk, walked once
/// per batch that holds one of their files. `records` asks for each row's
/// record, settled against what it names.
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
    records: Option<RecordOptions>,
) -> napi::Result<ScanBatch> {
    let listed: Option<HashMap<String, u32>> = listed.map(|paths| paths.into_iter().zip(0..).collect());
    let over_tree = |file: &String| !matches!(language_of(file), None | Some(Language::Module | Language::Style));
    let walked: Option<HashMap<String, u32>> = (listed.is_none() && files.iter().any(over_tree))
        .then(|| crate::seed::disk_listing(Path::new(&root)).into_iter().zip(0..).collect());
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
        Tree { known: listed.as_ref(), world: listed.as_ref().or(walked.as_ref()), oids: &[] },
        None,
        &|_, _| None,
        &FromBlob::default(),
        &TreeObjects::default(),
        records,
    )
}

/// What a batch knows of the tree: the listing a module lands against, the one
/// the other languages ask about, and Git's name for each listed file's content.
pub(crate) struct Tree<'t> {
    pub known: Option<&'t HashMap<String, u32>>,
    pub world: Option<&'t HashMap<String, u32>>,
    pub oids: &'t [Oid],
}

pub(crate) fn scan_batch_with_oids(
    options: ScanOptions,
    oids: Option<Vec<Option<Oid>>>,
    tree: Tree,
    listing: Option<Arc<Listing>>,
    kept: Kept,
    from_blob: &FromBlob,
    store: &TreeObjects,
    records: Option<RecordOptions>,
) -> napi::Result<ScanBatch> {
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
        Some(oids) => read_kept(&root, store, &files, oids, largest_file, digests, readers, kept, from_blob),
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
    // A language that reads its neighbours takes the batch's own reads for the
    // files in it, and reads the rest as the walk does (`batch_walk.rs`): out
    // of Git when the tree names them, off the disk otherwise.
    let held: HashMap<&str, usize> = files.iter().enumerate().map(|(index, file)| (file.as_str(), index)).collect();
    let reading = |missing: &[String]| {
        let named = missing.iter().map(|file| tree.world.and_then(|at| at.get(file)).and_then(|index| tree.oids.get(*index as usize)).copied()).collect();
        let (fresh, _) = read_kept(&root, store, missing, named, largest_file, Some(false), Some(readers.unwrap_or(6).max(1)), kept, from_blob);
        fresh
    };
    let parsing = |asked: &[&str]| held_first(asked, &held, &read, &reading);
    let texting = texting(&root);
    let world = World::new(tree.world, None).reading(&parsing, &texting);
    let targets = resolve_all(root_path, &files, &read, &resolvers, &world, tree.known);
    // A digest the caller names the file by wins; the read's answers the rest.
    let records = match records {
        Some(asked) => {
            let given = asked.identities.unwrap_or_default();
            let settled = Settled::of(asked.remembering, asked.aliases.as_deref(), asked.builtins, asked.code_extensions, asked.directories)?;
            let identity = |row: usize| given.get(row).filter(|digest| !digest.is_empty()).unwrap_or(&read[row].1).clone();
            Some(records_json(&files, &identity, &read, &targets, &settled.settling()))
        }
        None => None,
    };
    let columns = columns(read, true, &answered);
    Ok(scan_columns(files, Vec::new(), columns, targets, answered, records))
}

/// What each of `asked` says: the batch's own read for a file in it, and
/// `reading`'s, asked once for all the rest, for one that is not — so a file
/// the batch holds is parsed once, however many neighbours read it.
fn held_first(asked: &[&str], held: &HashMap<&str, usize>, read: &[Answer], reading: &dyn Fn(&[String]) -> Vec<Answer>) -> Vec<Option<crate::read::Read>> {
    let missing: Vec<String> = asked.iter().filter(|file| !held.contains_key(**file)).map(|file| (*file).to_owned()).collect();
    let mut fresh = if missing.is_empty() { Vec::new() } else { reading(&missing) }.into_iter();
    asked
        .iter()
        .map(|file| match held.get(*file) {
            Some(index) => read[*index].2.parsed().then(|| read[*index].0.clone()),
            None => fresh.next().and_then(|(read, _, outcome)| outcome.parsed().then_some(read)),
        })
        .collect()
}

/// Follow the complete module closure without crossing N-API per frontier.
pub(crate) fn scan_graph_with_tree(
    options: GraphOptions,
    at: &HashMap<String, u32>,
    tree_oids: &[Oid],
    listing: Arc<Listing>,
    kept: Kept,
    from_blob: &FromBlob,
    store: &TreeObjects,
    records: Option<RecordOptions>,
) -> napi::Result<ScanBatch> {
    let include_parses = options.include_parses;
    let root = options.root.clone();
    let (parsing, texting) = (neighbours(&root, at, tree_oids, options.largest_file, options.readers, kept, from_blob, store), texting(&root));
    let world = World::new(Some(at), None).reading(&parsing, &texting);
    let Walked { files, identities, read, targets, kept: answered } =
        walk_beyond(options, at, tree_oids, listing, &world, &|_| false, kept, from_blob, store);
    // A kept row's parse is the store's, whole; the one the walk holds is only
    // what records need, so it is not published as a parse.
    let parse_segment = crate::index::parse_segment(&files, &identities, &read, &answered);
    let records = match records {
        Some(asked) => {
            let settled = Settled::of(asked.remembering, asked.aliases.as_deref(), asked.builtins, asked.code_extensions, asked.directories)?;
            Some(records_json(&files, &|row| identities[row].clone(), &read, &targets, &settled.settling()))
        }
        None => None,
    };
    let columns = columns(read, include_parses, &answered);
    Ok(scan_columns(files, parse_segment, columns, targets, answered, records))
}

fn scan_columns(
    files: Vec<String>,
    parse_segment: Vec<u8>,
    columns: ReadBatch,
    targets: Vec<Reached>,
    kept: Vec<bool>,
    records: Option<String>,
) -> ScanBatch {
    // One byte per row, whatever read it: a scan no store answered keeps nothing.
    let kept: Vec<u8> = (0..files.len()).map(|row| u8::from(kept.get(row).copied().unwrap_or(false))).collect();
    let first: Vec<String> = targets.into_iter().flat_map(|reached| reached.first).collect();
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
        targets: first,
        records,
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
    let mut guessed = Vec::with_capacity(total);
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
            guessed.push(u8::from(request.guessed));
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
        guessed: guessed.into(),
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
        assert_eq!(kinds(), ["imports", "reexports", "dynamic", "type", "depends", "asset"]);
    }

    #[test]
    fn a_neighbour_the_batch_read_is_not_read_again() {
        // A Rust `super` reads the `mod` lines of the file above; when that
        // file is in the batch, its own read answers.
        let lib = crate::read::Read::default();
        let read: Vec<Answer> = vec![(lib, String::new(), Outcome::Parsed)];
        let held = HashMap::from([("src/lib.rs", 0)]);
        let asked = std::cell::RefCell::new(Vec::new());
        let reading = |missing: &[String]| {
            asked.borrow_mut().extend(missing.iter().cloned());
            missing.iter().map(|_| (crate::read::Read::default(), String::new(), Outcome::Parsed)).collect()
        };
        let answered = held_first(&["src/lib.rs", "src/other.rs"], &held, &read, &reading);
        assert_eq!(answered.iter().filter(|read| read.is_some()).count(), 2);
        assert_eq!(*asked.borrow(), ["src/other.rs"]);
        // Every file held: nothing is read.
        asked.borrow_mut().clear();
        held_first(&["src/lib.rs"], &held, &read, &reading);
        assert!(asked.borrow().is_empty());
    }

    #[test]
    fn a_code_indexes_the_name() {
        for (code, kind) in Kind::ALL.iter().enumerate() {
            assert_eq!(kind.code() as usize, code);
        }
    }
}
