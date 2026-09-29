//! A journey file's columns, decompressed a run at a time as a question reaches them.
//!
//! The writer packs every large column into independently compressed runs —
//! 4096 rows of a word or byte column, 512 strings of a blob — behind an index
//! of where each run starts. A question about one file needs that file's module
//! row, its regions and their sets, and the tests they name: a handful of runs
//! out of the hundreds a stitched file holds. Decoding the whole file for it
//! spent two thirds of the time on region columns nothing asked about, so a run
//! is decompressed the first time a row inside it is read and kept for the life
//! of the reading, and a string is a slice of its run rather than a copy.

use std::cell::OnceCell;
use std::collections::HashMap;

use crate::journey_columns::{self, BLOB_RUN, RUN};

enum Body {
    /// Stored as written: the column is small enough that packing did not pay.
    Plain(std::ops::Range<usize>),
    /// Independently compressed runs, each decoded once when first read.
    Runs {
        runs: Vec<std::ops::Range<usize>>,
        words: Vec<OnceCell<Vec<u32>>>,
        bytes: Vec<OnceCell<Vec<u8>>>,
    },
}

struct Column {
    width: u8,
    /// Words or bytes for a word or byte column; bytes for a blob.
    rows: usize,
    body: Body,
}

/// The file, and every column placed in it but not yet read.
pub(crate) struct Lazy {
    bytes: Vec<u8>,
    columns: Vec<Column>,
    named: HashMap<String, usize>,
}

/// A column of a [`Lazy`], resolved by name once.
#[derive(Clone, Copy)]
pub(crate) struct Handle(usize);

impl Lazy {
    pub fn new(bytes: Vec<u8>, version: u8) -> Result<Lazy, String> {
        let mut columns = Vec::new();
        let mut named = HashMap::new();
        for placed in journey_columns::place(&bytes, version)? {
            let stored = placed.stored.clone();
            let (rows, body) = match placed.rows {
                None => (stored.len() / usize::from(placed.width.max(1)), Body::Plain(stored)),
                Some(rows) => {
                    let index = if placed.name.ends_with(".blob") {
                        journey_columns::runs_any(&bytes[stored])?
                    } else {
                        journey_columns::runs(&bytes[stored], rows.div_ceil(RUN))?
                    };
                    let runs: Vec<_> = index
                        .iter()
                        .map(|run| {
                            let from = run.as_ptr() as usize - bytes.as_ptr() as usize;
                            from..from + run.len()
                        })
                        .collect();
                    let count = runs.len();
                    let body = Body::Runs {
                        runs,
                        words: (0..count).map(|_| OnceCell::new()).collect(),
                        bytes: (0..count).map(|_| OnceCell::new()).collect(),
                    };
                    (rows, body)
                }
            };
            if named.insert(placed.name, columns.len()).is_some() {
                return Err("journey artifact repeats a column".to_owned());
            }
            columns.push(Column { width: placed.width, rows, body });
        }
        Ok(Lazy { bytes, columns, named })
    }

    pub fn has(&self, name: &str) -> bool {
        self.named.contains_key(name)
    }

    pub fn column(&self, name: &str, width: u8) -> Result<Handle, String> {
        let &at = self.named.get(name).ok_or_else(|| format!("journey artifact has no {name} column"))?;
        if self.columns[at].width != width {
            return Err(format!("journey artifact column {name} has the wrong width"));
        }
        Ok(Handle(at))
    }

    pub fn rows(&self, column: Handle) -> usize {
        self.columns[column.0].rows
    }

    pub fn word(&self, column: Handle, row: usize) -> Result<u32, String> {
        let held = &self.columns[column.0];
        if row >= held.rows {
            return Err("journey row is out of bounds".to_owned());
        }
        match &held.body {
            Body::Plain(stored) => {
                let at = stored.start + row * 4;
                Ok(u32::from_le_bytes(self.bytes[at..at + 4].try_into().unwrap_or_default()))
            }
            Body::Runs { runs, words, .. } => {
                let run = row / RUN;
                let values = get_or_try(&words[run], || {
                    let rows = RUN.min(held.rows - run * RUN);
                    journey_columns::unvarints(&journey_columns::decompress(&self.bytes[runs[run].clone()])?, rows)
                })?;
                Ok(values[row % RUN])
            }
        }
    }

    pub fn byte(&self, column: Handle, row: usize) -> Result<u8, String> {
        let held = &self.columns[column.0];
        if row >= held.rows {
            return Err("journey row is out of bounds".to_owned());
        }
        match &held.body {
            Body::Plain(stored) => Ok(self.bytes[stored.start + row]),
            Body::Runs { runs, bytes, .. } => {
                let run = row / RUN;
                let values = get_or_try(&bytes[run], || {
                    let decoded = journey_columns::decompress(&self.bytes[runs[run].clone()])?;
                    if decoded.len() != RUN.min(held.rows - run * RUN) {
                        return Err("journey byte column has the wrong length".to_owned());
                    }
                    Ok(decoded)
                })?;
                Ok(values[row % RUN])
            }
        }
    }

    /// Entry `id` of a blob, bounded by its offset column.
    pub fn entry(&self, blob: Handle, offsets: Handle, id: usize) -> Result<&[u8], String> {
        if id + 1 >= self.rows(offsets) {
            return Err(format!("journey entry {id} is out of bounds"));
        }
        let from = self.word(offsets, id)? as usize;
        let to = self.word(offsets, id + 1)? as usize;
        if to < from {
            return Err("journey entry bounds are invalid".to_owned());
        }
        let held = &self.columns[blob.0];
        match &held.body {
            Body::Plain(stored) => {
                if to > stored.len() {
                    return Err("journey entry bounds are invalid".to_owned());
                }
                Ok(&self.bytes[stored.start + from..stored.start + to])
            }
            Body::Runs { runs, bytes, .. } => {
                let run = id / BLOB_RUN;
                let first = run * BLOB_RUN;
                let base = self.word(offsets, first)? as usize;
                let last = (first + BLOB_RUN).min(self.rows(offsets) - 1);
                let end = self.word(offsets, last)? as usize;
                let values = get_or_try(&bytes[run], || {
                    let decoded = journey_columns::decompress(&self.bytes[runs[run].clone()])?;
                    if decoded.len() != end.saturating_sub(base) {
                        return Err("journey blob column has the wrong length".to_owned());
                    }
                    Ok(decoded)
                })?;
                values.get(from - base..to - base).ok_or_else(|| "journey entry bounds are invalid".to_owned())
            }
        }
    }
}

fn get_or_try<T>(cell: &OnceCell<T>, make: impl FnOnce() -> Result<T, String>) -> Result<&T, String> {
    if let Some(value) = cell.get() {
        return Ok(value);
    }
    let value = make()?;
    Ok(cell.get_or_init(|| value))
}
