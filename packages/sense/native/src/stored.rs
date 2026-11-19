//! One source-index segment, read in place: the framing `segment.rs` writes,
//! opened again for the one reader on this side, the compaction
//! (`compact.rs`).
//!
//! What a column *means* is this side's to say: the addon is the one reader of
//! the format (`index_reader.rs`), and JavaScript reads only the rows it asks
//! that reader for. A segment is opened by its length, not its digest, so a
//! damaged segment of the right length reaches here. This checks framing and
//! bounds — enough that a bad offset is a refusal with a name rather than a
//! read past the end — and the range of every one-byte code column, so a
//! damaged flag is refused rather than read as false. Every column is
//! little-endian, as `to_le_bytes` writes it.

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

    /// Where `value` stands in a column that ascends, when it is there.
    pub fn search(&self, value: u32) -> Option<usize> {
        let at = partition(self.len(), |index| self.at(index) < value);
        (at < self.len() && self.at(at) == value).then_some(at)
    }

    /// The children of `row`, from an offset column already checked by
    /// [`Stored::offsets`].
    pub fn range(&self, row: usize) -> Range<usize> {
        self.at(row) as usize..self.at(row + 1) as usize
    }
}

pub struct Stored<'a> {
    bytes: &'a [u8],
    /// Each section's start, length, width and place in the header.
    sections: HashMap<String, (usize, usize, u8, usize)>,
    strings: Vec<&'a str>,
    /// The text heap, `texts.blob` and `texts.off`, when the segment has one.
    texts: Option<(&'a str, U32s<'a>)>,
}

/// The format version another release wrote these bytes in: none when they are
/// this release's, or do not read as a segment at all.
pub fn written(bytes: &[u8]) -> Option<u32> {
    let length = u32::from_le_bytes(bytes.get(..4)?.try_into().ok()?) as usize;
    let header = std::str::from_utf8(bytes.get(4..4 + length)?).ok()?;
    let header: Header = serde_json::from_str(header.trim_end_matches('\0')).ok()?;
    (header.format == FORMAT && header.version != u32::from(VERSION)).then_some(header.version)
}

impl<'a> Stored<'a> {
    /// The header, every section's bounds, and the dictionary.
    pub fn open(bytes: &'a [u8]) -> Result<Self, String> {
        Self::open_as(bytes, FORMAT, VERSION)
    }

    /// The same framing under another format's name and version, as `segment::encode_as` writes it.
    pub fn open_as(bytes: &'a [u8], format: &str, version: u8) -> Result<Self, String> {
        Self::open_since(bytes, format, version, version).map(|(stored, _)| stored)
    }

    /// The same framing written at any version from `oldest` to `version`, with the version it was written at.
    pub fn open_since(bytes: &'a [u8], format: &str, oldest: u8, version: u8) -> Result<(Self, u8), String> {
        let length = bytes
            .get(..4)
            .map(|head| u32::from_le_bytes([head[0], head[1], head[2], head[3]]) as usize)
            .ok_or("shorter than its header length")?;
        let header = bytes.get(4..4 + length).ok_or("shorter than its header")?;
        let text = std::str::from_utf8(header).map_err(|_| "a header that is not UTF-8")?;
        let header: Header =
            serde_json::from_str(text.trim_end_matches('\0')).map_err(|error| format!("a header that does not parse: {error}"))?;
        if header.format != format {
            return Err(format!("{} version {}, not {format} version {version}", header.format, header.version));
        }
        // Another release wrote it: told apart from bytes that do not read.
        let Some(written) = u8::try_from(header.version).ok().filter(|written| (oldest..=version).contains(written)) else {
            return Err(format!(
                "a {format} written in format version {}, and this release reads version {version}; `variance index` rebuilds it",
                header.version
            ));
        };
        let base = 4 + length;
        let body = bytes.len() - base;
        let mut sections = HashMap::with_capacity(header.sections.len());
        for (place, section) in header.sections.into_iter().enumerate() {
            let fits = section.offset % ALIGNMENT == 0
                && section.offset.checked_add(section.length).is_some_and(|end| end <= body)
                && (section.width == 1 || (section.width == 4 && section.length % 4 == 0));
            if !fits {
                return Err(format!("section {} lies outside the segment", section.name));
            }
            if sections.insert(section.name.clone(), (base + section.offset, section.length, section.width, place)).is_some() {
                return Err(format!("section {} is named twice", section.name));
            }
        }
        let mut stored = Stored { bytes, sections, strings: Vec::new(), texts: None };
        let blob = std::str::from_utf8(stored.u8s("strings.blob")?).map_err(|_| "a dictionary that is not UTF-8")?;
        let off = stored.u32s("strings.off")?;
        if off.len() == 0 || off.at(0) != 0 || off.at(off.len() - 1) as usize != blob.len() {
            return Err("a dictionary whose offsets do not span it".to_owned());
        }
        stored.strings = (0..off.len() - 1)
            .map(|at| blob.get(off.at(at) as usize..off.at(at + 1) as usize))
            .collect::<Option<_>>()
            .ok_or("a dictionary entry that is not a string")?;
        if let Some(blob) = stored.section("texts.blob", 1)? {
            let blob = std::str::from_utf8(blob).map_err(|_| "a text heap that is not UTF-8")?;
            let off = stored.u32s("texts.off")?;
            if off.len() == 0 || off.at(0) != 0 || off.at(off.len() - 1) as usize != blob.len() {
                return Err("a text heap whose offsets do not span it".to_owned());
            }
            stored.texts = Some((blob, off));
        }
        Ok((stored, written))
    }

