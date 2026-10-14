//! A framed file's columns decoded, each into a buffer of its own.

use std::collections::HashMap;

use rayon::prelude::*;

use super::{decompress, runs, runs_any, unvarints, word_run_limit, Decoded, Placed, Plain};
use crate::record_layout::LAYOUT;

pub(super) fn decode_placed(bytes: &[u8], placed: Vec<Placed>) -> Result<Decoded, String> {
    // Columns decode apart, so a record's are decoded at once.
    let plain: Vec<(String, Plain)> = placed
        .into_par_iter()
        .map(|column| {
            let (mut words, mut held) = (Vec::new(), Vec::new());
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

// A count the file states is checked against what the runs decode to, and
// what they decode to is bounded by `decompress`'s limit, so a hostile header
// costs what its bytes cost. A column is reserved at the rows it states once
// its run table is found, so it is filled in place rather than copied as it
// grows, which would hold every column of a record twice while they decode at
// once; the reservation is only asked for, and a refusal leaves the column to
// grow. Pages it never fills are never touched.

fn unpack_words(stored: &[u8], rows: usize, mut out: Vec<u32>) -> Result<Vec<u32>, String> {
    let run = LAYOUT.run;
    let runs = runs(stored, rows.div_ceil(run))?;
    let _ = out.try_reserve_exact(rows);
    let mut remaining = rows;
    for held in runs {
        out.extend(unvarints(&decompress(held, word_run_limit())?, remaining.min(run))?);
        remaining = remaining.saturating_sub(run);
    }
    Ok(out)
}

fn unpack_bytes(stored: &[u8], rows: usize, mut out: Vec<u8>) -> Result<Vec<u8>, String> {
    let runs = runs(stored, rows.div_ceil(LAYOUT.run))?;
    let _ = out.try_reserve_exact(rows);
    for held in runs {
        out.extend_from_slice(&decompress(held, LAYOUT.run)?);
    }
    if out.len() != rows {
        return Err("journey byte column has the wrong length".to_owned());
    }
    Ok(out)
}

fn unpack_blob(stored: &[u8], rows: usize, mut out: Vec<u8>) -> Result<Vec<u8>, String> {
    let runs = runs_any(stored)?;
    let _ = out.try_reserve_exact(rows);
    for held in runs {
        let limit = rows.saturating_sub(out.len());
        out.extend_from_slice(&decompress(held, limit)?);
    }
    if out.len() != rows {
        return Err("journey blob column has the wrong length".to_owned());
    }
    Ok(out)
}
