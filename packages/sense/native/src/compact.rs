//! A chain of source-index generations folded into one, on this side.
//!
//! A chain is the base an index was readied with and at most one working layer
//! over it (`log.rs`). Readying folds the whole chain into one base
//! (`compacted`); an update folds the working layer and its own delta into the
//! next working layer (`merged`), which keeps its deletes because the base
//! beneath it still holds what they delete. A base used to be written from
//! the whole index as JavaScript held it: every parse and record an object,
//! every object printed as JSON, and the JSON parsed here again to be encoded.
//! On a repository of a hundred thousand files that was the largest thing a
//! warm save did, and all of it was the index being carried through a language
//! that had nothing to add to it. The segments are already on this side, in the
//! layout this side wrote, so the compaction reads each layer in place
//! (`stored.rs`) and copies the newest row for every key into one generation.
//!
//! The fold is `orderedMap` in `ordered-map.ts`: oldest layer first, each
//! layer's deletes and then its puts, and the configuration is the last
//! layer's, absent included. The rows are copied as the decoder would read them
//! — an export list the row marks absent is not written, a span is a span only
//! when it has both ends — so a compaction encodes the same bytes an encode of
//! the decoded index would.

// compass: variance-authority.reach.source-index

use std::collections::{HashMap, HashSet};

use rayon::prelude::*;

use crate::generation::{encode_generation, key_parts, Deleted, Generation};
use crate::order::code_unit;
use crate::parse_columns::{ParseRow, Span};
use crate::record::Indexed;
use crate::segment::NONE;
use crate::stored::{same_length, Stored, U32s};

pub(crate) fn compacted(layers: &[&[u8]]) -> Result<Vec<u8>, String> {
    folded(&[], layers, false)
}

/// The layers over `base` as one layer that still stands over it: a key one of
/// them deleted and none put again stays deleted, and a row the base already
/// holds as they put it is not written. An update that read every file again
/// puts every row again, and a working layer that kept them held the base twice
/// over, for every reader, until the index was next readied.
pub(crate) fn merged(base: &[&[u8]], layers: &[&[u8]]) -> Result<Vec<u8>, String> {
    folded(&opened(base, "base segment")?, layers, true)
}

/// Each segment opened in place. A chain reaches this side only after its
/// reader cut it at the first segment it refused — `load` in
/// `source-index-file.ts`, or the opening in `source_update.rs` — so a segment
/// that does not open here is refused with its place.
fn opened<'a>(segments: &[&'a [u8]], what: &str) -> Result<Vec<Layer<'a>>, String> {
    segments
        .par_iter()
        .enumerate()
        .map(|(at, bytes)| Layer::open(bytes).map_err(|error| format!("{what} {at}: {error}")))
        .collect()
}

