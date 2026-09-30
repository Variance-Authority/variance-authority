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

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use rayon::prelude::*;

use crate::generation::{encode_generation, Deleted, Generation};
use crate::order::code_unit;
use crate::parse_columns::Span;
use crate::record::Indexed;
use crate::segment::NONE;
use crate::stored::{same_length, Stored, U32s};

/// One generation from the layers of a chain, oldest first. A layer this side
/// cannot read is a defect in whoever handed it over, and throws.
#[napi(catch_unwind)]
pub fn compact_source_index(layers: Vec<Buffer>) -> napi::Result<Buffer> {
    let layers: Vec<&[u8]> = layers.iter().map(|bytes| bytes.as_ref()).collect();
    compacted(&layers)
        .map(Into::into)
        .map_err(|error| napi::Error::from_reason(format!("the source index did not compact: {error}")))
}

pub(crate) fn compacted(layers: &[&[u8]]) -> Result<Vec<u8>, String> {
    folded(layers, false)
}

/// The layers over a base as one layer that still stands over it: a key one of
/// them deleted and none put again stays deleted.
pub(crate) fn merged(layers: &[&[u8]]) -> Result<Vec<u8>, String> {
    folded(layers, true)
}

fn folded(layers: &[&[u8]], over: bool) -> Result<Vec<u8>, String> {
    let layers = layers
        .par_iter()
        .enumerate()
        .map(|(at, bytes)| Layer::open(bytes).map_err(|error| format!("layer {at}: {error}")))
        .collect::<Result<Vec<_>, _>>()?;

    let mut parses: HashMap<String, (usize, usize)> = HashMap::new();
    let mut records: HashMap<&str, (usize, usize)> = HashMap::new();
    let mut directories: HashMap<&str, &str> = HashMap::new();
    let (mut gone_parses, mut gone_records, mut gone_directories) = (HashSet::new(), HashSet::new(), HashSet::new());
    for (at, layer) in layers.iter().enumerate() {
        let (stored, columns) = (&layer.stored, &layer.parses);
        for row in 0..columns.deleted.len() {
            let key = joined(stored.text(columns.deleted.at(row)), stored.text(columns.deleted_way.at(row)));
            parses.remove(&key);
            if over { gone_parses.insert(key); }
        }
        for row in 0..columns.key.len() {
            let key = joined(stored.text(columns.key.at(row)), stored.text(columns.way.at(row)));
            if over { gone_parses.remove(&key); }
            parses.insert(key, (at, row));
        }
        for row in 0..layer.records.deleted.len() {
            let file = stored.text(layer.records.deleted.at(row));
            records.remove(file);
            if over { gone_records.insert(file); }
        }
        for row in 0..layer.records.file.len() {
            let file = stored.text(layer.records.file.at(row));
            if over { gone_records.remove(file); }
            records.insert(file, (at, row));
        }
        for row in 0..layer.directories.deleted.len() {
            let path = stored.text(layer.directories.deleted.at(row));
            directories.remove(path);
            if over { gone_directories.insert(path); }
        }
        for row in 0..layer.directories.path.len() {
            let path = stored.text(layer.directories.path.at(row));
            if over { gone_directories.remove(path); }
            directories.insert(path, stored.text(layer.directories.digest.at(row)));
        }
    }
    let config = layers.last().and_then(|layer| layer.config);

    let mut parses: Vec<(String, ParseView)> = parses
        .into_iter()
        .map(|(key, (at, row))| (key, ParseView { stored: &layers[at].stored, columns: &layers[at].parses, row }))
        .collect();
    parses.par_sort_unstable_by(|left, right| code_unit(&left.0, &right.0));
    let parses: Vec<(&str, &ParseView)> = parses.iter().map(|(key, view)| (key.as_str(), view)).collect();

    let mut records: Vec<(&str, Indexed)> = records
        .into_par_iter()
        .map(|(file, (at, row))| (file, layers[at].records.indexed(&layers[at].stored, row)))
        .collect();
    records.par_sort_unstable_by(|left, right| code_unit(left.0, right.0));
    let records: Vec<(&str, &Indexed)> = records.iter().map(|(file, held)| (*file, held)).collect();

    let mut directories: Vec<(String, String)> =
        directories.into_iter().map(|(path, digest)| (path.to_owned(), digest.to_owned())).collect();
    directories.sort_unstable_by(|left, right| code_unit(&left.0, &right.0));

    let sorted = |gone: Vec<String>| {
        let mut gone = gone;
        gone.sort_unstable_by(|left, right| code_unit(left, right));
        gone
    };
    let gone_parses = sorted(gone_parses.into_iter().collect());
    let gone_records = sorted(gone_records.into_iter().map(str::to_owned).collect());
    let gone_directories = sorted(gone_directories.into_iter().map(str::to_owned).collect());
    Ok(encode_generation(&Generation {
        config,
        directories: &directories,
        parses: &parses,
        records: &records,
        deleted: Deleted { parses: &gone_parses, records: &gone_records, directories: &gone_directories },
    }))
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
use parses::{ParseView, Parses};

#[path = "compact_records.rs"]
mod records;
use records::Records;

#[cfg(all(test, unix))]
#[path = "compact_tests.rs"]
mod tests;
