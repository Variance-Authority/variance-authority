//! A cold build's module closure, held on this side as records and a parse
//! layer, and published from here.
//!
//! `scanGraph` walks the same closure and hands every row across as columns,
//! which JavaScript turns into one record object per file, keeps, and hands to
//! its encoder. On a repository of a hundred thousand modules those objects —
//! and the parses behind them — were most of a cold build's memory. The graph
//! here answers the questions the scan still has to ask about the closure
//! (which files it holds, which files it reaches that it does not hold) and
//! keeps the rows. JavaScript names the parts only it owns, the rows it built
//! for the files the walk did not read, and this side writes the generation.
//!
//! Records are still available as records, because a caller that asked for
//! them is owed them: `records` hands the whole closure over as one document.
//! A save never asks for them. Onto an empty chain it publishes from here, and
//! onto a chain that already has generations it hands over what it wrote of
//! the files the walk did not read, and takes back the delta — every record
//! the closure holds among them — encoded here.

// compass: variance-authority.reach.source-index

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use rayon::prelude::*;

use crate::batch::{walk, GraphOptions, Walked};
use crate::emitted::Listing;
use crate::generation::{encode_generation, Deleted, Delta, Generation};
use crate::git::Oid;
use crate::index::{parse_segment, way};
use crate::order::code_unit;
use crate::record::{built, Indexed, Settling};
use crate::witness::AliasTable;

/// What a cold build needs besides the walk: what a record is settled against.
#[napi(object)]
pub struct IndexGraphOptions {
    pub root: String,
    pub seeds: Vec<String>,
    pub largest_file: Option<u32>,
    pub readers: Option<u32>,
    pub tsconfig: Option<String>,
    pub condition_names: Option<Vec<String>>,
    /// Whether records keep the directories that answered them, for reuse.
    pub remembering: bool,
    /// `Aliases.table` as JSON, when a configuration maps specifiers.
    pub aliases: Option<String>,
    /// `builtinModules` that `isBuiltin` accepts: never a package edge.
    pub builtins: Vec<String>,
    /// Extensions whose target keeps its request's kind.
    pub code_extensions: Vec<String>,
    /// Every directory of the tree shape a witness is checked against.
    pub directories: Vec<String>,
}

#[napi]
pub struct IndexGraph {
    /// Sorted by file, by code unit.
    records: Vec<Indexed>,
    at: HashMap<String, u32>,
    parse_segment: Vec<u8>,
    keys: HashSet<String>,
    following: Vec<String>,
}

