use std::collections::HashMap;
use std::io::{Cursor, Read};

use serde::{Deserialize, Serialize};

use crate::record_layout::LAYOUT;

#[path = "journey_columns_decode.rs"]
mod decode;

/// A column as it goes to the file. `Bytes`, `Words` and `Blob` are stored as
/// runs when that pays (`record-layout.json` says when); `Plain` holds bytes of
/// its own, a part of a record, and is stored as it is.
pub enum Column {
    Bytes(&'static str, Vec<u8>),
    Words(&'static str, Vec<u32>),
    Blob(&'static str, Vec<u8>, Vec<u32>),
    Plain(&'static str, Vec<u8>),
}

#[derive(Serialize, Deserialize)]
struct Section {
    name: String,
    offset: usize,
    length: usize,
    width: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    rows: Option<usize>,
}

#[derive(Serialize, Deserialize)]
struct Header {
    version: u8,
    sections: Vec<Section>,
}

/// A column as it is written: its bytes, packed where packing is smaller.
/// Only the form written is kept, so encoding a record holds it once.
struct Stored {
    name: &'static str,
    width: u8,
    rows: usize,
    bytes: Vec<u8>,
    packed: bool,
}

pub fn encode(columns: Vec<Column>, version: u8) -> Result<Vec<u8>, String> {
    let stored: Vec<Stored> = columns.into_iter().map(store).collect::<Result<_, _>>()?;
    let mut offset = 0;
    let sections = stored
        .iter()
        .map(|column| {
            let section = Section {
                name: column.name.to_owned(),
                offset,
                length: column.bytes.len(),
                width: column.width,
                rows: column.packed.then_some(column.rows),
            };
            offset = aligned(offset + column.bytes.len());
            section
        })
        .collect();
    let header = serde_json::to_vec(&Header { version, sections })
        .map_err(|error| format!("cannot encode journey header: {error}"))?;
    let header_length = aligned(4 + header.len()) - 4;
    let mut out = Vec::with_capacity(4 + header_length + offset);
    out.extend_from_slice(&(header_length as u32).to_le_bytes());
    out.extend_from_slice(&header);
    out.resize(4 + header_length, 0);
    for column in stored {
        out.extend_from_slice(&column.bytes);
        let end = aligned(out.len());
        out.resize(end, 0);
    }
    Ok(out)
}

pub struct Decoded {
    columns: HashMap<String, Plain>,
}

/// A column decoded: words where it is four bytes wide, its bytes otherwise.
enum Plain {
    Bytes(u8, Vec<u8>),
    Words(Vec<u32>),
}

impl Decoded {
    /// Whether no column was decoded: the bytes held none of those asked for.
    pub fn is_empty(&self) -> bool {
        self.columns.is_empty()
    }

    pub fn has(&self, name: &str) -> bool {
        self.columns.contains_key(name)
    }

    /// Every column the file holds, by name.
    pub fn names(&self) -> Vec<&String> {
        self.columns.keys().collect()
    }

    fn column(&self, name: &str) -> Result<&Plain, String> {
        self.columns.get(name).ok_or_else(|| format!("journey artifact has no {name} column"))
    }

    /// A width-1 column's bytes, borrowed.
    pub fn held(&self, name: &str) -> Result<&[u8], String> {
        match self.column(name)? {
            Plain::Bytes(1, bytes) => Ok(bytes),
            _ => Err(format!("journey artifact column {name} has the wrong width")),
        }
    }

    pub fn bytes(&self, name: &str) -> Result<Vec<u8>, String> {
        self.held(name).map(<[u8]>::to_vec)
    }

    /// A column of bytes or of words, widened to words.
    pub fn values(&self, name: &str) -> Result<Vec<u32>, String> {
        match self.columns.get(name) {
            Some(Plain::Bytes(1, bytes)) => Ok(bytes.iter().map(|byte| u32::from(*byte)).collect()),
            _ => self.words(name),
        }
    }

    pub fn words(&self, name: &str) -> Result<Vec<u32>, String> {
        match self.column(name)? {
            Plain::Words(words) => Ok(words.clone()),
            Plain::Bytes(..) => Err(format!("journey artifact column {name} has the wrong width")),
        }
    }

    /// A width-1 column's bytes, moved out, so a reader does not hold it twice.
    pub fn take_bytes(&mut self, name: &str) -> Result<Vec<u8>, String> {
        match self.columns.remove(name) {
            Some(Plain::Bytes(1, bytes)) => Ok(bytes),
            _ => Err(format!("journey artifact has no {name} column of bytes")),
        }
    }

    /// A width-4 column's words, moved out.
    pub fn take_words(&mut self, name: &str) -> Result<Vec<u32>, String> {
        match self.columns.remove(name) {
            Some(Plain::Words(words)) => Ok(words),
            _ => Err(format!("journey artifact has no {name} column of words")),
        }
    }
}

/// One column as the header places it: where its stored bytes are, and how
/// many rows they decode to — `None` for a column stored plain.
pub(crate) struct Placed {
    pub name: String,
    pub width: u8,
    pub rows: Option<usize>,
    pub stored: std::ops::Range<usize>,
}

/// Every column the header names, placed in `bytes` and not decoded, and the
/// version the header states, whatever it is.
pub(crate) fn framed(bytes: &[u8]) -> Result<(u8, Vec<Placed>), String> {
    framed_within(bytes, bytes.len())
}

/// [`framed`] for a file of `length` bytes of which `bytes` holds a prefix at
/// least as long as its header: the sections are placed against the whole file.
pub(crate) fn framed_within(bytes: &[u8], length: usize) -> Result<(u8, Vec<Placed>), String> {
    let refused = || "not a variance-authority journey artifact".to_owned();
    let header_length = u32::from_le_bytes(bytes.get(..4).ok_or_else(refused)?.try_into().unwrap_or_default()) as usize;
    let fits = header_length != 0 && header_length <= length.saturating_sub(4);
    let held = bytes.get(4..4 + header_length).filter(|_| fits).ok_or_else(refused)?;
    let header_end = held.iter().position(|byte| *byte == 0).unwrap_or(header_length);
    let header: Header = serde_json::from_slice(&held[..header_end]).map_err(|_| refused())?;
    let base = 4 + header_length;
    let placed = header
        .sections
        .into_iter()
        .map(|section| {
            let end = section
                .offset
                .checked_add(section.length)
                .filter(|end| *end <= length - base)
                .ok_or_else(refused)?;
            Ok(Placed {
                name: section.name,
                width: section.width,
                rows: section.rows,
                stored: base + section.offset..base + end,
            })
        })
        .collect::<Result<_, String>>()?;
    Ok((header.version, placed))
}

/// Every column the header names, placed in `bytes` and not decoded.
pub(crate) fn place(bytes: &[u8], version: u8) -> Result<Vec<Placed>, String> {
    let (stated, placed) = framed(bytes)?;
    if stated != version {
        return Err(format!("unsupported journey artifact version: {stated}"));
    }
    Ok(placed)
}

/// The case index a recording holds: the `cases` section when `bytes` are a
/// coverage record that carries one, and `bytes` themselves otherwise, which
/// the journey reader then opens or refuses on its own terms.
pub(crate) fn recorded_cases(bytes: Vec<u8>) -> Vec<u8> {
    match cases_section(&bytes) {
        Some(stored) => bytes[stored].to_vec(),
        None => bytes,
    }
}

/// [`recorded_cases`] for a caller that holds the bytes elsewhere: the part of
/// `bytes` that is the case index, borrowed.
pub(crate) fn recorded_cases_in(bytes: &[u8]) -> &[u8] {
    match cases_section(bytes) {
        Some(stored) => &bytes[stored],
        None => bytes,
    }
}

fn cases_section(bytes: &[u8]) -> Option<std::ops::Range<usize>> {
    let index = LAYOUT.coverage.part("index");
    framed(bytes).ok().and_then(|(_, placed)| {
        placed.into_iter().find(|column| column.name == index && column.rows.is_none()).map(|column| column.stored)
    })
}

/// The version a container's header names, or nothing when `bytes` are not one.
pub(crate) fn version_of(bytes: &[u8]) -> Option<u8> {
    framed(bytes).ok().map(|(version, _)| version)
}

pub fn decode(bytes: &[u8], version: u8) -> Result<Decoded, String> {
    decode::decode_placed(bytes, place(bytes, version)?)
}

/// Every column of a framed file at whatever version its header states, with
/// that version: the caller decides which it reads.
pub fn decode_any(bytes: &[u8]) -> Result<(u8, Decoded), String> {
    let (version, placed) = framed(bytes)?;
    Ok((version, decode::decode_placed(bytes, placed)?))
}

/// The columns named in `wanted` of a container in whatever version its header
/// names, decoded, and that version: a reader that asks a few columns of a large
/// record decompresses those, and judges the version itself.
pub(crate) fn decode_wanted(bytes: &[u8], wanted: &[&str]) -> Result<(u8, Decoded), String> {
    let (version, placed) = framed(bytes)?;
    let placed = placed.into_iter().filter(|column| wanted.contains(&column.name.as_str())).collect();
    Ok((version, decode::decode_placed(bytes, placed)?))
}

fn store(column: Column) -> Result<Stored, String> {
    let pack_above = LAYOUT.pack_above;
    match column {
        Column::Bytes(name, bytes) => {
            let packed = (bytes.len() > pack_above).then(|| pack_byte_runs(&bytes, LAYOUT.levels.numbers)).transpose()?;
            Ok(smaller(name, 1, bytes.len(), bytes, packed))
        }
        Column::Words(name, words) => {
            let rows = words.len();
            let packed = (rows * 4 > pack_above).then(|| pack_word_runs(&words)).transpose()?.filter(|packed| packed.len() < rows * 4);
            Ok(match packed {
                Some(bytes) => Stored { name, width: 4, rows, bytes, packed: true },
                None => Stored { name, width: 4, rows, bytes: words.iter().flat_map(|word| word.to_le_bytes()).collect(), packed: false },
            })
        }
        Column::Blob(name, bytes, offsets) => {
            let packed = (bytes.len() > pack_above).then(|| pack_blob_runs(&bytes, &offsets)).transpose()?;
            Ok(smaller(name, 1, bytes.len(), bytes, packed))
        }
        Column::Plain(name, bytes) => Ok(Stored { name, width: 1, rows: bytes.len(), bytes, packed: false }),
    }
}

/// The packed form of a column where it is smaller than `plain`, else `plain`.
fn smaller(name: &'static str, width: u8, rows: usize, plain: Vec<u8>, packed: Option<Vec<u8>>) -> Stored {
    match packed.filter(|packed| packed.len() < plain.len()) {
        Some(bytes) => Stored { name, width, rows, bytes, packed: true },
        None => Stored { name, width, rows, bytes: plain, packed: false },
    }
}

fn pack_word_runs(values: &[u32]) -> Result<Vec<u8>, String> {
    let mut runs = Vec::new();
    for values in values.chunks(LAYOUT.run) {
        runs.push(compress(&varints(values), LAYOUT.levels.numbers)?);
    }
    Ok(lay(runs))
}

fn pack_byte_runs(values: &[u8], level: i32) -> Result<Vec<u8>, String> {
    let mut runs = Vec::new();
    for values in values.chunks(LAYOUT.run) {
        runs.push(compress(values, level)?);
    }
    Ok(lay(runs))
}

fn pack_blob_runs(values: &[u8], offsets: &[u32]) -> Result<Vec<u8>, String> {
    let blob_run = LAYOUT.blob_run;
    let mut runs = Vec::new();
    for first in (0..offsets.len().saturating_sub(1)).step_by(blob_run) {
        let last = (first + blob_run).min(offsets.len() - 1);
        let from = offsets[first] as usize;
        let to = offsets[last] as usize;
        if to < from || to > values.len() {
            return Err("journey blob offsets are invalid".to_owned());
        }
        runs.push(compress(&values[from..to], LAYOUT.levels.text)?);
    }
    Ok(lay(runs))
}

fn lay(runs: Vec<Vec<u8>>) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&(runs.len() as u32).to_le_bytes());
    let mut offset = 0_u32;
    for run in &runs {
        out.extend_from_slice(&offset.to_le_bytes());
        offset += run.len() as u32;
    }
    out.extend_from_slice(&offset.to_le_bytes());
    for run in runs {
        out.extend_from_slice(&run);
    }
    out
}

fn compress(bytes: &[u8], level: i32) -> Result<Vec<u8>, String> {
    let packed = zstd::stream::encode_all(Cursor::new(bytes), level)
        .map_err(|error| format!("cannot compress journey column: {error}"))?;
    let mut out = Vec::with_capacity(1 + packed.len().min(bytes.len()));
    if packed.len() < bytes.len() {
        out.push(LAYOUT.codecs.zstd);
        out.extend_from_slice(&packed);
    } else {
        out.push(LAYOUT.codecs.raw);
        out.extend_from_slice(bytes);
    }
    Ok(out)
}

/// The most bytes one run of words can decode to: a varint is at most five bytes.
pub(crate) fn word_run_limit() -> usize {
    LAYOUT.run * 5
}

pub(crate) fn runs(stored: &[u8], expected: usize) -> Result<Vec<&[u8]>, String> {
    if stored.len() < 4 {
        return Err("journey run column is truncated".to_owned());
    }
    let count = u32::from_le_bytes(stored[..4].try_into().unwrap_or_default()) as usize;
    if count != expected {
        return Err("journey run column has an invalid index".to_owned());
    }
    runs_any(stored)
}

pub(crate) fn runs_any(stored: &[u8]) -> Result<Vec<&[u8]>, String> {
    if stored.len() < 4 {
        return Err("journey run column is truncated".to_owned());
    }
    let count = u32::from_le_bytes(stored[..4].try_into().unwrap_or_default()) as usize;
    let table = count
        .checked_add(1)
        .and_then(|bounds| bounds.checked_mul(4))
        .and_then(|bytes| bytes.checked_add(4))
        .filter(|end| *end <= stored.len())
        .ok_or_else(|| "journey run column has an invalid index".to_owned())?;
    let index = &stored[4..table];
    let body = &stored[table..];
    let mut out = Vec::with_capacity(count);
    for at in 0..count {
        let from = u32::from_le_bytes(index[at * 4..at * 4 + 4].try_into().unwrap_or_default()) as usize;
        let to = u32::from_le_bytes(index[(at + 1) * 4..(at + 2) * 4].try_into().unwrap_or_default()) as usize;
        if to < from || to > body.len() {
            return Err("journey run column has invalid bounds".to_owned());
        }
        out.push(&body[from..to]);
    }
    Ok(out)
}

/// One run's bytes, refused once they would decode past `limit`: a run holds
/// at most what its column says one run holds, so a run that decodes to more
/// is damage, and is stopped before it is held.
pub(crate) fn decompress(run: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    let too_long = || "journey column run decodes past its length".to_owned();
    match run.split_first() {
        Some((tag, bytes)) if *tag == LAYOUT.codecs.raw => {
            if bytes.len() > limit {
                return Err(too_long());
            }
            Ok(bytes.to_vec())
        }
        Some((tag, bytes)) if *tag == LAYOUT.codecs.zstd => {
            let decoder = zstd::stream::read::Decoder::new(Cursor::new(bytes))
                .map_err(|error| format!("cannot decompress journey column: {error}"))?;
            let mut out = Vec::new();
            decoder
                .take(limit as u64 + 1)
                .read_to_end(&mut out)
                .map_err(|error| format!("cannot decompress journey column: {error}"))?;
            if out.len() > limit {
                return Err(too_long());
            }
            Ok(out)
        }
        _ => Err("journey column uses an unknown codec".to_owned()),
    }
}

fn varints(values: &[u32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(values.len() * 2);
    let mut previous = 0_u32;
    for value in values {
        let delta = value.wrapping_sub(previous);
        previous = *value;
        let mut zigzag = (delta << 1) ^ ((delta as i32 >> 31) as u32);
        while zigzag > 0x7f {
            out.push((zigzag as u8 & 0x7f) | 0x80);
            zigzag >>= 7;
        }
        out.push(zigzag as u8);
    }
    out
}

pub(crate) fn unvarints(bytes: &[u8], rows: usize) -> Result<Vec<u32>, String> {
    let mut out = Vec::with_capacity(rows.min(bytes.len()));
    let mut at = 0;
    let mut previous = 0_u32;
    for _ in 0..rows {
        let mut raw = 0_u32;
        let mut shift = 0;
        loop {
            let byte = *bytes.get(at).ok_or_else(|| "journey varints are truncated".to_owned())?;
            at += 1;
            raw |= u32::from(byte & 0x7f) << shift;
            if byte < 0x80 {
                break;
            }
            shift += 7;
            if shift > 28 {
                return Err("journey varint is too wide".to_owned());
            }
        }
        let delta = (raw >> 1) ^ (0_u32.wrapping_sub(raw & 1));
        previous = previous.wrapping_add(delta);
        out.push(previous);
    }
    if at != bytes.len() {
        return Err("journey varints have trailing bytes".to_owned());
    }
    Ok(out)
}

fn aligned(value: usize) -> usize {
    let alignment = LAYOUT.alignment;
    value.div_ceil(alignment) * alignment
}

#[cfg(test)]
#[path = "journey_columns_tests.rs"]
mod tests;
