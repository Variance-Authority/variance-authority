//! `combineRecords`: N shards' records as the one record an unsharded run
//! would have written, and nothing more. Every way the product folds shards
//! comes here: the coverage through `record_coverage_fold`, the case index
//! through `case_fold`, the last-run layer and the Eyes through `record_parts`.
//!
//! Nothing is read but the shards: no checkout, no source, no index of the
//! project. The shards are taken in the order of their contents' digests, so
//! the record is the same bytes whatever order they were named in.

use std::collections::HashMap;
use std::fs;

use napi_derive::napi;
use rayon::prelude::*;
use sha2::{Digest, Sha256};

use crate::case_fold;
use crate::case_shard;
use crate::journey_columns::{self, Column};
use crate::journey_output;
use crate::record_coverage::{self, Record};
use crate::record_coverage_fold::{self, Shard};
use crate::record_layout::LAYOUT;
use crate::record_parts;

#[napi(object)]
pub struct CombinedShard {
    pub path: String,
    /// The commit the shard names: its coverage's, or its last-run layer's.
    pub commit: Option<String>,
    /// The test files the shard's coverage recorded; for a shard that measured
    /// nothing, the files its last-run layer ran.
    pub files: Vec<String>,
    /// Whether the shard holds coverage.
    pub measured: bool,
}

#[napi(object)]
pub struct CombinedRecord {
    pub shards: Vec<CombinedShard>,
    /// Test files with coverage, over every shard.
    pub tests: u32,
    pub modules: u32,
    pub crossings: f64,
    /// Cases in the folded index; absent when no shard kept cases.
    pub cases: Option<u32>,
    pub commit: Option<String>,
    /// Files two shards' case indexes numbered differently.
    pub renumbered: Vec<String>,
}

struct Held {
    path: String,
    record: Record,
    commit: Option<String>,
    /// The files an unmeasured shard's last-run layer ran.
    ran: Vec<String>,
}

pub(crate) struct Combined {
    pub bytes: Vec<u8>,
    pub result: CombinedRecord,
}

/// The records at `paths` folded into one record's bytes.
pub(crate) fn combine(paths: &[String]) -> Result<Combined, String> {
    let named = paths
        .par_iter()
        .map(|path| fs::read(path).map(|bytes| (path.clone(), bytes)).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => format!("there is no record at {path}"),
            _ => format!("cannot read {path}: {error}"),
        }))
        .collect::<Result<Vec<_>, String>>()?;
    combine_bytes(&named)
}

