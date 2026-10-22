//! The requests each source file writes, kept as a log the refresh appends to.
//!
//! The source index is a chain of segments: the base it was readied with and a working layer over it, which each
//! update replaces. The sites file opens with the requests of every file the base holds, written once when the
//! base is new, and goes on with one record per file whose state the working layer moved since: its requests
//! again, a tombstone, or a marker that it is the base's once more. A file's requests are the latest record that
//! names it, or the base's. So an edit costs the edited files' records, and the file is written whole only when
//! the base, or the set of names a request is not external to, is not the one it opened with.
//!
//! A record is length-prefixed. One torn by a refresh that stopped mid-write does not read, and neither does
//! anything after it; the next append starts where the last whole record ends.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

use rayon::prelude::*;
use sha2::{Digest, Sha256};

use super::codec::{In, Out};
use crate::compact::Layer;
use crate::external_dependencies::requests_of;
use crate::package_graph::{fold, join_parses, Crossing};
use crate::package_owners::NO_OWNER;

const MAGIC: &[u8] = b"variance-authority-dependency-sites\0";
const VERSION: u32 = 1;
const HEADER: u8 = 0;
const BASE_END: u8 = 1;
const ROWS: u8 = 2;
const DELETED: u8 = 3;
const TO_BASE: u8 = 4;
const SEEN: u8 = 5;

/// One request a file writes.
pub(super) struct Site<'a> {
    pub package: &'a str,
    pub specifier: &'a str,
    pub line: u32,
}

/// A file's requests as a record holds them: its digest and the encoded rows.
#[derive(Clone, Copy)]
struct Rows<'a> { digest: &'a str, rows: &'a [u8] }

/// The rows a record wrote.
pub(super) fn sites(rows: &[u8]) -> impl Iterator<Item = Site<'_>> {
    let mut input = In::new(rows);
    let count = input.u32().unwrap_or(0);
    (0..count).map_while(move |_| Some(Site { package: input.str()?, specifier: input.str()?, line: input.u32()? }))
}

pub(super) fn is_source(path: &str) -> bool {
    [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].iter().any(|suffix| path.ends_with(suffix))
}

/// The digest of the names a request is not external to, as the header keeps it.
pub(super) fn internal_digest(internal: &[&str]) -> String {
    let mut sorted = internal.to_vec();
    sorted.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    sorted.dedup();
    let mut hash = Sha256::new();
    for name in sorted { hash.update(name.as_bytes()); hash.update([0]); }
    format!("{:x}", hash.finalize())
}

/// A sites file read in place.
pub(super) struct State<'a> {
    pub base: Vec<&'a str>,
    pub internal: &'a str,
    based: HashMap<&'a str, Rows<'a>>,
    /// The latest record past the base for each file it names: rows, or `None` for a tombstone.
    overrides: HashMap<&'a str, Option<Rows<'a>>>,
    pub seen: Option<Vec<&'a str>>,
    /// Where the last whole record ends.
    pub end: usize,
}

impl<'a> State<'a> {
    /// The file's state, or `None` when it is not one this release wrote whole through its base.
    pub fn read(bytes: &'a [u8]) -> Option<Self> {
        let body = bytes.strip_prefix(MAGIC)?;
        let mut state: Option<State> = None;
        let mut based = false;
        let mut at = 0;
        while let Some(head) = body.get(at..at + 4) {
            let length = u32::from_le_bytes([head[0], head[1], head[2], head[3]]) as usize;
            let Some(payload) = body.get(at + 4..at + 4 + length) else { break };
            if Self::record(payload, &mut state, &mut based).is_none() { break; }
            at += 4 + length;
            if let Some(held) = state.as_mut() { held.end = MAGIC.len() + at; }
        }
        state.filter(|_| based)
    }

    /// One record read into `state`; `None` when it does not read, which ends the file there.
    fn record(payload: &'a [u8], state: &mut Option<State<'a>>, based: &mut bool) -> Option<()> {
        let mut record = In::new(payload);
        let kind = record.u8()?;
        if kind == HEADER {
            if state.is_some() || record.u32()? != VERSION { return None; }
            let base = record.list(In::str)?;
            let internal = record.str()?;
            *state = Some(State { base, internal, based: HashMap::new(), overrides: HashMap::new(), seen: None, end: 0 });
            return record.done().then_some(());
        }
        let held = state.as_mut()?;
        match kind {
            BASE_END if !*based => *based = true,
            ROWS => {
                let file = record.str()?;
                let digest = record.str()?;
                let rows = &payload[record.at()..];
                // Rows that do not span the rest of the record are a torn write.
                let mut check = In::new(rows);
                check.list(|input| Some((input.str()?, input.str()?, input.u32()?)))?;
                if !check.done() { return None; }
                let rows = Rows { digest, rows };
                if *based { held.overrides.insert(file, Some(rows)); } else { held.based.insert(file, rows); }
                return Some(());
            }
            DELETED if *based => { held.overrides.insert(record.str()?, None); }
            TO_BASE if *based => { held.overrides.remove(record.str()?); }
            SEEN if *based => held.seen = Some(record.list(In::str)?),
            _ => return None,
        }
        record.done().then_some(())
    }