fn folded(base: &[Layer], layers_bytes: &[&[u8]], over: bool) -> Result<Vec<u8>, String> {
    let layers = opened(layers_bytes, "layer")?;
    let top = fold(&layers, over, None);
    let under = if base.is_empty() { Fold::default() } else { fold(base, false, Some(&top)) };
    let config = layers.last().and_then(|layer| layer.config);

    // A parse is keyed by the bytes it was read from and how they were read, so
    // the base's row under its key is the same parse (`cache.ts`), unless only
    // the new one carries the harvest.
    let held_parse = |key: &str, view: &ParseView| {
        under.parses.get(key).is_some_and(|&(at, row)| {
            !view.harvested() || ParseView { stored: &base[at].stored, columns: &base[at].parses, row }.harvested()
        })
    };
    // A record is answered from more than its file, so it is compared whole,
    // and only when its digest says the file is the one the base read.
    let held_record = |file: &str, indexed: &Indexed| {
        under.records.get(file).is_some_and(|&(at, row)| {
            let records = &base[at].records;
            base[at].stored.optional(records.digest.at(row)) == indexed.record.digest.as_deref()
                && records.indexed(&base[at].stored, row) == *indexed
        })
    };

    let (put_parses, put_records, put_directories) = (top.parses.len(), top.records.len(), top.directories.len());
    let mut parses: Vec<(String, ParseView)> = top
        .parses
        .into_par_iter()
        .map(|(key, (at, row))| (key, ParseView { stored: &layers[at].stored, columns: &layers[at].parses, row }))
        .filter(|(key, view)| !held_parse(key, view))
        .collect();
    parses.par_sort_unstable_by(|left, right| code_unit(&left.0, &right.0));
    let parses: Vec<(&str, &ParseView)> = parses.iter().map(|(key, view)| (key.as_str(), view)).collect();

    let mut records: Vec<(&str, Indexed)> = top
        .records
        .into_par_iter()
        .map(|(file, (at, row))| (file, layers[at].records.indexed(&layers[at].stored, row)))
        .filter(|(file, indexed)| !held_record(file, indexed))
        .collect();
    records.par_sort_unstable_by(|left, right| code_unit(left.0, right.0));
    let records: Vec<(&str, &Indexed)> = records.iter().map(|(file, held)| (*file, held)).collect();

    let mut directories: Vec<(String, String)> = top
        .directories
        .into_iter()
        .filter(|(path, digest)| under.directories.get(path) != Some(digest))
        .map(|(path, digest)| (path.to_owned(), digest.to_owned()))
        .collect();
    directories.sort_unstable_by(|left, right| code_unit(&left.0, &right.0));

    // One layer over a base that drops no row is already the generation this
    // would encode; a compaction drops the deletes it carries, so it encodes.
    if let ([one], true) = (layers_bytes, over) {
        if (parses.len(), records.len(), directories.len()) == (put_parses, put_records, put_directories) {
            return Ok(one.to_vec());
        }
    }

    let sorted = |gone: Vec<String>| {
        let mut gone = gone;
        gone.sort_unstable_by(|left, right| code_unit(left, right));
        gone
    };
    let gone_parses = sorted(top.gone_parses.into_iter().collect());
    let gone_records = sorted(top.gone_records.into_iter().map(str::to_owned).collect());
    let gone_directories = sorted(top.gone_directories.into_iter().map(str::to_owned).collect());
    Ok(encode_generation(&Generation {
        config,
        directories: &directories,
        parses: &parses,
        records: &records,
        deleted: Deleted { parses: &gone_parses, records: &gone_records, directories: &gone_directories },
    }))
}

/// The newest row for every key, as `orderedMap` folds layers: oldest first,
/// each layer's deletes and then its puts. Over a base, a key deleted and not
/// put again is kept as gone, since the base beneath still holds it.
#[derive(Default)]
struct Fold<'b> {
    parses: HashMap<String, (usize, usize)>,
    records: HashMap<&'b str, (usize, usize)>,
    directories: HashMap<&'b str, &'b str>,
    gone_parses: HashSet<String>,
    gone_records: HashSet<&'b str>,
    gone_directories: HashSet<&'b str>,
}