    fn section(&self, name: &str, width: u8) -> Result<Option<&'a [u8]>, String> {
        match self.sections.get(name) {
            None => Ok(None),
            Some(&(start, length, found, _)) if found == width => Ok(Some(&self.bytes[start..start + length])),
            Some(_) => Err(format!("section {name} is not {width} bytes wide")),
        }
    }

    /// Every section as written — name, width and bytes — in the order the
    /// header names them, which is the order the segment lays them out. Empty
    /// sections share an offset, so the offset alone left their order to the
    /// map's hash.
    pub fn columns(&self) -> Vec<(&str, u8, &'a [u8])> {
        let mut columns: Vec<_> = self.sections.iter().map(|(name, &(start, length, width, place))| (place, name.as_str(), width, &self.bytes[start..start + length])).collect();
        columns.sort_by_key(|column| column.0);
        columns.into_iter().map(|(_, name, width, bytes)| (name, width, bytes)).collect()
    }

    /// A one-byte column a writer may not have written.
    pub fn maybe_u8s(&self, name: &str) -> Result<Option<&'a [u8]>, String> {
        self.section(name, 1)
    }

    pub fn u8s(&self, name: &str) -> Result<&'a [u8], String> {
        self.section(name, 1)?.ok_or_else(|| format!("no section {name}"))
    }

    /// A one-byte column of codes from zero to `most`, as a flag (`most` one)
    /// or an enumeration: a segment with one code past it anywhere is refused
    /// at open, not when a row is read. A segment is read by its length, not its digest, so a damaged
    /// byte reaches here. One pass of a byte maximum, which vectorises.
    pub fn codes(&self, name: &str, most: u8) -> Result<&'a [u8], String> {
        let column = self.u8s(name)?;
        if column.iter().fold(0, |high, &code| high.max(code)) <= most { Ok(column) } else { Err(format!("column {name} holds a code past {most}")) }
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

    /// Whether the dictionary holds a string under `id`, so [`Self::text`] reads it.
    pub fn holds(&self, id: u32) -> bool {
        (id as usize) < self.strings.len()
    }

    /// Whether the segment carries a text heap: the reader of the format refuses one that does not.
    pub fn has_texts(&self) -> bool {
        self.texts.is_some()
    }

    /// Whether [`Self::kept`] reads `id`: none, or a whole text the heap holds.
    pub fn keeps(&self, id: u32) -> bool {
        let at = id as usize;
        id == NONE
            || self.texts.is_some_and(|(blob, off)| at + 1 < off.len() && blob.get(off.at(at) as usize..off.at(at + 1) as usize).is_some())
    }

    pub fn optional(&self, id: u32) -> Option<&'a str> {
        (id != NONE).then(|| self.text(id))
    }

    /// A text the heap keeps under `id`, absent for `NONE`. An id past the
    /// heap, or offsets that cut a character, panic as [`Self::text`] does.
    pub fn kept(&self, id: u32) -> Option<&'a str> {
        if id == NONE {
            return None;
        }
        let at = id as usize;
        let text = self.texts.and_then(|(blob, off)| (at + 1 < off.len()).then(|| blob.get(off.at(at) as usize..off.at(at + 1) as usize)).flatten());
        match text {
            Some(text) => Some(text),
            None => panic!("source index: text {id} is not one the heap holds"),
        }
    }

    /// The id the dictionary holds `value` under. Every writer of the framing
    /// sorts its dictionary in code-unit order (`Strings` in `segment.rs`), so
    /// it is searched rather than read string by string.
    pub fn id_of(&self, value: &str) -> Option<u32> {
        let strings = &self.strings;
        let at = partition(strings.len(), |index| crate::order::code_unit(strings[index], value).is_lt());
        (strings.get(at) == Some(&value)).then_some(at as u32)
    }
}

/// The first of `0..length` for which `before` is false, where it is true of
/// every index before that one and of none after.
pub fn partition(length: usize, before: impl Fn(usize) -> bool) -> usize {
    let (mut low, mut high) = (0, length);
    while low < high {
        let middle = low + (high - low) / 2;
        if before(middle) { low = middle + 1 } else { high = middle }
    }
    low
}

/// Every column in `columns` holds `length` entries.
pub fn same_length(length: usize, columns: &[(&str, usize)]) -> Result<(), String> {
    match columns.iter().find(|(_, found)| *found != length) {
        Some((name, found)) => Err(format!("section {name} holds {found} entries, not {length}")),
        None => Ok(()),
    }
}