    fn effective(&self, file: &str) -> Option<Rows<'a>> {
        match self.overrides.get(file) { Some(held) => *held, None => self.based.get(file).copied() }
    }

    /// Every file that writes a request, and its rows.
    pub fn files(&self) -> impl Iterator<Item = (&'a str, &'a [u8])> + '_ {
        self.based.iter().filter(|(file, _)| !self.overrides.contains_key(*file)).map(|(file, rows)| (*file, rows.rows))
            .chain(self.overrides.iter().filter_map(|(file, held)| held.map(|rows| (*file, rows.rows))))
    }
}

/// Records written past what a file holds.
#[derive(Default)]
pub(super) struct Writer {
    out: Out,
    /// The files whose state a record moved.
    pub appended: u32,
    /// The requests the moved files write now.
    pub written: Vec<(String, Vec<(String, String)>)>,
}

impl Writer {
    fn record(&mut self, write: impl FnOnce(&mut Out)) {
        let mut payload = Out::default();
        write(&mut payload);
        self.out.u32(payload.bytes.len() as u32);
        self.out.bytes.extend_from_slice(&payload.bytes);
    }

    fn rows(&mut self, file: &str, digest: &str, rows: &[(String, String, u32)]) {
        self.record(|out| {
            out.u8(ROWS);
            out.str(file);
            out.str(digest);
            out.list(rows, |out, (package, specifier, line)| { out.str(package); out.str(specifier); out.u32(*line); });
        });
    }

    fn file(&mut self, kind: u8, file: &str) {
        self.appended += 1;
        self.written.push((file.to_owned(), Vec::new()));
        self.record(|out| { out.u8(kind); out.str(file); });
    }

    pub fn bytes(&self) -> &[u8] { &self.out.bytes }
}

fn open_layers(segments: &[Vec<u8>]) -> Option<Vec<Layer<'_>>> {
    segments.iter().map(|bytes| Layer::open(bytes)).collect::<Result<Vec<_>, _>>().ok()
}

/// The requests each crossing's file writes, sorted by line, or `Err` where its parse is not among `layers`.
fn requests(layers: &[Layer], crossings: &mut [Crossing], internal: &HashSet<&str>) -> Vec<Result<Vec<(String, String, u32)>, ()>> {
    join_parses(layers, crossings);
    crossings.par_iter().map(|crossing| {
        let mut rows: Vec<_> = requests_of(layers, crossing, internal)?.into_iter()
            .map(|request| (request.package, request.specifier, request.line)).collect();
        rows.sort_by(|a, b| a.2.cmp(&b.2).then_with(|| crate::order::code_unit(&a.1, &b.1)));
        Ok(rows)
    }).collect()
}

/// A sites file over the base of `chain`, its first `base` segments, written whole: the base's records, then the
/// working layer's. `None` when the chain does not read.
pub(super) fn rebuild(index: &str, chain: &[String], base: usize, internal: &HashSet<&str>, digest: &str) -> Option<(Vec<u8>, Writer)> {
    let segments = crate::index_chain::read_tail(index, chain, 0)?;
    let layers = open_layers(&segments)?;
    let base_layers = &layers[..base.min(layers.len())];
    let folded = fold(base_layers);
    let mut files: Vec<(&str, (usize, usize))> = folded.into_iter().filter(|(file, _)| is_source(file)).collect();
    files.sort_unstable_by(|a, b| crate::order::code_unit(a.0, b.0));
    let mut crossings: Vec<Crossing> = files.iter().map(|&(file, at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None }).collect();
    let read = requests(base_layers, &mut crossings, internal);
    let mut writer = Writer::default();
    writer.record(|out| {
        out.u8(HEADER);
        out.u32(VERSION);
        out.list(&chain[..base], |out, digest| out.str(digest));
        out.str(digest);
    });
    for ((file, (layer, row)), rows) in files.iter().zip(read) {
        let rows = rows.unwrap_or_default();
        if rows.is_empty() { continue; }
        let (stored, records) = (&base_layers[*layer].stored, &base_layers[*layer].records);
        writer.rows(file, stored.optional(records.digest.at(*row)).unwrap_or(""), &rows);
    }
    writer.record(|out| out.u8(BASE_END));
    let mut bytes = MAGIC.to_vec();
    bytes.extend_from_slice(writer.bytes());
    drop(layers);
    let appended = increment(index, chain, base, &State::read(&bytes)?, internal)?;
    bytes.extend_from_slice(appended.bytes());
    Some((bytes, appended))
}

