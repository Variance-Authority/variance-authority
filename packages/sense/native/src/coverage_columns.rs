//! A coverage record's columns, read through a door onto wherever the record is.
//!
//! A selection reads a twentieth of a record, so the record is not handed over
//! whole: the reader asks for a range of bytes at a time — the header, a run
//! index, one run — and the caller answers from the file or from memory it
//! already holds. A run is decompressed the first time a row inside it is read
//! and kept for as long as the reader is, which is as long as the record is
//! open, so a row a hundred searches probe is decoded once.
//!
//! The codec is the journey artifact's, and so is the header: one layout,
//! written by the same packers, with a version of its own.

// compass: variance-authority.reach

use std::cell::OnceCell;
use std::collections::HashMap;
use std::ops::Range;

use napi::{Error, Result};

use crate::journey_columns::{self, BLOB_RUN, RUN};

/// What a record that is not one this reader can read is called, in the same
/// words the JavaScript reader uses for it.
pub(crate) const NOT_A_RECORD: &str = "not a variance-authority test coverage artifact";

/// The layouts this reader opens: the current one, the one before the case
/// sections, and the one before durations. Every section read here means the
/// same in all three.
const READABLE: [u8; 3] = [10, 9, 8];

pub(crate) fn invalid() -> Error {
    Error::from_reason(NOT_A_RECORD)
}

/// Where the record's bytes are.
pub(crate) trait Door {
    /// The bytes in `[from, to)`, exactly that many of them.
    fn read(&self, from: usize, to: usize) -> Result<Vec<u8>>;
}

/// A record already in memory.
impl Door for Vec<u8> {
    fn read(&self, from: usize, to: usize) -> Result<Vec<u8>> {
        self.get(from..to).map(<[u8]>::to_vec).ok_or_else(invalid)
    }
}

enum WordBody {
    Plain(Vec<u32>),
    Runs { runs: Vec<Range<usize>>, decoded: Vec<OnceCell<Vec<u32>>> },
}

/// A column of `u32`, read by the row.
pub(crate) struct Words {
    rows: usize,
    stored: Range<usize>,
    packed: bool,
    /// Every value is below this, when the column holds ids into something.
    bound: Option<u32>,
    body: OnceCell<WordBody>,
}

enum BlobBody {
    Plain(Vec<u8>),
    Runs { runs: Vec<Range<usize>>, decoded: Vec<OnceCell<Vec<u8>>> },
}

/// Variable-length entries end to end, cut by a column of offsets.
pub(crate) struct Blob {
    stored: Range<usize>,
    packed: bool,
    body: OnceCell<BlobBody>,
}

/// Every section of one record, placed and not read.
pub(crate) struct Sections {
    placed: HashMap<String, (Range<usize>, u8, Option<usize>)>,
}

impl Sections {
    /// The header, read through the door: four bytes, then the JSON they size.
    pub fn open(door: &dyn Door, length: usize) -> Result<Sections> {
        if length < 4 {
            return Err(invalid());
        }
        let size = journey_columns::head_length(&door.read(0, 4)?).filter(|size| *size <= length).ok_or_else(invalid)?;
        let head = journey_columns::head(&door.read(0, size)?).ok_or_else(invalid)?;
        if !READABLE.contains(&head.version) {
            return Err(Error::from_reason(format!("unsupported test coverage version: {}", head.version)));
        }
        let placed = head
            .place(length)
            .ok_or_else(invalid)?
            .into_iter()
            .map(|section| (section.name, (section.stored, section.width, section.rows)))
            .collect();
        Ok(Sections { placed })
    }

    /// How many rows a section holds, as the header says.
    pub fn rows(&self, name: &str) -> Result<usize> {
        let (stored, width, rows) = self.placed.get(name).ok_or_else(invalid)?;
        match rows {
            Some(rows) => Ok(*rows),
            None if *width > 0 && stored.len() % usize::from(*width) == 0 => Ok(stored.len() / usize::from(*width)),
            None => Err(invalid()),
        }
    }

    /// A word column, whose values are all below `bound` when there is one.
    pub fn words(&self, name: &str, bound: Option<u32>) -> Result<Words> {
        let (stored, _, packed) = self.placed.get(name).ok_or_else(invalid)?;
        let rows = self.rows(name)?;
        if packed.is_none() && stored.len() != rows * 4 {
            return Err(invalid());
        }
        Ok(Words { rows, stored: stored.clone(), packed: packed.is_some(), bound, body: OnceCell::new() })
    }

    pub fn blob(&self, name: &str) -> Result<Blob> {
        let (stored, _, packed) = self.placed.get(name).ok_or_else(invalid)?;
        Ok(Blob { stored: stored.clone(), packed: packed.is_some(), body: OnceCell::new() })
    }
}

