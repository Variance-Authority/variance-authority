//! What a question finds an entry by, written beside the entries so a question decodes only the ones that can
//! answer it.
//!
//! An entry's reading is a blob, and its names, docs and purpose stems are inside it. A question asks for one
//! name, for words in names and docs, or for stems a purpose holds, and without these tables it decoded every
//! entry to learn which held them. Each table answers with a superset of the entries that match: the question
//! still decodes those and matches them as it always did, so a table can widen what is decoded, never the answer.

// compass: variance-authority.reach.relations

use std::collections::{BTreeMap, BTreeSet};

use memchr::memmem::Finder;
use rayon::prelude::*;

use crate::segment::{u32s, u8s, Column};
use crate::stored::{Stored, U32s};

use super::codec::read_api;
use super::Api;

/// The text a contains-question is matched against: each name and its doc, lowercased as the question is, each
/// closed by a byte no question writes.
fn text(api: &Api, out: &mut Vec<u8>) {
    for name in api.names.as_deref().unwrap_or(&[]) {
        out.extend_from_slice(name.name.to_lowercase().as_bytes());
        out.push(0);
        out.extend_from_slice(name.doc.as_deref().unwrap_or("").to_lowercase().as_bytes());
        out.push(0);
    }
}

/// Whether a package silent about every name has a README to answer from instead: one beside its manifest that read.
pub(super) fn told_by_readme(api: &Api) -> bool { api.readme.as_ref().is_some_and(|readme| readme.unreadable.is_none()) }

/// Keys in byte order, each with the ascending entries that hold it.
fn keyed(prefix: [&'static str; 4], table: BTreeMap<&str, BTreeSet<u32>>) -> [Column; 4] {
    let (mut blob, mut keys, mut held, mut entries) = (Vec::new(), vec![0u32], vec![0u32], Vec::new());
    for (key, holders) in table {
        blob.extend_from_slice(key.as_bytes());
        keys.push(blob.len() as u32);
        entries.extend(holders);
        held.push(entries.len() as u32);
    }
    [u8s(prefix[0], blob), u32s(prefix[1], keys), u32s(prefix[2], held), u32s(prefix[3], entries)]
}

/// The tables for `blobs`, one per entry row.
pub(super) fn columns(blobs: &[&[u8]]) -> Vec<Column> {
    let apis: Vec<Option<Api>> = blobs.par_iter().map(|blob| read_api(blob)).collect();
    let mut names = BTreeMap::<&str, BTreeSet<u32>>::new();
    let mut stems = BTreeMap::<&str, BTreeSet<u32>>::new();
    let (mut unavailable, mut told, mut readable) = (Vec::new(), Vec::new(), Vec::with_capacity(apis.len()));
    let (mut texts, mut offsets) = (Vec::new(), vec![0u32]);
    for (row, api) in apis.iter().enumerate() {
        let row = row as u32;
        readable.push(u8::from(api.is_some()));
        if let Some(api) = api {
            for name in api.names.as_deref().unwrap_or(&[]) { names.entry(&name.name).or_default().insert(row); }
            for stem in api.purpose.iter().flat_map(|purpose| purpose.said.iter().chain(&purpose.named)) {
                stems.entry(stem).or_default().insert(row);
            }
            if api.unavailable.is_some() { unavailable.push(row); }
            if api.unavailable.is_some() && told_by_readme(api) { told.push(row); }
            text(api, &mut texts);
        }
        offsets.push(texts.len() as u32);
    }
    let mut columns = Vec::from(keyed(["finds.names", "finds.names.off", "finds.names.held", "finds.names.entries"], names));
    columns.extend(keyed(["finds.stems", "finds.stems.off", "finds.stems.held", "finds.stems.entries"], stems));
    columns.extend([u32s("finds.unavailable", unavailable), u32s("finds.told", told), u8s("finds.readable", readable),
        u8s("finds.text", texts), u32s("finds.text.off", offsets)]);
    columns
}

struct Keys<'a> { blob: &'a [u8], keys: U32s<'a>, held: U32s<'a>, entries: U32s<'a> }

impl<'a> Keys<'a> {
    fn open(stored: &Stored<'a>, prefix: [&str; 4], rows: usize) -> Result<Self, String> {
        let blob = stored.u8s(prefix[0])?;
        let count = stored.u32s(prefix[1])?.len().saturating_sub(1);
        let entries = stored.u32s(prefix[3])?;
        let keys = Self { blob, keys: stored.offsets(prefix[1], count, blob.len())?,
            held: stored.offsets(prefix[2], count, entries.len())?, entries };
        if !keys.entries.every(|entry| (entry as usize) < rows) { return Err(format!("{} names an entry past its table", prefix[3])); }
        Ok(keys)
    }

    fn key(&self, at: usize) -> &'a [u8] { &self.blob[self.keys.range(at)] }

    /// The entries that hold `key`.
    fn holders(&self, key: &str) -> impl Iterator<Item = u32> + '_ {
        let count = self.keys.len() - 1;
        let at = crate::stored::partition(count, |at| self.key(at) < key.as_bytes());
        let range = if at < count && self.key(at) == key.as_bytes() { self.held.range(at) } else { 0..0 };
        range.map(|at| self.entries.at(at))
    }
}