/// `layers` folded, keeping what they delete when `over`. With `only`, a key
/// `only` does not put is passed over, so a base is folded under the keys a
/// merge puts; a parse key is joined only when its digest is one of them.
fn fold<'b>(layers: &'b [Layer<'b>], over: bool, only: Option<&Fold>) -> Fold<'b> {
    let digests: Option<HashSet<&str>> = only.map(|only| only.parses.keys().map(|key| key_parts(key).0).collect());
    let wanted = |digest: &str, way: &str| match (only, &digests) {
        (Some(only), Some(digests)) => digests.contains(digest).then(|| joined(digest, way)).filter(|key| only.parses.contains_key(key)),
        _ => Some(joined(digest, way)),
    };
    let mut fold = Fold::default();
    for (at, layer) in layers.iter().enumerate() {
        let (stored, columns) = (&layer.stored, &layer.parses);
        for row in 0..columns.deleted.len() {
            if let Some(key) = wanted(stored.text(columns.deleted.at(row)), stored.text(columns.deleted_way.at(row))) {
                fold.parses.remove(&key);
                if over { fold.gone_parses.insert(key); }
            }
        }
        for row in 0..columns.key.len() {
            if let Some(key) = wanted(stored.text(columns.key.at(row)), stored.text(columns.way.at(row))) {
                if over { fold.gone_parses.remove(&key); }
                fold.parses.insert(key, (at, row));
            }
        }
        for row in 0..layer.records.deleted.len() {
            let file = stored.text(layer.records.deleted.at(row));
            fold.records.remove(file);
            if over { fold.gone_records.insert(file); }
        }
        for row in 0..layer.records.file.len() {
            let file = stored.text(layer.records.file.at(row));
            if only.is_some_and(|only| !only.records.contains_key(file)) { continue; }
            if over { fold.gone_records.remove(file); }
            fold.records.insert(file, (at, row));
        }
        for row in 0..layer.directories.deleted.len() {
            let path = stored.text(layer.directories.deleted.at(row));
            fold.directories.remove(path);
            if over { fold.gone_directories.insert(path); }
        }
        for row in 0..layer.directories.path.len() {
            let path = stored.text(layer.directories.path.at(row));
            if only.is_some_and(|only| !only.directories.contains_key(path)) { continue; }
            if over { fold.gone_directories.remove(path); }
            fold.directories.insert(path, stored.text(layer.directories.digest.at(row)));
        }
    }
    fold
}

/// `joinedKey` in `source-index-format.ts`: the default way adds nothing.
fn joined(digest: &str, way: &str) -> String {
    if way.is_empty() { digest.to_owned() } else { format!("{digest}\0{way}") }
}

/// One segment's columns, opened in place. The package graph
/// (`package_graph.rs`) reads the same layers for the same chain, so it opens
/// them here rather than keeping a second list of what a segment holds.
pub(crate) struct Layer<'a> {
    pub(crate) stored: Stored<'a>,
    pub(crate) config: Option<&'a str>,
    pub(crate) parses: Parses<'a>,
    pub(crate) records: Records<'a>,
    pub(crate) directories: Directories<'a>,
}

impl<'a> Layer<'a> {
    pub(crate) fn open(bytes: &'a [u8]) -> Result<Self, String> {
        let stored = Stored::open(bytes)?;
        let config = stored.u32s("index.config")?;
        let config = if config.len() == 1 { stored.optional(config.at(0)) } else { return Err("no configuration row".to_owned()) };
        let parses = Parses::open(&stored)?;
        let records = Records::open(&stored)?;
        let directories = Directories::open(&stored)?;
        Ok(Layer { stored, config, parses, records, directories })
    }
}

pub(crate) struct Directories<'a> {
    pub(crate) path: U32s<'a>,
    pub(crate) digest: U32s<'a>,
    pub(crate) deleted: U32s<'a>,
}

impl<'a> Directories<'a> {
    fn open(stored: &Stored<'a>) -> Result<Self, String> {
        let (path, digest) = (stored.u32s("directories.path")?, stored.u32s("directories.digest")?);
        same_length(path.len(), &[("directories.digest", digest.len())])?;
        Ok(Directories { path, digest, deleted: stored.maybe_u32s("directories.deleted")? })
    }
}

/// A flag column's entry; the decoder refuses anything but zero and one.
fn flag(column: &[u8], row: usize) -> bool {
    column[row] == 1
}

/// A span with both ends, or none: `span` in `source-index-harvest.ts`.
fn span(starts: U32s, ends: U32s, row: usize) -> Span {
    let (start, end) = (starts.at(row), ends.at(row));
    (start != NONE || end != NONE).then_some((start, end))
}

#[path = "compact_parses.rs"]
mod parses;
use parses::Parses;

#[path = "compact_parse_view.rs"]
mod parse_view;
use parse_view::ParseView;

#[path = "compact_records.rs"]
mod records;
use records::Records;

#[cfg(all(test, unix))]
#[path = "compact_tests.rs"]
mod tests;
