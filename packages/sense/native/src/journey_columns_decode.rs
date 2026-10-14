//! A framed file's columns decoded, each into a buffer an earlier decode left.
//!
//! A reader of many records of one shape — a fold of shards — decodes one,
//! lets it go, and decodes the next, of a little more or less than the last.
//! Freed and taken again at a slightly different size, the large blocks are
//! what an allocator holds on to rather than hand back: macOS's kept every
//! shard's columns resident, and sixteen shards held twice the fold's live
//! state. Kept and reused instead, a column's buffer is allocated once and
//! grows to the largest file the reader decodes.

use std::collections::HashMap;

use rayon::prelude::*;

use super::{decompress, runs, runs_any, unvarints, word_run_limit, Decoded, Placed, Plain};
use crate::record_layout::LAYOUT;

/// The buffers a decode may fill, by the column they last held. Empty, every
/// column is allocated as it decodes.
#[derive(Default)]
pub(crate) struct Spare {
    held: HashMap<String, Plain>,
}

impl Spare {
    /// `words`, column `name`'s, given back for the next decode of `name`.
    pub fn words(&mut self, name: &str, words: Vec<u32>) {
        self.held.insert(name.to_owned(), Plain::Words(words));
    }

    /// `bytes`, column `name`'s, given back for the next decode of `name`.
    pub fn bytes(&mut self, name: &str, bytes: Vec<u8>) {
        self.held.insert(name.to_owned(), Plain::Bytes(1, bytes));
    }

    fn take_words(&mut self, name: &str) -> Vec<u32> {
        match self.held.remove(name) {
            Some(Plain::Words(mut words)) => {
                words.clear();
                words
            }
            _ => Vec::new(),
        }
    }

    fn take_bytes(&mut self, name: &str) -> Vec<u8> {
        match self.held.remove(name) {
            Some(Plain::Bytes(_, mut bytes)) => {
                bytes.clear();
                bytes
            }
            _ => Vec::new(),
        }
    }
}

pub(super) fn decode_placed(bytes: &[u8], placed: Vec<Placed>, spare: &mut Spare) -> Result<Decoded, String> {
    let placed: Vec<(Placed, Vec<u32>, Vec<u8>)> = placed
        .into_iter()
        .map(|column| {
            let words = if column.width == 4 { spare.take_words(&column.name) } else { Vec::new() };
            let held = if column.width == 4 { Vec::new() } else { spare.take_bytes(&column.name) };
            (column, words, held)
        })
        .collect();
    // Columns decode apart, so a record's are decoded at once.
    let plain: Vec<(String, Plain)> = placed
        .into_par_iter()
        .map(|(column, mut words, mut held)| {
            let stored = &bytes[column.stored];
            let plain = match column.rows {
                None if column.width == 4 && stored.len() % 4 == 0 => {
                    words.extend(stored.chunks_exact(4).map(|word| u32::from_le_bytes(word.try_into().unwrap_or_default())));
                    Plain::Words(words)
                }
                None => {
                    held.extend_from_slice(stored);
                    Plain::Bytes(column.width, held)
                }
                Some(rows) if column.width == 4 => Plain::Words(unpack_words(stored, rows, words)?),
                Some(rows) if column.name.ends_with(".blob") => Plain::Bytes(column.width, unpack_blob(stored, rows, held)?),
                Some(rows) => Plain::Bytes(column.width, unpack_bytes(stored, rows, held)?),
            };
            Ok((column.name, plain))
        })
        .collect::<Result<_, String>>()?;
    let mut columns = HashMap::with_capacity(plain.len());
    for (name, plain) in plain {
        if columns.insert(name, plain).is_some() {
            return Err("journey artifact repeats a column".to_owned());
        }
    }
    Ok(Decoded { columns })
}

// No reservation below is sized by a count the file states: a count is checked
// against what the runs decode to, and what they decode to is bounded by
// `decompress`'s limit, so a hostile header costs what its bytes cost. `out`
// comes empty, holding whatever capacity an earlier decode gave it.

fn unpack_words(stored: &[u8], rows: usize, mut out: Vec<u32>) -> Result<Vec<u32>, String> {
    let run = LAYOUT.run;
    let runs = runs(stored, rows.div_ceil(run))?;
    let mut remaining = rows;
    for held in runs {
        out.extend(unvarints(&decompress(held, word_run_limit())?, remaining.min(run))?);
        remaining = remaining.saturating_sub(run);
    }
    Ok(out)
}

fn unpack_bytes(stored: &[u8], rows: usize, mut out: Vec<u8>) -> Result<Vec<u8>, String> {
    let runs = runs(stored, rows.div_ceil(LAYOUT.run))?;
    for held in runs {
        out.extend_from_slice(&decompress(held, LAYOUT.run)?);
    }
    if out.len() != rows {
        return Err("journey byte column has the wrong length".to_owned());
    }
    Ok(out)
}

fn unpack_blob(stored: &[u8], rows: usize, mut out: Vec<u8>) -> Result<Vec<u8>, String> {
    for held in runs_any(stored)? {
        let limit = rows.saturating_sub(out.len());
        out.extend_from_slice(&decompress(held, limit)?);
    }
    if out.len() != rows {
        return Err("journey blob column has the wrong length".to_owned());
    }
    Ok(out)
}
