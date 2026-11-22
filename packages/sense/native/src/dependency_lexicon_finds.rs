//! What a question finds an entry by, written beside the entries so a question decodes only the ones that can
//! answer it.
//!
//! An entry's reading is a blob, and its names, docs and purpose stems are inside it. A question asks for one
//! name, for words in names and docs, or for stems a purpose holds, and without these tables it decoded every
//! entry to learn which held them. Each table answers with a superset of the entries that match: the question
//! still decodes those and matches them as it always did, so a table can widen what is decoded, never the answer.

// compass: variance-authority.reach.relations

use std::collections::{BTreeMap, BTreeSet};

use crate::name_table::{marked, row_of, NameColumn, Names, Scope};
use crate::segment::{u32s, u8s, Column};
use crate::stored::{Stored, U32s};

use super::Api;

/// The sections of the contains-question's column: one row per name, its doc's words lowercased beside it.
const TEXT: (&str, &str) = ("finds.text", "finds.text.off");

/// Whether a package silent about every name has a README to answer from instead: one beside its manifest that read.
pub(super) fn told_by_readme(api: &Api) -> bool { api.readme.as_ref().is_some_and(|readme| readme.unreadable.is_none()) }

/// Keys in byte order, each with the ascending entries that hold it.
fn keyed(prefix: [&'static str; 4], table: &BTreeMap<String, BTreeSet<u32>>) -> [Column; 4] {
    let (mut blob, mut keys, mut held, mut entries) = (Vec::new(), vec![0u32], vec![0u32], Vec::new());
    for (key, holders) in table {
        blob.extend_from_slice(key.as_bytes());
        keys.push(blob.len() as u32);
        entries.extend(holders);
        held.push(entries.len() as u32);
    }
    [u8s(prefix[0], blob), u32s(prefix[1], keys), u32s(prefix[2], held), u32s(prefix[3], entries)]
}

const NAMES: [&str; 4] = ["finds.names", "finds.names.off", "finds.names.held", "finds.names.entries"];
const STEMS: [&str; 4] = ["finds.stems", "finds.stems.off", "finds.stems.held", "finds.stems.entries"];

/// The tables as a refresh made them from the readings it holds, before they are written. A reading the refresh
/// could not encode is `None`: the question decodes no entry the tables mark unreadable.
#[derive(Default)]
pub(super) struct Made {
    names: BTreeMap<String, BTreeSet<u32>>,
    stems: BTreeMap<String, BTreeSet<u32>>,
    unavailable: Vec<u32>,
    told: Vec<u32>,
    readable: Vec<u8>,
    /// Per entry, the first row of [`TEXT`] its names start at.
    first: Vec<u32>,
    text: Vec<(String, Option<String>)>,
}

impl Made {
    pub fn of<'a>(apis: impl IntoIterator<Item = Option<&'a Api>>) -> Self {
        let mut made = Made::default();
        for (row, api) in apis.into_iter().enumerate() {
            let row = row as u32;
            made.readable.push(u8::from(api.is_some()));
            made.first.push(made.text.len() as u32);
            let Some(api) = api else { continue };
            for name in api.names.as_deref().unwrap_or(&[]) {
                made.names.entry(name.name.clone()).or_default().insert(row);
                made.text.push((name.name.clone(), name.doc.as_deref().map(str::to_lowercase)));
            }
            for stem in api.purpose.iter().flat_map(|purpose| purpose.said.iter().chain(&purpose.named)) {
                made.stems.entry(stem.clone()).or_default().insert(row);
            }
            if api.unavailable.is_some() { made.unavailable.push(row); }
            if api.unavailable.is_some() && told_by_readme(api) { made.told.push(row); }
        }
        made.first.push(made.text.len() as u32);
        made
    }

    pub fn columns(&self) -> Vec<Column> {
        let mut text = NameColumn::default();
        for (name, doc) in &self.text { text.push(name, doc.is_some(), Some(doc.as_deref())); }
        let mut columns = Vec::from(keyed(NAMES, &self.names));
        columns.extend(keyed(STEMS, &self.stems));
        columns.extend([u32s("finds.unavailable", self.unavailable.clone()), u32s("finds.told", self.told.clone()),
            u8s("finds.readable", self.readable.clone()), u32s("finds.text.first", self.first.clone())]);
        columns.extend(text.written(TEXT));
        columns
    }
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
    first: U32s<'a>,
    text: Names<'a>,
}

impl<'a> Finds<'a> {
    pub fn open(stored: &Stored<'a>, rows: usize) -> Result<Self, String> {
        let names = stored.u32s(TEXT.1)?.len().saturating_sub(1);
        let finds = Self {
            names: Keys::open(stored, NAMES, rows)?,
            stems: Keys::open(stored, STEMS, rows)?,
            unavailable: stored.u32s("finds.unavailable")?,
            told: stored.u32s("finds.told")?,
            readable: stored.codes("finds.readable", 1)?,
            first: stored.offsets("finds.text.first", rows, names)?,
            text: Names::open_at(stored, TEXT, names)?,
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

    /// The entries with a name or a doc that contains `lowered`. A question holding a byte the column writes only as
    /// a marker cannot be scanned for, so it wants every entry with a name.
    pub fn containing(&self, lowered: &str, wanted: &mut [bool]) {
        let rows = if marked(lowered) { (0..self.text.rows()).collect() } else { self.text.holding(lowered, Scope::Entry) };
        for row in rows { wanted[row_of(self.first, wanted.len(), row)] = true; }
    }

    /// The entries whose purpose holds at least `needed` of `stems`.
    pub fn stemmed<'s>(&self, stems: impl Iterator<Item = &'s str>, needed: usize, wanted: &mut [bool]) {
        let mut held = BTreeMap::<u32, usize>::new();
        for stem in stems { for entry in self.stems.holders(stem) { *held.entry(entry).or_default() += 1; } }
        for (entry, count) in held { if count >= needed { wanted[entry as usize] = true; } }
    }
}