pub(crate) fn index_graph(
    options: IndexGraphOptions,
    at: &HashMap<String, u32>,
    tree_oids: &[Oid],
    listing: Arc<Listing>,
) -> napi::Result<IndexGraph> {
    let aliases = options
        .aliases
        .as_deref()
        .map(serde_json::from_str::<AliasTable>)
        .transpose()
        .map_err(|error| napi::Error::from_reason(format!("the alias table did not parse: {error}")))?;
    let builtins: HashSet<String> = options.builtins.into_iter().collect();
    let code: HashSet<String> = options.code_extensions.into_iter().collect();
    let directories: HashSet<String> = options.directories.into_iter().collect();
    let Walked { files, identities, read, targets } = walk(
        GraphOptions {
            root: options.root,
            seeds: options.seeds,
            largest_file: options.largest_file,
            readers: options.readers,
            tsconfig: options.tsconfig,
            condition_names: options.condition_names,
            include_parses: false,
        },
        at,
        tree_oids,
        listing,
    );
    let segment = parse_segment(&files, &identities, &read);
    let settling = Settling {
        builtins: &builtins,
        code: &code,
        remembering: options.remembering,
        directories: &directories,
        aliases: aliases.as_ref(),
    };
    let mut records: Vec<Indexed> = (0..files.len())
        .into_par_iter()
        .map(|index| {
            let (held, _, outcome) = &read[index];
            built(&files[index], &identities[index], held, *outcome, &targets[index], &settling)
        })
        .collect();
    let keys = files
        .iter()
        .zip(&identities)
        .zip(&read)
        .filter(|((_, identity), (_, _, outcome))| outcome.parsed() && !identity.is_empty())
        .map(|((file, identity), _)| format!("{identity}\0{}", way(file)))
        .collect();
    drop(read);
    drop(targets);
    records.sort_by(|left, right| code_unit(&left.record.file, &right.record.file));
    let held: HashMap<String, u32> = records
        .iter()
        .enumerate()
        .map(|(index, record)| (record.record.file.clone(), index as u32))
        .collect();
    // From the settled edges, not the raw targets: an edge is what the scan
    // follows, and a request `request_of` declines is resolved but never drawn.
    let mut following: Vec<String> = records
        .iter()
        .flat_map(|held| held.record.edges.iter().flatten())
        .filter(|edge| !held.contains_key(&edge.to))
        .map(|edge| edge.to.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    following.sort_by(|left, right| code_unit(left, right));
    Ok(IndexGraph { records, at: held, parse_segment: segment, keys, following })
}

#[napi]
impl IndexGraph {
    /// How many files the closure holds.
    #[napi(getter, catch_unwind)]
    pub fn size(&self) -> u32 {
        self.records.len() as u32
    }

    /// Whether the closure holds this file.
    #[napi(catch_unwind)]
    pub fn has(&self, file: String) -> bool {
        self.at.contains_key(&file)
    }

    /// Every file an edge reaches that the closure does not hold — what is
    /// left for the other readers — sorted by code unit.
    #[napi(catch_unwind)]
    pub fn following(&self) -> Vec<String> {
        self.following.clone()
    }

    /// Whether the parse layer holds this parse key.
    #[napi(catch_unwind)]
    pub fn has_parse(&self, key: String) -> bool {
        self.keys.contains(&key)
    }

    /// The parse layer, as the generation `scanGraph` publishes beside the records.
    #[napi(catch_unwind)]
    pub fn parse_segment(&self) -> Buffer {
        self.parse_segment.clone().into()
    }

    /// Every record, as a JSON array of `FileRecord`, sorted by file.
    #[napi(catch_unwind)]
    pub fn records(&self) -> napi::Result<String> {
        let records: Vec<_> = self.records.iter().map(|held| &held.record).collect();
        serde_json::to_string(&records).map_err(|error| napi::Error::from_reason(error.to_string()))
    }

    /// Publish the parse layer and the generation after it — the parts
    /// `documents` name, and every record, the closure's and JavaScript's — as
    /// the first two segments of an empty log at `path`. What the file system
    /// refused, when it did: the index is then not written, which costs the
    /// next run a cold build. A document that does not parse is a defect, and
    /// throws.
    #[napi(catch_unwind)]
    pub fn publish(&self, path: String, documents: Vec<String>) -> napi::Result<Option<String>> {
        let generation = merged(&self.records, &delta(documents)?);
        Ok(crate::log::publish(&path, &[], &[&self.parse_segment, &generation], &[])
            .err()
            .map(|error| format!("{path}: {error}")))
    }

    /// The generation `documents` describe with every record the closure
    /// holds in it: a save's delta onto a chain that already has generations.
    /// A document that does not parse is a defect, and throws.
    #[napi(catch_unwind)]
    pub fn encode(&self, documents: Vec<String>) -> napi::Result<Buffer> {
        Ok(merged(&self.records, &delta(documents)?).into())
    }
}

/// `encodeSourceIndex` in `source-index-format.ts`: one generation from the
/// documents JavaScript wrote of it — a warm save's delta, or a compaction's
/// whole. A document that does not parse is a defect, and throws.
#[napi(catch_unwind)]
pub fn encode_source_index(documents: Vec<String>) -> napi::Result<Buffer> {
    Ok(merged(&[], &delta(documents)?).into())
}

fn delta(documents: Vec<String>) -> napi::Result<Delta> {
    Delta::of(documents).map_err(|error| napi::Error::from_reason(format!("the generation did not parse: {error}")))
}

/// The closure's records and JavaScript's, one per file, the closure's where
/// both name one, and what JavaScript deletes, each part sorted by code unit.
///
/// JavaScript deletes what the chain holds and its own records do not, and it
/// does not hold the closure's: a file both deleted and put here is one the
/// closure holds. A layer's deletes apply before its puts, so the delete would
/// change nothing, and it is not written.
pub(crate) fn merged(records: &[Indexed], delta: &Delta) -> Vec<u8> {
    let mut rows: HashMap<&str, &Indexed> = delta.records.iter().map(|(file, held)| (file.as_str(), held)).collect();
    rows.extend(records.iter().map(|held| (held.record.file.as_str(), held)));
    let deleted: Vec<String> =
        delta.deleted_records.iter().filter(|file| !rows.contains_key(file.as_str())).cloned().collect();
    let mut rows: Vec<(&str, &Indexed)> = rows.into_iter().collect();
    rows.sort_by(|left, right| code_unit(left.0, right.0));
    let mut parses: Vec<(&str, &crate::held::HeldParse)> =
        delta.parses.iter().map(|(key, parse)| (key.as_str(), parse)).collect();
    parses.sort_by(|left, right| code_unit(left.0, right.0));
    parses.dedup_by(|left, right| left.0 == right.0);
    let mut directories = delta.directories.clone();
    directories.sort_by(|left, right| code_unit(&left.0, &right.0));
    let sorted = |keys: &[String]| {
        let mut keys = keys.to_vec();
        keys.sort_by(|left, right| code_unit(left, right));
        keys.dedup();
        keys
    };
    let (parses_deleted, records_deleted, directories_deleted) =
        (sorted(&delta.deleted_parses), sorted(&deleted), sorted(&delta.deleted_directories));
    encode_generation(&Generation {
        config: delta.config.as_deref(),
        directories: &directories,
        parses: &parses,
        records: &rows,
        deleted: Deleted {
            parses: &parses_deleted,
            records: &records_deleted,
            directories: &directories_deleted,
        },
    })
}

#[cfg(all(test, unix))]
#[path = "graph_index_tests.rs"]
mod tests;
