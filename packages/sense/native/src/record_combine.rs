//! `combineRecords`: N shards' records as the one record an unsharded run
//! would have written, and nothing more. Every way the product folds shards
//! comes here: the coverage through `record_coverage_fold`, the case index
//! through `case_fold`, the last-run layer and the Eyes through `record_parts`.
//!
//! Nothing is read but the shards: no checkout, no source, no index of the
//! project. The shards are taken in code-unit order of their paths, and every
//! fold sorts what it writes, so the record is the same bytes whatever order
//! they were named in. One shard is decoded at a time and dropped once folded.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;

use napi_derive::napi;

use crate::case_fold;
use crate::case_shard::{self, Inventory};
use crate::journey_columns::{self, Column, Spare};
use crate::journey_output;
use crate::order;
use crate::record_coverage::{self, Parts};
use crate::record_coverage_fold::Fold;
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
    /// Whether the shard's cases are in the combined index: it kept a case
    /// index and observed something.
    pub cased: bool,
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

pub(crate) struct Combined {
    pub bytes: Vec<u8>,
    pub result: CombinedRecord,
}

/// What every shard of one run says alike, and the first shard that said it.
/// Heard by `hear`, absent is a value: a shard that names none disagrees with
/// one that names one. Heard by `hear_some`, absent says nothing.
pub(crate) struct Agreed {
    what: &'static str,
    held: Option<(String, Option<String>)>,
}

impl Agreed {
    pub fn new(what: &'static str) -> Self {
        Agreed { what, held: None }
    }

    /// `shard` says `value`; shards are heard in code-unit order of their names.
    pub fn hear(&mut self, shard: &str, value: Option<&str>) -> Result<(), String> {
        match &self.held {
            None => {
                self.held = Some((shard.to_owned(), value.map(str::to_owned)));
                Ok(())
            }
            Some((_, held)) if held.as_deref() == value => Ok(()),
            Some((first, held)) => Err(format!(
                "{first} and {shard} disagree about the {} (`{}` against `{}`), so they are not shards of one run and cannot be folded into one.",
                self.what,
                held.as_deref().unwrap_or("(none)"),
                value.unwrap_or("(none)")
            )),
        }
    }

    /// `shard` says `value`, or says nothing when it names none: a shard that
    /// names no commit disagrees with nobody.
    pub fn hear_some(&mut self, shard: &str, value: Option<&str>) -> Result<(), String> {
        value.map_or(Ok(()), |value| self.hear(shard, Some(value)))
    }

    /// The value every shard heard said, if any said one.
    pub fn value(&self) -> Option<&str> {
        self.held.as_ref().and_then(|(_, value)| value.as_deref())
    }
}

/// A shard once its coverage is folded: what the other folds still need.
struct Held {
    path: String,
    commit: Option<String>,
    files: Vec<String>,
    measured: bool,
    /// Whether the shard observed nothing: no test in its coverage, no case in
    /// its index, no file in its last-run layer, no Eyes. It is neither cased
    /// nor uncased, and names no commit.
    empty: bool,
    /// Whether its cases go into the combined index; the index itself is
    /// taken by the case fold.
    cased: bool,
    index: Option<case_shard::Shard>,
    parts: Parts,
}

/// The records at `paths` folded into one record's bytes.
pub(crate) fn combine(paths: &[String]) -> Result<Combined, String> {
    let failed = |path: &str, error: std::io::Error| match error.kind() {
        std::io::ErrorKind::NotFound => format!("there is no record at {path}"),
        _ => format!("cannot read {path}: {error}"),
    };
    let load = |at: usize, prefix: Option<usize>| -> Result<(Cow<'static, [u8]>, usize), String> {
        let path = &paths[at];
        let Some(prefix) = prefix else {
            let bytes = fs::read(path).map_err(|error| failed(path, error))?;
            let length = bytes.len();
            return Ok((Cow::Owned(bytes), length));
        };
        let file = fs::File::open(path).map_err(|error| failed(path, error))?;
        let length = file.metadata().map_err(|error| failed(path, error))?.len() as usize;
        let mut bytes = Vec::with_capacity(prefix.min(length));
        file.take(prefix as u64).read_to_end(&mut bytes).map_err(|error| failed(path, error))?;
        Ok((Cow::Owned(bytes), length))
    };
    combined(paths, load)
}