/// The tables, read in place.
pub(super) struct Finds<'a> {
    names: Keys<'a>,
    stems: Keys<'a>,
    unavailable: U32s<'a>,
    told: U32s<'a>,
    readable: &'a [u8],
    text: (&'a [u8], U32s<'a>),
}

impl<'a> Finds<'a> {
    pub fn open(stored: &Stored<'a>, rows: usize) -> Result<Self, String> {
        let text = stored.u8s("finds.text")?;
        let finds = Self {
            names: Keys::open(stored, ["finds.names", "finds.names.off", "finds.names.held", "finds.names.entries"], rows)?,
            stems: Keys::open(stored, ["finds.stems", "finds.stems.off", "finds.stems.held", "finds.stems.entries"], rows)?,
            unavailable: stored.u32s("finds.unavailable")?,
            told: stored.u32s("finds.told")?,
            readable: stored.codes("finds.readable", 1)?,
            text: (text, stored.offsets("finds.text.off", rows, text.len())?),
        };
        if finds.readable.len() != rows || ![&finds.unavailable, &finds.told].iter().all(|list| list.every(|entry| (entry as usize) < rows)) {
            return Err("the finds tables do not cover the entries".to_owned());
        }
        Ok(finds)
    }

    /// Whether the entry's blob decoded when the tables were written.
    pub fn readable(&self, entry: u32) -> bool { self.readable[entry as usize] != 0 }

    /// The entries that may answer an exact `name`: those that declare it, and those silent about every name — of
    /// those, only the ones with a README to answer from, unless the question named the package.
    pub fn named(&self, name: &str, named_package: bool, wanted: &mut [bool]) {
        let silent = if named_package { &self.unavailable } else { &self.told };
        for entry in self.names.holders(name).chain((0..silent.len()).map(|at| silent.at(at))) {
            wanted[entry as usize] = true;
        }
    }

    /// The entries with a name or a doc that contains `lowered`.
    pub fn containing(&self, lowered: &str, wanted: &mut [bool]) {
        let (text, offsets) = self.text;
        if lowered.is_empty() {
            for (entry, wanted) in wanted.iter_mut().enumerate() { *wanted |= !offsets.range(entry).is_empty(); }
            return;
        }
        let finder = Finder::new(lowered.as_bytes());
        let mut from = 0;
        while let Some(found) = finder.find(&text[from..]) {
            let at = (from + found) as u32;
            // The entry whose text holds `at`: the last whose start is at or before it.
            let entry = crate::stored::partition(offsets.len() - 1, |entry| offsets.at(entry + 1) <= at);
            wanted[entry] = true;
            // Nothing more in this entry is needed: go on from its end.
            from = offsets.at(entry + 1) as usize;
        }
    }

    /// The entries whose purpose holds at least `needed` of `stems`.
    pub fn stemmed<'s>(&self, stems: impl Iterator<Item = &'s str>, needed: usize, wanted: &mut [bool]) {
        let mut held = BTreeMap::<u32, usize>::new();
        for stem in stems { for entry in self.stems.holders(stem) { *held.entry(entry).or_default() += 1; } }
        for (entry, count) in held { if count >= needed { wanted[entry as usize] = true; } }
    }
}
