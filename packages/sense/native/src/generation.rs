//! A source-index generation, as bytes: the only encoder of the format.
//!
//! A cold build used to finish by handing every record it had built back to
//! JavaScript, which held them as objects, collected their strings into a set
//! and wrote them out as columns. The records are built on this side now
//! (`record.rs`), so they are encoded on this side too, and what JavaScript
//! contributes — the configuration digest, the tree's directories, and the
//! records and parses of the files the walk did not reach — crosses once, as
//! as documents, rather than the other way round. A warm save's delta and a
//! compaction's whole generation cross the same way
//! (`encode_source_index` in `graph_index.rs`), so the layout has one author.
//!
//! The reader is `decodeSourceIndex` in `source-index-format.ts`, and a warm
//! run compares what it decodes against what it rebuilt: a generation laid
//! out differently is one that never answers a warm run.

// compass: variance-authority.reach.source-index

use rayon::prelude::*;
use serde::Deserialize;

use crate::parse_columns::{ParseColumns, ParseRow};
use crate::record::Indexed;
use crate::segment::{encode, u32s, u8s, Collected, Column, Strings};

/// The directory columns: every path and the digest of what it holds, sorted
/// by path, and every path the generation deletes.
pub fn directory_columns(directories: &[(String, String)], deleted: &[String], strings: &Strings) -> [Column; 3] {
    [
        u32s("directories.path", directories.iter().map(|(path, _)| strings.id(path)).collect()),
        u32s("directories.digest", directories.iter().map(|(_, digest)| strings.id(digest)).collect()),
        u32s("directories.deleted", deleted.iter().map(|path| strings.id(path)).collect()),
    ]
}

/// A parse key's content digest and the way it was read, which `joinedKey` in
/// `source-index-format.ts` joins again. A key read the default way has no
/// second part.
pub fn key_parts(key: &str) -> (&str, &str) {
    key.split_once('\0').unwrap_or((key, ""))
}

/// Every string a record's columns name.
pub fn record_strings<'s>(file: &'s str, held: &'s Indexed, into: &mut Collected<'s>) {
    let record = &held.record;
    into.insert(file);
    into.extend(record.digest.as_deref());
    into.extend(record.unknown.as_deref());
    for edge in record.edges.iter().flatten().chain(record.packages.iter().flatten()) {
        into.insert(&edge.to);
        into.insert(&edge.kind);
    }
    into.extend(record.declares.iter().flatten().map(String::as_str));
    into.extend(record.unresolved.iter().flatten().map(String::as_str));
    into.extend(held.witnesses.iter().map(String::as_str));
    into.extend(held.targets.iter().flatten().flatten().map(String::as_str));
}

/// The record columns, in the encoder's order.
#[derive(Default)]
pub struct RecordColumns {
    file: Vec<u32>,
    digest: Vec<u32>,
    edges: Vec<u32>,
    edges_present: Vec<u8>,
    declares: Vec<u32>,
    declares_present: Vec<u8>,
    packages: Vec<u32>,
    packages_present: Vec<u8>,
    unresolved: Vec<u32>,
    unresolved_present: Vec<u8>,
    unknown: Vec<u32>,
    witnesses: Vec<u32>,
    targets: Vec<u32>,
    targets_present: Vec<u8>,
    witness_directory: Vec<u32>,
    target_path: Vec<u32>,
    edge_to: Vec<u32>,
    edge_kind: Vec<u32>,
    declare_name: Vec<u32>,
    unresolved_value: Vec<u32>,
    package_to: Vec<u32>,
    package_kind: Vec<u32>,
}

impl RecordColumns {
    /// Every record, keyed by file and sorted by the caller.
    pub fn of(records: &[(&str, &Indexed)], strings: &Strings) -> Self {
        let mut columns = Self::default();
        let id = |value: &str| strings.id(value);
        for (file, held) in records {
            let record = &held.record;
            columns.open();
            columns.file.push(id(file));
            columns.witness_directory.extend(held.witnesses.iter().map(|value| id(value)));
            columns.targets_present.push(u8::from(held.targets.is_some()));
            columns
                .target_path
                .extend(held.targets.iter().flatten().map(|target| strings.optional(target.as_deref())));
            columns.digest.push(strings.optional(record.digest.as_deref()));
            columns.edges_present.push(u8::from(record.edges.is_some()));
            for edge in record.edges.iter().flatten() {
                columns.edge_to.push(id(&edge.to));
                columns.edge_kind.push(id(&edge.kind));
            }
            columns.declares_present.push(u8::from(record.declares.is_some()));
            columns.declare_name.extend(record.declares.iter().flatten().map(|name| id(name)));
            columns.packages_present.push(u8::from(record.packages.is_some()));
            for edge in record.packages.iter().flatten() {
                columns.package_to.push(id(&edge.to));
                columns.package_kind.push(id(&edge.kind));
            }
            columns.unresolved_present.push(u8::from(record.unresolved.is_some()));
            columns.unresolved_value.extend(record.unresolved.iter().flatten().map(|value| id(value)));
            columns.unknown.push(strings.optional(record.unknown.as_deref()));
        }
        columns.open();
        columns
    }

    /// Each list's length where the next record starts: the offsets, which
    /// hold one entry more than there are records.
    fn open(&mut self) {
        self.witnesses.push(self.witness_directory.len() as u32);
        self.targets.push(self.target_path.len() as u32);
        self.edges.push(self.edge_to.len() as u32);
        self.declares.push(self.declare_name.len() as u32);
        self.packages.push(self.package_to.len() as u32);
        self.unresolved.push(self.unresolved_value.len() as u32);
    }