/// The records `named`, each `(path, bytes)`, folded into one record's bytes.
pub(crate) fn combine_bytes(named: &[(String, Vec<u8>)]) -> Result<Combined, String> {
    if named.is_empty() {
        return Err("no records were named to combine".to_owned());
    }
    let mut read: Vec<([u8; 32], usize, Held)> = named
        .par_iter()
        .enumerate()
        .map(|(at, (path, bytes))| {
            let digest: [u8; 32] = Sha256::digest(bytes).into();
            let record = record_coverage::read(bytes)
                .map_err(|error| format!("cannot read the record {path}: {error}. Record it again with this version."))?;
            let (commit, ran) = match &record.coverage {
                Some(coverage) => (coverage.commit.map(|id| coverage.strings().map(|strings| strings[id as usize].to_owned())).transpose()?, Vec::new()),
                None => match record.parts.last.as_deref() {
                    Some(last) => record_parts::last_run(last).map_err(|error| format!("{path}: {error}"))?,
                    None => (None, Vec::new()),
                },
            };
            Ok((digest, at, Held { path: path.clone(), record, commit, ran }))
        })
        .collect::<Result<_, String>>()?;
    read.sort_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)));
    let held: Vec<&Held> = read.iter().map(|(_, _, held)| held).collect();

    // One run is at one commit. A shard that names none disagrees with nobody.
    let named: Vec<&&Held> = held.iter().filter(|shard| shard.commit.is_some()).collect();
    if let Some(other) = named.iter().find(|shard| shard.commit != named[0].commit) {
        return Err(format!(
            "{} and {} disagree about the commit (`{}` against `{}`), so they are not shards of one run and cannot be folded into one.",
            named[0].path,
            other.path,
            named[0].commit.as_deref().unwrap_or_default(),
            other.commit.as_deref().unwrap_or_default()
        ));
    }

    let measured: Vec<Shard<'_>> =
        held.iter().filter_map(|shard| shard.record.coverage.as_ref().map(|coverage| Shard { name: &shard.path, coverage })).collect();
    let coverage = if measured.is_empty() { None } else { Some(record_coverage_fold::fold(&measured)?) };

    let mut columns: Vec<Column> = Vec::new();
    let (mut cases, mut renumbered) = (None, Vec::new());
    let cased: Vec<&&Held> = held.iter().filter(|shard| shard.record.parts.index.is_some()).collect();
    if !cased.is_empty() {
        if let Some(uncased) = held.iter().find(|shard| shard.record.parts.index.is_none()) {
            return Err(format!(
                "{} kept cases and {} kept none, so the combined record could answer for the cases of only some of its files. Record {} again with cases kept, as {} was.",
                cased[0].path, uncased.path, uncased.path, cased[0].path
            ));
        }
        let index = fold_index(&cased, |shard| shard.record.parts.index.as_deref(), true)?;
        columns.push(Column::Plain(LAYOUT.coverage.part("index"), index.bytes));
        cases = Some(index.tests);
        renumbered = index.renumbered;
        let before: Vec<&&Held> = cased.iter().copied().filter(|shard| shard.record.parts.before.is_some()).collect();
        if !before.is_empty() {
            if let Some(without) = cased.iter().find(|shard| shard.record.parts.before.is_none()) {
                return Err(format!(
                    "{} holds a before layer and {} holds none, so they are not shards of one run over one index.",
                    before[0].path, without.path
                ));
            }
            columns.push(Column::Plain(LAYOUT.coverage.part("before"), fold_index(&before, |shard| shard.record.parts.before.as_deref(), false)?.bytes));
        }
        let parts = |part: fn(&Held) -> Option<&[u8]>| -> Vec<(&str, &[u8], &HashMap<String, String>)> {
            cased.iter().zip(&index.renamed).filter_map(|(shard, renamed)| part(shard).map(|bytes| (shard.path.as_str(), bytes, renamed))).collect()
        };
        let last = parts(|shard| shard.record.parts.last.as_deref());
        if !last.is_empty() {
            columns.push(Column::Plain(LAYOUT.coverage.part("last"), record_parts::fold_last(&last)?));
        }
        let eyes = parts(|shard| shard.record.parts.eyes.as_deref());
        if !eyes.is_empty() {
            columns.push(Column::Plain(LAYOUT.coverage.part("eyes"), record_parts::fold_eyes(&eyes)?));
        }
    }

    let mut shards: Vec<(usize, CombinedShard)> = read
        .iter()
        .map(|(_, at, shard)| (*at, CombinedShard { path: shard.path.clone(), commit: shard.commit.clone(), files: shard.ran.clone(), measured: shard.record.coverage.is_some() }))
        .collect();
    let mut result = CombinedRecord {
        shards: Vec::new(),
        tests: 0,
        modules: 0,
        crossings: 0.0,
        cases,
        commit: named.first().and_then(|shard| shard.commit.clone()),
        renumbered,
    };
    if let Some(folded) = coverage {
        let mut files = folded.files.into_iter();
        for (_, shard) in shards.iter_mut().filter(|(_, shard)| shard.measured) {
            shard.files = files.next().unwrap_or_default();
        }
        result.tests = folded.tests;
        result.modules = folded.modules;
        result.crossings = folded.crossings as f64;
        let mut all = folded.columns;
        all.append(&mut columns);
        columns = all;
    }
    shards.sort_by_key(|(at, _)| *at);
    result.shards = shards.into_iter().map(|(_, shard)| shard).collect();
    let bytes = journey_columns::encode(columns, LAYOUT.coverage.format)?;
    Ok(Combined { bytes, result })
}

/// The `part` of every shard through the one case fold. A test file belongs to
/// one shard, so where `owned` its cases may come from one shard only: no
/// sharded run, retry or rerun hands two shards one file, and a case run in
/// two is two observations of which neither is the suite's. The before layer
/// is every shard's view of one earlier index, so its files repeat.
fn fold_index(shards: &[&&Held], part: impl Fn(&Held) -> Option<&[u8]>, owned: bool) -> Result<case_fold::Folded, String> {
    let mut inventories = HashMap::new();
    let read = shards
        .iter()
        .map(|shard| {
            let bytes = part(shard).unwrap_or_default();
            case_shard::read_shard(bytes, &mut inventories)
                .map(|read| case_shard::Shard { name: shard.path.clone(), ..read })
                .map_err(|error| format!("cannot read the case index of {}: {error}. Record it again with this version.", shard.path))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if owned {
        let mut owner: HashMap<&str, &str> = HashMap::new();
        for shard in &read {
            for test in &shard.tests {
                let held = *owner.entry(test.file.as_str()).or_insert(shard.name.as_str());
                if held != shard.name {
                    return Err(format!(
                        "`{}` has cases in {held} and again in {}. A test file belongs to one shard, and two runs of its cases cannot both be the suite's; combine only one of the two.",
                        test.file, shard.name
                    ));
                }
            }
        }
    }
    case_fold::fold(read, inventories)
}

/// Fold the records at `paths` and write the one record at `output`.
#[napi(catch_unwind)]
pub fn combine_records(paths: Vec<String>, output: String) -> napi::Result<CombinedRecord> {
    let combined = combine(&paths).map_err(napi::Error::from_reason)?;
    journey_output::replace(&output, &combined.bytes).map_err(napi::Error::from_reason)?;
    Ok(combined.result)
}

#[cfg(test)]
#[path = "record_combine_tests.rs"]
mod tests;
