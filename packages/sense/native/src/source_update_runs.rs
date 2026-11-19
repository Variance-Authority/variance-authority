//! The parses an update reads, encoded a slice at a time.
//!
//! A walk's read is the largest thing it holds: requests, exports, symbols,
//! spans and their text, for every file. The index and the store need the
//! parse only as rows of a generation, and a row of a parse-only segment
//! (`index::parses_only`) writes the same columns again through `ParseView` as
//! the read it came from (`a_read_run_writes_the_bytes_its_read_does`). So each
//! slice's fresh parses are encoded as one run once the slice is resolved, the
//! reads are dropped, and the generation the update publishes is written from
//! the runs: a slice of reads is held at a time, never the closure's.

// compass: variance-authority.reach.source-index

use std::sync::Mutex;

use rayon::prelude::*;

use super::Row;
use crate::batch::Slice;
use crate::compact::{Layer, ParseView};
use crate::index::{parses_only, way};
use crate::order::code_unit;
use crate::parse_store::key;
use crate::read::Read;
use crate::record::{built, Indexed, Settling};

/// Where a row's parse lies: its run, and its row in the run.
pub(super) type Place = (u32, u32);

/// Every run encoded so far, in the order the slices were settled.
#[derive(Default)]
pub(super) struct Runs {
    runs: Mutex<Vec<Vec<u8>>>,
}

impl Runs {
    /// Encode, as one run, the parse of every row of a slice that `fresh`
    /// names, keyed by its identity and the way its file is read; where each
    /// row's parse lies, and none for a row left out. Rows sharing a key share
    /// one row of the run, as they share one row of the generation.
    pub(super) fn add(&self, files: &[String], identities: &[String], reads: &[&Read], fresh: impl Fn(usize) -> bool) -> Vec<Option<Place>> {
        let mut keyed: Vec<(String, usize)> =
            (0..files.len()).filter(|&row| fresh(row)).map(|row| (key(&identities[row], &way(&files[row])), row)).collect();
        if keyed.is_empty() {
            return vec![None; files.len()];
        }
        keyed.sort_by(|left, right| code_unit(&left.0, &right.0));
        let mut places = vec![None; files.len()];
        let mut rows: Vec<(&str, &Read)> = Vec::with_capacity(keyed.len());
        for (key, row) in &keyed {
            if rows.last().is_none_or(|(last, _)| *last != key.as_str()) {
                rows.push((key.as_str(), reads[*row]));
            }
            places[*row] = Some(rows.len() as u32 - 1);
        }
        let run = parses_only(&rows);
        let mut runs = self.runs.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let at = runs.len() as u32;
        runs.push(run);
        places.into_iter().map(|place| place.map(|row| (at, row))).collect()
    }

    /// The runs, to be opened in place.
    pub(super) fn into_inner(self) -> Vec<Vec<u8>> {
        self.runs.into_inner().unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// A resolved slice's rows: its records built, and its fresh parses encoded
/// as one run, as soon as it is resolved; the reads go with the slice.
pub(super) fn settled(slice: Slice, settling: &Settling, runs: &Runs) -> Vec<Row> {
    let Slice { files, identities, read, kept, targets } = slice;
    let indexed: Vec<Indexed> = files
        .par_iter()
        .zip(identities.par_iter())
        .zip(read.par_iter())
        .zip(targets.par_iter())
        .map(|(((file, identity), (read, _, outcome)), targets)| built(file, identity, read, *outcome, targets, settling))
        .collect();
    let parsed: Vec<bool> = read.iter().map(|(_, _, outcome)| outcome.parsed()).collect();
    let reads: Vec<&Read> = read.iter().map(|(read, _, _)| read).collect();
    let places = runs.add(files, &identities, &reads, |row| parsed[row] && !kept[row] && !identities[row].is_empty());
    drop(reads);
    // Freeing a slice's reads is the walk's to wait on no longer than it takes.
    std::thread::spawn(move || drop(read));
    indexed
        .into_iter()
        .zip(identities)
        .zip(places)
        .zip(parsed)
        .zip(kept)
        .map(|((((indexed, identity), parse), parsed), &kept)| Row { indexed, identity, parse, parsed, kept })
        .collect()
}

/// The parse at `place` among the `opened` runs.
pub(super) fn view<'s, 'a>(opened: &'s [Layer<'a>], (run, row): Place) -> ParseView<'s, 'a> {
    ParseView::of(&opened[run as usize], row as usize)
}

#[cfg(test)]
#[path = "source_update_runs_tests.rs"]
mod tests;