    pub fn columns(self, deleted: Vec<u32>) -> Vec<Column> {
        vec![
            u32s("records.file", self.file),
            u32s("records.deleted", deleted),
            u32s("records.digest", self.digest),
            u32s("records.edges", self.edges),
            u8s("records.edges-present", self.edges_present),
            u32s("records.declares", self.declares),
            u8s("records.declares-present", self.declares_present),
            u32s("records.packages", self.packages),
            u8s("records.packages-present", self.packages_present),
            u32s("records.unresolved", self.unresolved),
            u8s("records.unresolved-present", self.unresolved_present),
            u32s("records.unknown", self.unknown),
            u32s("records.witnesses", self.witnesses),
            u32s("records.targets", self.targets),
            u8s("records.targets-present", self.targets_present),
            u32s("witnesses.directory", self.witness_directory),
            u32s("targets.path", self.target_path),
            u32s("edges.to", self.edge_to),
            u32s("edges.kind", self.edge_kind),
            u32s("record-declares.name", self.declare_name),
            u32s("unresolved.value", self.unresolved_value),
            u32s("packages.to", self.package_to),
            u32s("packages.kind", self.package_kind),
        ]
    }
}

/// One generation's parts, each already sorted by its key in code-unit order.
pub struct Generation<'a, P: ParseRow> {
    pub config: Option<&'a str>,
    pub directories: &'a [(String, String)],
    pub parses: &'a [(&'a str, &'a P)],
    pub records: &'a [(&'a str, &'a Indexed)],
    pub deleted: Deleted<'a>,
}

/// The keys a generation hides in the ones before it, each sorted in
/// code-unit order. A generation that starts its chain deletes nothing.
#[derive(Clone, Copy, Default)]
pub struct Deleted<'a> {
    pub parses: &'a [String],
    pub records: &'a [String],
    pub directories: &'a [String],
}

/// The segment bytes, dictionary first: every string any part names, once.
pub fn encode_generation<P: ParseRow>(generation: &Generation<P>) -> Vec<u8> {
    let mut values = Collected::default();
    values.extend(generation.config);
    for (path, digest) in generation.directories {
        values.insert(path);
        values.insert(digest);
    }
    for (key, row) in generation.parses {
        let (digest, way) = key_parts(key);
        values.insert(digest);
        values.insert(way);
        row.strings(&mut values);
    }
    for (file, held) in generation.records {
        record_strings(file, held, &mut values);
    }
    let deleted = generation.deleted;
    for key in deleted.parses {
        let (digest, way) = key_parts(key);
        values.insert(digest);
        values.insert(way);
    }
    values.extend(deleted.records.iter().map(String::as_str));
    values.extend(deleted.directories.iter().map(String::as_str));
    let mut strings = Strings::of(values);
    let mut columns = Vec::from(strings.columns());
    columns.push(u32s("index.config", vec![strings.optional(generation.config)]));
    columns.extend(directory_columns(generation.directories, deleted.directories, &strings));
    columns.extend(ParseColumns::of(generation.parses, &strings).columns([
        u32s("parses.deleted", deleted.parses.iter().map(|key| strings.id(key_parts(key).0)).collect()),
        u32s("parses.deleted-way", deleted.parses.iter().map(|key| strings.id(key_parts(key).1)).collect()),
    ]));
    let deleted_records = deleted.records.iter().map(|file| strings.id(file)).collect();
    columns.extend(RecordColumns::of(generation.records, &strings).columns(deleted_records));
    encode(columns)
}

/// A generation as JavaScript names it — `StoredSourceIndex` in
/// `source-index-format.ts`: what it puts and what it deletes. Beside a cold
/// build's closure it is what JavaScript adds, the parts it owns and the
/// records and parses of the files the walk did not reach; parse keys the
/// walk's own layer already holds are left out by the sender.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Delta {
    #[serde(default)]
    pub config: Option<String>,
    #[serde(default)]
    pub directories: Vec<(String, String)>,
    #[serde(default)]
    pub records: Vec<(String, Indexed)>,
    #[serde(default)]
    pub parses: Vec<(String, crate::held::HeldParse)>,
    #[serde(default)]
    pub deleted_parses: Vec<String>,
    #[serde(default)]
    pub deleted_records: Vec<String>,
    #[serde(default)]
    pub deleted_directories: Vec<String>,
}

impl Delta {
    /// One generation from the documents `sourceIndexDocuments` wrote of it,
    /// in order. Several and not one, because one would be a JavaScript string
    /// the size of the whole index, and V8 refuses a string past half a
    /// gigabyte. Each document is dropped once it is read.
    pub fn of(documents: Vec<String>) -> Result<Self, serde_json::Error> {
        let parts = documents
            .into_par_iter()
            .map(|document| serde_json::from_str::<Delta>(&document))
            .collect::<Result<Vec<_>, _>>()?;
        let mut whole = Delta::default();
        for part in parts {
            whole.config = whole.config.or(part.config);
            whole.directories.extend(part.directories);
            whole.records.extend(part.records);
            whole.parses.extend(part.parses);
            whole.deleted_parses.extend(part.deleted_parses);
            whole.deleted_records.extend(part.deleted_records);
            whole.deleted_directories.extend(part.deleted_directories);
        }
        Ok(whole)
    }
}

#[cfg(all(test, unix))]
#[path = "generation_tests.rs"]
mod tests;
