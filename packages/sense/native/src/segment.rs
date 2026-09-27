//! One source-index segment's framing: a JSON header naming each column, then
//! the columns, each padded to eight bytes.
//!
//! Two encoders write this framing — the parse half the graph walk produces
//! (`index.rs`) and the whole generation a cold build publishes
//! (`generation.rs`) — and the TypeScript reader is the one that decides
//! whether either is believed. So the framing lives once, here, mirroring
//! `encodeSegment` in `core/segment`: the header is the same JSON in the same
//! key order, its length is padded so the first column starts on the
//! alignment, and a column is written whatever its length, empty included,
//! because the decoder rejects a segment that omits one it names.

// compass: variance-authority.reach.source-index

use std::collections::{HashMap, HashSet};

use rayon::prelude::*;
use rustc_hash::FxBuildHasher;
use serde::Serialize;

/// The id an optional string column writes for "absent".
pub const NONE: u32 = u32::MAX;
pub(crate) const ALIGNMENT: usize = 8;
/// `FORMAT` in `source-index-format.ts`.
pub(crate) const FORMAT: &str = "variance-authority-source-index";
/// `VERSION` in `source-index-format.ts`: a layer the reader refuses is a layer
/// thrown away, which `native-read.test.ts` catches.
pub(crate) const VERSION: u8 = 13;

pub struct Column {
    name: &'static str,
    width: u8,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
struct Section {
    name: &'static str,
    offset: usize,
    length: usize,
    width: u8,
}

#[derive(Serialize)]
struct Header {
    format: &'static str,
    version: u8,
    sections: Vec<Section>,
}

pub fn u8s(name: &'static str, bytes: Vec<u8>) -> Column {
    Column { name, width: 1, bytes }
}

pub fn u32s(name: &'static str, values: Vec<u32>) -> Column {
    let mut bytes = Vec::with_capacity(values.len() * 4);
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    Column { name, width: 4, bytes }
}

fn aligned(value: usize) -> usize {
    (value + ALIGNMENT - 1) & !(ALIGNMENT - 1)
}

/// The segment bytes: a little-endian header length, the header, then every
/// column in the order given.
pub fn encode(columns: Vec<Column>) -> Vec<u8> {
    let mut offset = 0;
    let sections = columns
        .iter()
        .map(|column| {
            let section = Section {
                name: column.name,
                offset,
                length: column.bytes.len(),
                width: column.width,
            };
            offset = aligned(offset + column.bytes.len());
            section
        })
        .collect();
    let header = serde_json::to_vec(&Header {
        format: FORMAT,
        version: VERSION,
        sections,
    })
    .unwrap_or_default();
    let header_length = aligned(4 + header.len()) - 4;
    let mut out = Vec::with_capacity(4 + header_length + offset);
    out.extend_from_slice(&(header_length as u32).to_le_bytes());
    out.extend_from_slice(&header);
    out.resize(4 + header_length, 0);
    for column in columns {
        out.extend_from_slice(&column.bytes);
        out.resize(aligned(out.len()), 0);
    }
    out
}

/// Every string a segment will name, borrowed from what it is encoded from.
/// A generation names each path and kind many times over; collected as owned
/// strings under the standard hasher, that was most of what a record-heavy
/// save cost, and nothing here needs the hash to resist a chosen input.
pub type Collected<'s> = HashSet<&'s str, FxBuildHasher>;

/// The dictionary a segment interns into: sorted by code unit, as `intern` in
/// `core/segment` sorts it, so the ids depend on the set and never on the
/// order anything was collected in.
pub struct Strings<'s> {
    blob: Vec<u8>,
    off: Vec<u32>,
    ids: HashMap<&'s str, u32, FxBuildHasher>,
}

impl<'s> Strings<'s> {
    pub fn of(values: Collected<'s>) -> Self {
        let mut sorted: Vec<&'s str> = values.into_iter().collect();
        sorted.par_sort_unstable_by(|left, right| crate::order::code_unit(left, right));
        let mut blob = Vec::new();
        let mut off = Vec::with_capacity(sorted.len() + 1);
        off.push(0);
        for value in &sorted {
            blob.extend_from_slice(value.as_bytes());
            off.push(blob.len() as u32);
        }
        let mut ids = HashMap::with_capacity_and_hasher(sorted.len(), FxBuildHasher);
        ids.extend(sorted.into_iter().enumerate().map(|(index, value)| (value, index as u32)));
        Self { blob, off, ids }
    }

    /// A collected string's id. A string nobody collected is a defect in the
    /// collecting, and panics rather than writing row 0 — a real string, and
    /// the wrong one.
    pub fn id(&self, value: &str) -> u32 {
        match self.ids.get(value) {
            Some(id) => *id,
            None => panic!("source index: {value:?} was never collected into the dictionary"),
        }
    }

    pub fn optional(&self, value: Option<&str>) -> u32 {
        value.map_or(NONE, |value| self.id(value))
    }

    /// The two string columns, which open every segment. Taken once: the ids
    /// stay, for the columns that refer to them.
    pub fn columns(&mut self) -> [Column; 2] {
        [
            u8s("strings.blob", std::mem::take(&mut self.blob)),
            u32s("strings.off", std::mem::take(&mut self.off)),
        ]
    }
}