/// The records `named`, each `(path, bytes)`, folded into one record's bytes.
#[cfg(test)]
pub(crate) fn combine_bytes(named: &[(String, Vec<u8>)]) -> Result<Combined, String> {
    let paths: Vec<String> = named.iter().map(|(path, _)| path.clone()).collect();
    let load = |at: usize, _: Option<usize>| Ok((Cow::Borrowed(named[at].1.as_slice()), named[at].1.len()));
    combined(&paths, load)
}

/// The records `paths` names folded, each read by `load`: whole, or its first
/// bytes when a limit is given, with its length either way.
fn combined<'a>(paths: &[String], load: impl Fn(usize, Option<usize>) -> Result<(Cow<'a, [u8]>, usize), String>) -> Result<Combined, String> {
    if paths.is_empty() {
        return Err("no records were named to combine".to_owned());
    }
    let mut order: Vec<usize> = (0..paths.len()).collect();
    order.sort_by(|left, right| order::code_unit(&paths[*left], &paths[*right]).then(left.cmp(right)));
    let unreadable = |path: &str, error: String| format!("cannot read the record {path}: {error}. Record it again with this version.");

    // Every shard's test files, off its header, so the fold sizes its sets once.
    let mut universe = 0;
    for at in &order {
        let (head, length) = load(*at, Some(4))?;
        let stated = head.get(..4).map_or(0, |bytes| u32::from_le_bytes(bytes.try_into().unwrap_or_default()) as usize);
        let (head, _) = load(*at, Some(4 + stated))?;
        universe += record_coverage::tests_in(&head, length).map_err(|error| unreadable(&paths[*at], error))?;
    }

    let mut fold = Fold::new(universe);
    // Each shard is decoded into the columns the one before it let go.
    let mut spare = Spare::default();
    let (mut measured, mut commit) = (Agreed::new("commit"), Agreed::new("commit"));
    let mut inventories: HashMap<String, Vec<Inventory>> = HashMap::new();
    let mut held: Vec<(usize, Held)> = Vec::with_capacity(paths.len());
    let mut folded_files: Vec<usize> = Vec::new();
    for at in order {
        let path = &paths[at];
        let (bytes, _) = load(at, None)?;
        let mut record = record_coverage::read_reusing(&bytes, &mut spare).map_err(|error| unreadable(path, error))?;
        drop(bytes);
        let last = record.parts.last.as_deref().map(record_parts::last_run).transpose().map_err(|error| format!("{path}: {error}"))?;
        let index = record
            .parts
            .index
            .take()
            .map(|bytes| case_shard::read_shard(&bytes, &mut inventories).map(|read| case_shard::Shard { name: path.clone(), ..read }))
            .transpose()
            .map_err(|error| format!("cannot read the case index of {path}: {error}. Record it again with this version."))?;
        let tested = record.coverage.as_ref().is_some_and(|coverage| coverage.tests() > 0);
        let empty = !tested
            && index.as_ref().is_none_or(|index| index.tests.is_empty())
            && last.as_ref().is_none_or(|(_, files)| files.is_empty())
            && record.parts.eyes.is_none();
        let covered = match &record.coverage {
            Some(coverage) => {
                let strings = coverage.strings()?;
                Some(coverage.commit.map(|id| strings[id as usize].to_owned()))
            }
            None => None,
        };
        // Coverage measured at no commit is a value among the measured shards,
        // as the layering rule holds it. A shard that measured nothing speaks
        // for the commit through its last run, and one whose last run names no
        // commit disagrees with nobody. A measured shard's last run may name a
        // later commit than its coverage, when a run that instrumented nothing
        // was laid over it; the last-run layers agree among themselves.
        if !empty {
            match &covered {
                Some(named) => {
                    measured.hear(path, named.as_deref())?;
                    commit.hear_some(path, named.as_deref())?;
                }
                None => commit.hear_some(path, last.as_ref().and_then(|(named, _)| named.as_deref()))?,
            }
        }
        if let (Some(coverage), false) = (&record.coverage, empty) {
            fold.add(path, coverage)?;
            folded_files.push(held.len());
        }
        let measured_any = record.coverage.is_some();
        if let Some(coverage) = record.coverage.take() {
            coverage.spare(&mut spare);
        }
        let (named, ran) = last.unwrap_or_default();
        held.push((at, Held {
            path: path.clone(),
            commit: covered.flatten().or(named),
            files: if measured_any { Vec::new() } else { ran },
            measured: measured_any,
            empty,
            cased: index.is_some() && !empty,
            index,
            parts: record.parts,
        }));
    }

    let mut columns: Vec<Column> = Vec::new();
    let (mut cases, mut renumbered, mut before_layer) = (None, Vec::new(), None);
    let observed: Vec<usize> = (0..held.len()).filter(|at| !held[*at].1.empty).collect();
    let shard = |at: &usize| &held[*at].1;
    let mut renamed: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut ids: HashSet<String> = HashSet::new();
    if let Some(cased) = observed.iter().map(shard).find(|shard| shard.index.is_some()) {
        if let Some(uncased) = observed.iter().map(shard).find(|shard| shard.index.is_none()) {
            return Err(format!(
                "{} kept cases and {} kept none, so the combined record could answer for the cases of only some of its files. Record {} again with cases kept, as {} was.",
                cased.path, uncased.path, uncased.path, cased.path
            ));
        }
        // A shard that found no record holds no before layer: its cases began
        // over nothing, and the last-run fold names its files unbased.
        if observed.iter().map(shard).any(|shard| shard.parts.before.is_some()) {
            let mut inventories = HashMap::new();
            let layers = held
                .iter()
                .filter_map(|(_, shard)| shard.parts.before.as_deref().map(|bytes| (shard, bytes)))
                .map(|(shard, bytes)| {
                    case_shard::read_shard(bytes, &mut inventories)
                        .map(|read| case_shard::Shard { name: shard.path.clone(), ..read })
                        .map_err(|error| format!("cannot read the before layer of {}: {error}. Record it again with this version.", shard.path))
                })
                .collect::<Result<Vec<_>, _>>()?;
            before_layer = Some(fold_index(layers, inventories, false)?.bytes);
        }
        let indexes: Vec<case_shard::Shard> = held.iter_mut().filter_map(|(_, shard)| shard.index.take()).collect();
        let names: Vec<String> = indexes.iter().map(|index| index.name.clone()).collect();
        let index = fold_index(indexes, inventories, true)?;
        columns.push(Column::Plain(LAYOUT.coverage.part("index"), index.bytes));
        cases = Some(index.tests);
        renumbered = index.renumbered;
        renamed = names.into_iter().zip(index.renamed).collect();
        ids = index.ids.into_iter().collect();
    }
    if let Some(bytes) = before_layer {
        columns.push(Column::Plain(LAYOUT.coverage.part("before"), bytes));
    }
    let unrenamed = HashMap::new();
    let parts = |part: fn(&Parts) -> Option<&[u8]>| -> Vec<(&str, &[u8], &HashMap<String, String>)> {
        observed
            .iter()
            .map(|at| &held[*at].1)
            .filter_map(|shard| part(&shard.parts).map(|bytes| (shard.path.as_str(), bytes, renamed.get(&shard.path).unwrap_or(&unrenamed))))
            .collect()
    };
    let last = parts(|parts| parts.last.as_deref());
    if !last.is_empty() {
        columns.push(Column::Plain(LAYOUT.coverage.part("last"), record_parts::fold_last(&last)?));
    }
    let eyes = parts(|parts| parts.eyes.as_deref());
    if !eyes.is_empty() {
        columns.push(Column::Plain(LAYOUT.coverage.part("eyes"), record_parts::fold_eyes(&eyes, cases.is_some().then_some(&ids))?));
    }

    let mut result = CombinedRecord {
        shards: Vec::new(),
        tests: 0,
        modules: 0,
        crossings: 0.0,
        cases,
        commit: commit.value().map(str::to_owned),
        renumbered,
    };
    let mut shards: Vec<(usize, CombinedShard)> = held
        .into_iter()
        .map(|(at, shard)| (at, CombinedShard {
            cased: shard.cased,
            path: shard.path,
            commit: shard.commit,
            files: shard.files,
            measured: shard.measured,
        }))
        .collect();
    if !folded_files.is_empty() {
        let folded = fold.finish(measured.value())?;
        for (shard, files) in folded_files.into_iter().zip(folded.files) {
            shards[shard].1.files = files;
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

/// The shards' case indexes, or before layers, through the one case fold. A
/// test file belongs to one shard, so where `owned` its cases may come from one
/// shard only: no sharded run, retry or rerun hands two shards one file, and a
/// case run in two is two observations of which neither is the suite's. The
/// before layer is every shard's view of one earlier index, so its files repeat.
fn fold_index(read: Vec<case_shard::Shard>, inventories: HashMap<String, Vec<Inventory>>, owned: bool) -> Result<case_fold::Folded, String> {
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