/// Where each run of a packed section lies in the file, from the section's index.
fn runs(door: &dyn Door, stored: &Range<usize>, expected: Option<usize>) -> Result<Vec<Range<usize>>> {
    if stored.len() < 4 {
        return Err(invalid());
    }
    let count = u32::from_le_bytes(door.read(stored.start, stored.start + 4)?.try_into().map_err(|_| invalid())?) as usize;
    if expected.is_some_and(|expected| expected != count) {
        return Err(invalid());
    }
    let index_end = (count + 1).checked_mul(4).and_then(|size| size.checked_add(4)).ok_or_else(invalid)?;
    if index_end > stored.len() {
        return Err(invalid());
    }
    let index = door.read(stored.start + 4, stored.start + index_end)?;
    let body = stored.start + index_end;
    let bound = |at: usize| u32::from_le_bytes(index[at * 4..at * 4 + 4].try_into().unwrap_or_default()) as usize;
    // The runs tile the section: the first starts where the index ends and the
    // last ends where the section does.
    if bound(0) != 0 || body + bound(count) != stored.end {
        return Err(invalid());
    }
    (0..count)
        .map(|at| {
            let (from, to) = (bound(at), bound(at + 1));
            if to < from || body + to > stored.end {
                return Err(invalid());
            }
            Ok(body + from..body + to)
        })
        .collect()
}

fn decompress(door: &dyn Door, run: &Range<usize>) -> Result<Vec<u8>> {
    journey_columns::decompress(&door.read(run.start, run.end)?).map_err(|_| invalid())
}

fn get_or_try<T>(cell: &OnceCell<T>, make: impl FnOnce() -> Result<T>) -> Result<&T> {
    if let Some(value) = cell.get() {
        return Ok(value);
    }
    let value = make()?;
    Ok(cell.get_or_init(|| value))
}

impl Words {
    pub fn rows(&self) -> usize {
        self.rows
    }

    fn checked(&self, values: Vec<u32>) -> Result<Vec<u32>> {
        match self.bound {
            Some(bound) if values.iter().any(|value| *value >= bound) => Err(invalid()),
            _ => Ok(values),
        }
    }

    fn body(&self, door: &dyn Door) -> Result<&WordBody> {
        get_or_try(&self.body, || {
            if !self.packed {
                let bytes = door.read(self.stored.start, self.stored.end)?;
                let values = bytes.chunks_exact(4).map(|word| u32::from_le_bytes(word.try_into().unwrap_or_default())).collect();
                return Ok(WordBody::Plain(self.checked(values)?));
            }
            let runs = runs(door, &self.stored, Some(self.rows.div_ceil(RUN)))?;
            let decoded = (0..runs.len()).map(|_| OnceCell::new()).collect();
            Ok(WordBody::Runs { runs, decoded })
        })
    }

    /// The value at `row`.
    pub fn at(&self, door: &dyn Door, row: usize) -> Result<u32> {
        if row >= self.rows {
            return Err(invalid());
        }
        match self.body(door)? {
            WordBody::Plain(values) => Ok(values[row]),
            WordBody::Runs { runs, decoded } => {
                let run = row / RUN;
                let values = get_or_try(&decoded[run], || {
                    let rows = RUN.min(self.rows - run * RUN);
                    let values = journey_columns::unvarints(&decompress(door, &runs[run])?, rows).map_err(|_| invalid())?;
                    self.checked(values)
                })?;
                Ok(values[row % RUN])
            }
        }
    }
}

impl Blob {
    /// Entry `id`, cut by `offsets`, which holds one more row than there are entries.
    pub fn entry<'a>(&'a self, door: &dyn Door, offsets: &Words, id: usize) -> Result<&'a [u8]> {
        if id + 1 >= offsets.rows() {
            return Err(invalid());
        }
        let from = offsets.at(door, id)? as usize;
        let to = offsets.at(door, id + 1)? as usize;
        if to < from {
            return Err(invalid());
        }
        let body = get_or_try(&self.body, || {
            if !self.packed {
                return Ok(BlobBody::Plain(door.read(self.stored.start, self.stored.end)?));
            }
            let runs = runs(door, &self.stored, None)?;
            let decoded = (0..runs.len()).map(|_| OnceCell::new()).collect();
            Ok(BlobBody::Runs { runs, decoded })
        })?;
        match body {
            BlobBody::Plain(bytes) => bytes.get(from..to).ok_or_else(invalid),
            BlobBody::Runs { runs, decoded } => {
                let run = id / BLOB_RUN;
                let first = run * BLOB_RUN;
                let base = offsets.at(door, first)? as usize;
                let cell = decoded.get(run).ok_or_else(invalid)?;
                let values = get_or_try(cell, || decompress(door, &runs[run]))?;
                if from < base {
                    return Err(invalid());
                }
                values.get(from - base..to - base).ok_or_else(invalid)
            }
        }
    }
}