/// The records that bring `state` to the working layer of `chain` past its first `base` segments, and the
/// digests of that layer last. `None` when the chain does not read.
pub(super) fn increment(index: &str, chain: &[String], base: usize, state: &State, internal: &HashSet<&str>) -> Option<Writer> {
    let segments = crate::index_chain::read_tail(index, chain, base)?;
    let layers = open_layers(&segments)?;
    // What the working layer says of each file it names: written at a row, or deleted.
    let mut status: HashMap<&str, Option<(usize, usize)>> = HashMap::new();
    for (at, layer) in layers.iter().enumerate() {
        let (stored, records) = (&layer.stored, &layer.records);
        for row in 0..records.deleted.len() { status.insert(stored.text(records.deleted.at(row)), None); }
        for row in 0..records.file.len() { status.insert(stored.text(records.file.at(row)), Some((at, row))); }
    }
    let mut named: Vec<(&str, Option<(usize, usize)>)> = status.iter().filter(|(file, _)| is_source(file)).map(|(file, at)| (*file, *at)).collect();
    named.sort_unstable_by(|a, b| crate::order::code_unit(a.0, b.0));
    let mut writer = Writer::default();
    let mut changed: Vec<(&str, (usize, usize), &str)> = Vec::new();
    for (file, at) in named {
        let held = state.effective(file);
        match at {
            None if held.is_some() => writer.file(DELETED, file),
            None => {}
            Some((layer, row)) => {
                let digest = layers[layer].stored.optional(layers[layer].records.digest.at(row)).unwrap_or("");
                if held.is_none_or(|held| digest.is_empty() || held.digest != digest) { changed.push((file, (layer, row), digest)); }
            }
        }
    }
    let mut back: Vec<&str> = state.overrides.keys().copied().filter(|file| !status.contains_key(file)).collect();
    back.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    for file in back { writer.file(TO_BASE, file); }

    let mut crossings: Vec<Crossing> = changed.iter().map(|&(file, at, _)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None }).collect();
    let mut read = requests(&layers, &mut crossings, internal);
    // A file written back to bytes the base holds has its parse there: only then is the whole chain opened.
    let missed: Vec<usize> = (0..read.len()).filter(|at| read[*at].is_err()).collect();
    if !missed.is_empty() {
        let whole = crate::index_chain::read_tail(index, chain, 0)?;
        let whole = open_layers(&whole)?;
        let mut again: Vec<Crossing> = missed.iter().map(|&at| {
            let (file, (layer, row), _) = changed[at];
            Crossing { file, owner: NO_OWNER, others: Vec::new(), at: (base + layer, row), parse: None }
        }).collect();
        for (at, rows) in missed.iter().zip(requests(&whole, &mut again, internal)) { read[*at] = rows; }
    }
    for ((file, _, digest), rows) in changed.iter().zip(read) {
        // A file the index holds but cannot read writes nothing the lexicon can count, as the rebuild reads it.
        let rows = rows.unwrap_or_default();
        if rows.is_empty() && state.effective(file).is_none() { continue; }
        writer.appended += 1;
        writer.written.push(((*file).to_owned(), rows.iter().map(|(package, specifier, _)| (package.clone(), specifier.clone())).collect()));
        writer.rows(file, digest, &rows);
    }
    writer.record(|out| { out.u8(SEEN); out.list(&chain[base..], |out, digest| out.str(digest)); });
    Some(writer)
}

/// The file at `path` replaced by `bytes`, written beside it and renamed into place.
pub(super) fn publish(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&temporary, bytes)?;
    fs::rename(&temporary, path)
}

/// `bytes` appended where the last whole record of the file at `path` ends.
pub(super) fn append(path: &Path, end: usize, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new().write(true).open(path)?;
    file.set_len(end as u64)?;
    file.seek(SeekFrom::End(0))?;
    file.write_all(bytes)
}
