//! One source-index segment, read in place: the framing `segment.rs` writes,
//! opened again for the one reader on this side, the compaction
//! (`compact.rs`).
//!
//! What a column *means* is `decodeSourceIndex`'s to say, in
//! `source-index-format.ts`, and it decides whether a segment is believed at
//! all: a chain is cut at the first segment it refuses. What reaches this side
//! is a chain it accepted and layers this side encoded. So this checks framing
//! and bounds — enough that a bad offset is a refusal with a name rather than a
//! read past the end — and a segment that breaks them is a defect in whoever
//! handed it over.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;
use std::ops::Range;

use serde::Deserialize;

use crate::segment::{ALIGNMENT, FORMAT, NONE, VERSION};

#[derive(Deserialize)]
struct Header {
    format: String,
    version: u32,
    sections: Vec<Section>,
}

#[derive(Deserialize)]
struct Section {
    name: String,
    offset: usize,
    length: usize,
    width: u8,
}

/// A little-endian `u32` column, read where it lies. The bytes are not
/// reinterpreted as `&[u32]` because a buffer handed over from JavaScript is
/// not promised to start on a four-byte boundary.
#[derive(Clone, Copy, Default)]
pub struct U32s<'a>(&'a [u8]);

impl U32s<'_> {
    pub fn len(&self) -> usize {
        self.0.len() / 4
    }

    pub fn at(&self, index: usize) -> u32 {
        let at = index * 4;
        u32::from_le_bytes([self.0[at], self.0[at + 1], self.0[at + 2], self.0[at + 3]])
    }

    /// The children of `row`, from an offset column already checked by
    /// [`Stored::offsets`].
    pub fn range(&self, row: usize) -> Range<usize> {
        self.at(row) as usize..self.at(row + 1) as usize
    }
}

pub struct Stored<'a> {
    bytes: &'a [u8],
    sections: HashMap<String, (usize, usize, u8)>,
    strings: Vec<&'a str>,
}

impl<'a> Stored<'a> {
    /// The header, every section's bounds, and the dictionary.
    pub fn open(bytes: &'a [u8]) -> Result<Self, String> {
        let length = bytes
            .get(..4)
            .map(|head| u32::from_le_bytes([head[0], head[1], head[2], head[3]]) as usize)
            .ok_or("shorter than its header length")?;
        let header = bytes.get(4..4 + length).ok_or("shorter than its header")?;
        let text = std::str::from_utf8(header).map_err(|_| "a header that is not UTF-8")?;
        let header: Header =
            serde_json::from_str(text.trim_end_matches('\0')).map_err(|error| format!("a header that does not parse: {error}"))?;
        if header.format != FORMAT {
            return Err(format!("{} version {}, not {FORMAT} version {VERSION}", header.format, header.version));
        }
        // Another release wrote it: told apart from bytes that do not read, as the TypeScript reader tells them.
        if header.version != u32::from(VERSION) {
            return Err(format!(
                "a {FORMAT} written in format version {}, and this release reads version {VERSION}; `variance index` rebuilds it",
                header.version
            ));
        }
        let base = 4 + length;
        let body = bytes.len() - base;
        let mut sections = HashMap::with_capacity(header.sections.len());
        for section in header.sections {
            let fits = section.offset % ALIGNMENT == 0
                && section.offset.checked_add(section.length).is_some_and(|end| end <= body)
                && (section.width == 1 || (section.width == 4 && section.length % 4 == 0));
            if !fits {
                return Err(format!("section {} lies outside the segment", section.name));
            }
            if sections.insert(section.name.clone(), (base + section.offset, section.length, section.width)).is_some() {
                return Err(format!("section {} is named twice", section.name));
            }
        }
        let mut stored = Stored { bytes, sections, strings: Vec::new() };
        let blob = std::str::from_utf8(stored.u8s("strings.blob")?).map_err(|_| "a dictionary that is not UTF-8")?;
        let off = stored.u32s("strings.off")?;
        if off.len() == 0 || off.at(0) != 0 || off.at(off.len() - 1) as usize != blob.len() {
            return Err("a dictionary whose offsets do not span it".to_owned());
        }
        stored.strings = (0..off.len() - 1)
            .map(|at| blob.get(off.at(at) as usize..off.at(at + 1) as usize))
            .collect::<Option<_>>()
            .ok_or("a dictionary entry that is not a string")?;
        Ok(stored)
    }

    fn section(&self, name: &str, width: u8) -> Result<Option<&'a [u8]>, String> {
        match self.sections.get(name) {
            None => Ok(None),
            Some(&(start, length, found)) if found == width => Ok(Some(&self.bytes[start..start + length])),
            Some(_) => Err(format!("section {name} is not {width} bytes wide")),
        }
    }

    pub fn u8s(&self, name: &str) -> Result<&'a [u8], String> {
        self.section(name, 1)?.ok_or_else(|| format!("no section {name}"))
    }

    pub fn u32s(&self, name: &str) -> Result<U32s<'a>, String> {
        Ok(U32s(self.section(name, 4)?.ok_or_else(|| format!("no section {name}"))?))
    }

    /// A column a writer of this version may not have written: empty when absent.
    pub fn maybe_u32s(&self, name: &str) -> Result<U32s<'a>, String> {
        Ok(U32s(self.section(name, 4)?.unwrap_or_default()))
    }

    /// An offset column over `rows` parents into a child column of `end`
    /// entries: one entry more than there are parents, starting at zero,
    /// ending at `end`, and never going back.
    pub fn offsets(&self, name: &str, rows: usize, end: usize) -> Result<U32s<'a>, String> {
        let column = self.u32s(name)?;
        let spans = column.len() == rows + 1
            && column.at(0) == 0
            && column.at(rows) as usize == end
            && (1..=rows).all(|at| column.at(at - 1) <= column.at(at));
        if spans { Ok(column) } else { Err(format!("offsets {name} do not span their {end} entries")) }
    }

    /// A string the segment names. An id past the dictionary is a column read
    /// through the wrong one, which the reader that accepted this segment would
    /// have refused, so it panics — a defect, thrown at the boundary.
    pub fn text(&self, id: u32) -> &'a str {
        match self.strings.get(id as usize) {
            Some(value) => value,
            None => panic!("source index: string {id} is past a dictionary of {}", self.strings.len()),
        }
    }

    pub fn optional(&self, id: u32) -> Option<&'a str> {
        (id != NONE).then(|| self.text(id))
    }
}

/// Every column in `columns` holds `length` entries.
pub fn same_length(length: usize, columns: &[(&str, usize)]) -> Result<(), String> {
    match columns.iter().find(|(_, found)| *found != length) {
        Some((name, found)) => Err(format!("section {name} holds {found} entries, not {length}")),
        None => Ok(()),
    }
}
