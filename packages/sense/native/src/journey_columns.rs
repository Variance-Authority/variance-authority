use std::collections::HashMap;
use std::io::Cursor;

use serde::{Deserialize, Serialize};

const ALIGNMENT: usize = 8;
const PACK_ABOVE: usize = 1 << 16;
pub(crate) const RUN: usize = 4096;
pub(crate) const BLOB_RUN: usize = 512;
const RAW: u8 = 0;
const ZSTD: u8 = 2;

pub enum Column {
    Bytes(&'static str, Vec<u8>),
    Words(&'static str, Vec<u32>),
    Blob(&'static str, Vec<u8>, Vec<u32>),
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

struct Stored {
    name: &'static str,
    width: u8,
    rows: usize,
    bytes: Vec<u8>,
    packed: Option<Vec<u8>>,
}

pub fn encode(columns: Vec<Column>, version: u8) -> Result<Vec<u8>, String> {
    let stored: Vec<Stored> = columns.into_iter().map(store).collect::<Result<_, _>>()?;
    let mut offset = 0;
    let sections = stored
        .iter()
        .map(|column| {
            let bytes = column.packed.as_ref().unwrap_or(&column.bytes);
            let section = Section {
                name: column.name.to_owned(),
                offset,
                length: bytes.len(),
                width: column.width,
                rows: column.packed.as_ref().map(|_| column.rows),
            };
            offset = aligned(offset + bytes.len());
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
        out.extend_from_slice(column.packed.as_ref().unwrap_or(&column.bytes));
        let end = aligned(out.len());
        out.resize(end, 0);
    }
    Ok(out)
}

pub struct Decoded {
    columns: HashMap<String, (u8, Vec<u8>)>,
}

impl Decoded {
    pub fn has(&self, name: &str) -> bool {
        self.columns.contains_key(name)
    }

    pub fn bytes(&self, name: &str) -> Result<Vec<u8>, String> {
        let (width, bytes) = self
            .columns
            .get(name)
            .ok_or_else(|| format!("journey artifact has no {name} column"))?;
        if *width != 1 {
            return Err(format!("journey artifact column {name} has the wrong width"));
        }
        Ok(bytes.clone())
    }

    pub fn words(&self, name: &str) -> Result<Vec<u32>, String> {
        let (width, bytes) = self
            .columns
            .get(name)
            .ok_or_else(|| format!("journey artifact has no {name} column"))?;
        if *width != 4 || bytes.len() % 4 != 0 {
            return Err(format!("journey artifact column {name} has the wrong width"));
        }
        Ok(bytes
            .chunks_exact(4)
            .map(|word| u32::from_le_bytes(word.try_into().unwrap_or_default()))
            .collect())
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

/// A header read and not yet placed: the version it names, where its sections
/// begin, and the sections themselves.
pub(crate) struct Head {
    pub version: u8,
    base: usize,
    sections: Vec<Section>,
}

/// The header at the front of `bytes`, which need hold no more of the file than
/// the header itself: its four-byte length and the JSON that length covers.
/// Nothing when those bytes are not a header.
pub(crate) fn head(bytes: &[u8]) -> Option<Head> {
    let length = u32::from_le_bytes(bytes.get(..4)?.try_into().ok()?) as usize;
    if length == 0 || 4 + length > bytes.len() {
        return None;
    }
    let end = bytes[4..4 + length].iter().position(|byte| *byte == 0).map_or(4 + length, |at| 4 + at);
    let header: Header = serde_json::from_slice(&bytes[4..end]).ok()?;
    Some(Head { version: header.version, base: 4 + length, sections: header.sections })
}

/// How long a header is with its length prefix, from the prefix alone.
pub(crate) fn head_length(prefix: &[u8]) -> Option<usize> {
    let length = u32::from_le_bytes(prefix.get(..4)?.try_into().ok()?) as usize;
    (length != 0).then_some(4 + length)
}

impl Head {
    /// Every section placed in a file of `length` bytes; nothing when one of
    /// them lies outside it.
    pub fn place(self, length: usize) -> Option<Vec<Placed>> {
        let base = self.base;
        self.sections
            .into_iter()
            .map(|section| {
                let start = base.checked_add(section.offset)?;
                let end = start.checked_add(section.length).filter(|end| *end <= length)?;
                Some(Placed { name: section.name, width: section.width, rows: section.rows, stored: start..end })
            })
            .collect()
    }
}

/// Every column the header names, placed in `bytes` and not decoded.
pub(crate) fn place(bytes: &[u8], version: u8) -> Result<Vec<Placed>, String> {
    let not_ours = || "not a variance-authority journey artifact".to_owned();
    let head = head(bytes).ok_or_else(not_ours)?;
    if head.version != version {
        return Err(format!("unsupported journey artifact version: {}", head.version));
    }
    head.place(bytes.len()).ok_or_else(not_ours)
}

/// The case index a recording holds: the `cases` section when `bytes` are a
/// coverage record that carries one, and `bytes` themselves otherwise, which
/// the journey reader then opens or refuses on its own terms.
pub(crate) fn recorded_cases(bytes: Vec<u8>) -> Vec<u8> {
    let cases = head(&bytes).and_then(|head| head.place(bytes.len())).and_then(|placed| {
        placed.into_iter().find(|column| column.name == "cases" && column.rows.is_none())
    });
    match cases {
        Some(column) => bytes[column.stored].to_vec(),
        None => bytes,
    }
}

pub fn decode(bytes: &[u8], version: u8) -> Result<Decoded, String> {
    let mut columns = HashMap::new();
    for column in place(bytes, version)? {
        let stored = &bytes[column.stored];
        let plain = match column.rows {
            None => stored.to_vec(),
            Some(rows) if column.width == 4 => unpack_words(stored, rows)?,
            Some(rows) if column.name.ends_with(".blob") => unpack_blob(stored, rows)?,
            Some(rows) => unpack_bytes(stored, rows)?,
        };
        if columns.insert(column.name, (column.width, plain)).is_some() {
            return Err("journey artifact repeats a column".to_owned());
        }
    }
    Ok(Decoded { columns })
}

fn store(column: Column) -> Result<Stored, String> {
    match column {
        Column::Bytes(name, bytes) => {
            let rows = bytes.len();
            let packed = (bytes.len() > PACK_ABOVE)
                .then(|| pack_byte_runs(&bytes, 6))
                .transpose()?
                .filter(|packed| packed.len() < bytes.len());
            Ok(Stored { name, width: 1, rows, bytes, packed })
        }
        Column::Words(name, words) => {
            let rows = words.len();
            let mut bytes = Vec::with_capacity(rows * 4);
            for word in &words {
                bytes.extend_from_slice(&word.to_le_bytes());
            }
            let packed = (bytes.len() > PACK_ABOVE)
                .then(|| pack_word_runs(&words))
                .transpose()?
                .filter(|packed| packed.len() < bytes.len());
            Ok(Stored { name, width: 4, rows, bytes, packed })
        }
        Column::Blob(name, bytes, offsets) => {
            let rows = bytes.len();
            let packed = (bytes.len() > PACK_ABOVE)
                .then(|| pack_blob_runs(&bytes, &offsets))
                .transpose()?
                .filter(|packed| packed.len() < bytes.len());
            Ok(Stored { name, width: 1, rows, bytes, packed })
        }
    }
}

fn pack_word_runs(values: &[u32]) -> Result<Vec<u8>, String> {
    let mut runs = Vec::new();
    for values in values.chunks(RUN) {
        runs.push(compress(&varints(values), 6)?);
    }
    Ok(lay(runs))
}

fn pack_byte_runs(values: &[u8], level: i32) -> Result<Vec<u8>, String> {
    let mut runs = Vec::new();
    for values in values.chunks(RUN) {
        runs.push(compress(values, level)?);
    }
    Ok(lay(runs))
}

fn pack_blob_runs(values: &[u8], offsets: &[u32]) -> Result<Vec<u8>, String> {
    let mut runs = Vec::new();
    for first in (0..offsets.len().saturating_sub(1)).step_by(BLOB_RUN) {
        let last = (first + BLOB_RUN).min(offsets.len() - 1);
        let from = offsets[first] as usize;
        let to = offsets[last] as usize;
        if to < from || to > values.len() {
            return Err("journey blob offsets are invalid".to_owned());
        }
        runs.push(compress(&values[from..to], 1)?);
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
        out.push(ZSTD);
        out.extend_from_slice(&packed);
    } else {
        out.push(RAW);
        out.extend_from_slice(bytes);
    }
    Ok(out)
}

fn unpack_words(stored: &[u8], rows: usize) -> Result<Vec<u8>, String> {
    let runs = runs(stored, rows.div_ceil(RUN))?;
    let mut out = Vec::with_capacity(rows * 4);
    let mut remaining = rows;
    for run in runs {
        let values = unvarints(&decompress(run)?, remaining.min(RUN))?;
        for value in values {
            out.extend_from_slice(&value.to_le_bytes());
        }
        remaining = remaining.saturating_sub(RUN);
    }
    Ok(out)
}

fn unpack_bytes(stored: &[u8], rows: usize) -> Result<Vec<u8>, String> {
    let runs = runs(stored, rows.div_ceil(RUN))?;
    let mut out = Vec::with_capacity(rows);
    for run in runs {
        out.extend_from_slice(&decompress(run)?);
    }
    if out.len() != rows {
        return Err("journey byte column has the wrong length".to_owned());
    }
    Ok(out)
}

fn unpack_blob(stored: &[u8], rows: usize) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(rows);
    for run in runs_any(stored)? {
        out.extend_from_slice(&decompress(run)?);
    }
    if out.len() != rows {
        return Err("journey blob column has the wrong length".to_owned());
    }
    Ok(out)
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
    if 4 + (count + 1) * 4 > stored.len() {
        return Err("journey run column has an invalid index".to_owned());
    }
    let index = &stored[4..4 + (count + 1) * 4];
    let body = &stored[4 + (count + 1) * 4..];
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

pub(crate) fn decompress(run: &[u8]) -> Result<Vec<u8>, String> {
    match run.split_first() {
        Some((tag, bytes)) if *tag == RAW => Ok(bytes.to_vec()),
        Some((tag, bytes)) if *tag == ZSTD => zstd::stream::decode_all(Cursor::new(bytes))
            .map_err(|error| format!("cannot decompress journey column: {error}")),
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
    let mut out = Vec::with_capacity(rows);
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
    (value + ALIGNMENT - 1) & !(ALIGNMENT - 1)
}
