//! A run's journals folded into the record's crossings in one pass: which test
//! files crossed each region of each module, which crossed it while loading,
//! and which modules each journal entered.
//!
//! The fold every runner seam ends with, read straight off the bytes the
//! workers wrote. A journal is never decoded into rows on the way: a suite of
//! fourteen thousand files is a few million module rows, and a row that became
//! an object, and then a set per region, was four of the seven seconds between
//! the last test and the end of the run (#1748).
//!
//! A region entered while its module was evaluating credits every file that
//! consumed the module; any other credits the file whose journal entered it.

use std::collections::{HashMap, HashSet};

use rayon::prelude::*;
use rustc_hash::FxHashMap;

use crate::journal_scan::{scan_journal, Visitor};
use crate::journey_journal::ModuleId;
use crate::order::code_unit;

/// Where a module the run read twice lands in the one record of its file:
/// the joined module's id, and each read ordinal's ordinal there (`None`, none).
pub(crate) struct Reading {
    pub id: ModuleId,
    pub lands: Vec<Option<u32>>,
}

/// One module row as a page handed it over, not as bytes.
pub(crate) struct CarriedRow {
    pub id: ModuleId,
    pub hits: Vec<u32>,
    pub shared: Vec<u32>,
    pub loaded: Vec<u32>,
}

pub(crate) struct Carried {
    pub test_file: String,
    pub rows: Vec<CarriedRow>,
}

pub(crate) struct Options<'a> {
    pub root: &'a str,
    pub readings: &'a HashMap<ModuleId, Reading>,
    /// The modules the run could place: a row of any other is left out, and its
    /// file named unplaced. Absent, every module is placed.
    pub placed: Option<&'a HashSet<ModuleId>>,
}

/// The fold. Modules are numbered by first sighting and tests by their order;
/// every list below names them by that number.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct Folded {
    /// Each test file that left a journal, by its project path, in code-unit order.
    pub tests: Vec<String>,
    /// Each module a placed row named, by its id after any reading.
    pub ids: Vec<ModuleId>,
    /// Per module in `ids` order: its count of crossed ordinals, then per
    /// ordinal, rising, the ordinal, its count of tests and the tests, rising.
    pub hits: Vec<u32>,
    /// The same for the ordinals entered before the file's first test.
    pub loaded: Vec<u32>,
    /// Per journal, frames then carried, in the order given: its test, its count
    /// of entered modules, then the modules, rising.
    pub journals: Vec<u32>,
    /// Per journal, the moment its file's collection ended; `0`, unmarked.
    pub collected: Vec<f64>,
    /// The journals that named a module the run could not place, rising.
    pub unplaced: Vec<u32>,
}

/// One journal ready to fold: its file, and its rows joined by the module of
/// the record they land in, each list rising.
struct Journal {
    test: String,
    collected: f64,
    unplaced: bool,
    rows: Vec<Row>,
}

/// One module row of a journal: per list (hits, loaded), the ordinals its own
/// file crossed and those every consumer crossed (`shared`).
struct Row {
    id: ModuleId,
    own: [Vec<u32>; 2],
    every: [Vec<u32>; 2],
}

/// A journal's rows placed, read and split, as `journal` leaves them; done per journal on every core.
fn ready(test_file: &str, collected: f64, rows: Vec<(ModuleId, Vec<u32>, Vec<u32>, Vec<u32>)>, options: &Options) -> Journal {
    let count = rows.len();
    let placed: Vec<_> = rows.into_iter().filter(|(id, ..)| options.placed.is_none_or(|placed| placed.contains(id))).collect();
    let unplaced = placed.len() != count;
    Journal { test: project_path(options.root, test_file), collected, unplaced, rows: read_rows(placed, options.readings) }
}

/// The journals folded, in the order given. Tests and modules are numbered
/// in one pass; each module's crossings are then spelled on every core.
fn fold_journals(journals: Vec<Journal>) -> Folded {
    let mut tests: Vec<String> = Vec::new();
    let mut test_numbers: FxHashMap<String, u32> = FxHashMap::default();
    let mut ids: Vec<ModuleId> = Vec::new();
    let mut id_numbers: FxHashMap<ModuleId, u32> = FxHashMap::default();
    // Per module, the (journal, row) pairs that name it.
    let mut named: Vec<Vec<(u32, u32)>> = Vec::new();
    let mut entries = Vec::new();
    let mut collected = Vec::with_capacity(journals.len());
    let mut unplaced = Vec::new();
    let mut numbers: Vec<u32> = Vec::with_capacity(journals.len());
    for (at, journal) in journals.iter().enumerate() {
        let test = match test_numbers.get(&journal.test) {
            Some(&number) => number,
            None => {
                let number = tests.len() as u32;
                test_numbers.insert(journal.test.clone(), number);
                tests.push(journal.test.clone());
                number
            }
        };
        numbers.push(test);
        if journal.unplaced {
            unplaced.push(collected.len() as u32);
        }
        collected.push(journal.collected);
        let mut entered: Vec<u32> = Vec::with_capacity(journal.rows.len());
        for (row, Row { id, .. }) in journal.rows.iter().enumerate() {
            let module = match id_numbers.get(id) {
                Some(&number) => number,
                None => {
                    let number = ids.len() as u32;
                    id_numbers.insert(id.clone(), number);
                    ids.push(id.clone());
                    named.push(Vec::new());
                    number
                }
            };
            named[module as usize].push((at as u32, row as u32));
            entered.push(module);
        }
        entered.sort_unstable();
        entered.dedup();
        entries.push(entered);
    }

    // Tests renumbered in code-unit order of their paths, so that every list
    // of tests below, rising by number, is in the order the record keeps.
    let mut order: Vec<u32> = (0..tests.len() as u32).collect();
    order.sort_unstable_by(|left, right| code_unit(&tests[*left as usize], &tests[*right as usize]));
    let mut renumber = vec![0; order.len()];
    for (number, was) in order.iter().enumerate() {
        renumber[*was as usize] = number as u32;
    }
    let tests = order.iter().map(|was| std::mem::take(&mut tests[*was as usize])).collect();
    let test_of = |journal: u32| renumber[numbers[journal as usize] as usize];

    let mut journal_words = Vec::new();
    for (at, entered) in entries.into_iter().enumerate() {
        journal_words.push(test_of(at as u32));
        journal_words.push(entered.len() as u32);
        journal_words.extend(entered);
    }

    // Per module: its consumers, and per list the words it spells.
    let spelled: Vec<[Vec<u32>; 2]> = named
        .par_iter()
        .map(|pairs| {
            let mut consumers: Vec<u32> = pairs.iter().map(|(journal, _)| test_of(*journal)).collect();
            consumers.sort_unstable();
            consumers.dedup();
            [0, 1].map(|list| {
                // Ordinal → the tests that crossed it themselves, and whether every consumer did.
                let mut ordinals: FxHashMap<u32, (Vec<u32>, bool)> = FxHashMap::default();
                for (journal, row) in pairs {
                    let test = test_of(*journal);
                    let row = &journals[*journal as usize].rows[*row as usize];
                    for &ordinal in &row.own[list] {
                        ordinals.entry(ordinal).or_default().0.push(test);
                    }
                    for &ordinal in &row.every[list] {
                        ordinals.entry(ordinal).or_default().1 = true;
                    }
                }
                let mut ordinals: Vec<_> = ordinals.into_iter().collect();
                ordinals.sort_unstable_by_key(|(ordinal, _)| *ordinal);
                let mut out = vec![ordinals.len() as u32];
                for (ordinal, (mut own, every)) in ordinals {
                    if every {
                        own = consumers.clone();
                    } else {
                        own.sort_unstable();
                        own.dedup();
                    }
                    out.push(ordinal);
                    out.push(own.len() as u32);
                    out.extend(own);
                }
                out
            })
        })
        .collect();
    let mut hits = Vec::new();
    let mut loaded = Vec::new();
    for [module_hits, module_loaded] in spelled {
        hits.extend(module_hits);
        loaded.extend(module_loaded);
    }
    Folded { tests, ids, hits, loaded, journals: journal_words, collected, unplaced }
}

/// One journal's rows as the scan hands them over, before they are placed.
#[derive(Default)]
struct Rows {
    test: Option<String>,
    collected: f64,
    rows: Vec<(ModuleId, Vec<u32>, Vec<u32>, Vec<u32>)>,
}

impl Visitor for Rows {
    fn test(&mut self, packed: &str) -> Result<(), String> {
        self.test = Some(packed.to_owned());
        Ok(())
    }
    fn collected(&mut self, at: f64) {
        self.collected = at;
    }
    fn wants(&mut self, _: &ModuleId, _: bool) -> bool {
        true
    }
    fn module(&mut self, id: &ModuleId, hits: &[u32], shared: &[u32], loaded: &[u32], _: Option<&[u32]>) {
        self.rows.push((id.clone(), hits.to_vec(), shared.to_vec(), loaded.to_vec()));
    }
}

/// The ids every journal names, each once, in the order first named.
pub(crate) fn named_modules(journals: &[&[u8]], carried: &[Carried]) -> Result<Vec<ModuleId>, String> {
    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    let mut add = |id: &str| {
        if seen.insert(id.to_owned()) {
            ids.push(id.to_owned());
        }
    };
    for raw in journals {
        let mut rows = Rows::default();
        scan_journal(raw, &mut rows)?;
        for (id, ..) in &rows.rows {
            add(id);
        }
    }
    for journal in carried {
        for row in &journal.rows {
            add(&row.id);
        }
    }
    Ok(ids)
}

/// The run's journals — the workers' frames, then what pages carried — folded.
pub(crate) fn fold(journals: &[&[u8]], carried: &[Carried], options: &Options) -> Result<Folded, String> {
    // Each journal's bytes are its own: they are scanned, placed and read on every core, and folded in the order given.
    let mut ready_journals = journals
        .par_iter()
        .map(|raw| {
            let mut rows = Rows::default();
            scan_journal(raw, &mut rows)?;
            Ok(ready(rows.test.as_deref().unwrap_or_default(), rows.collected, rows.rows, options))
        })
        .collect::<Result<Vec<_>, String>>()?;
    ready_journals.par_extend(carried.par_iter().map(|each| {
        let rows = each.rows.iter().map(|row| (row.id.clone(), row.hits.clone(), row.shared.clone(), row.loaded.clone())).collect();
        ready(&each.test_file, 0.0, rows, options)
    }));
    Ok(fold_journals(ready_journals))
}

/// A journal's rows in the record of their files: where a run read a file
/// twice, each row's ordinals become the joined module's, and the rows that
/// joined become one. With no reading, the rows stay as written.
fn read_rows(rows: Vec<(ModuleId, Vec<u32>, Vec<u32>, Vec<u32>)>, readings: &HashMap<ModuleId, Reading>) -> Vec<Row> {
    let mut order: Vec<ModuleId> = Vec::new();
    let mut joined: FxHashMap<ModuleId, [Vec<u32>; 3]> = FxHashMap::default();
    for (id, hits, shared, loaded) in rows {
        let reading = readings.get(&id);
        let target = reading.map_or(id, |reading| reading.id.clone());
        let row = match joined.entry(target) {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => {
                order.push(entry.key().clone());
                entry.insert(Default::default())
            }
        };
        for (into, ordinals) in row.iter_mut().zip([hits, shared, loaded]) {
            match reading {
                None => into.extend(ordinals),
                Some(reading) => into.extend(ordinals.into_iter().filter_map(|ordinal| reading.lands.get(ordinal as usize).copied().flatten())),
            }
        }
    }
    order
        .into_iter()
        .map(|id| {
            let [mut hits, mut shared, mut loaded] = joined.remove(&id).unwrap_or_default();
            for list in [&mut hits, &mut shared, &mut loaded] {
                list.sort_unstable();
                list.dedup();
            }
            let split = |list: Vec<u32>| -> (Vec<u32>, Vec<u32>) { list.into_iter().partition(|ordinal| shared.binary_search(ordinal).is_err()) };
            let ((own_hits, every_hits), (own_loaded, every_loaded)) = (split(hits), split(loaded));
            Row { id, own: [own_hits, own_loaded], every: [every_hits, every_loaded] }
        })
        .collect()
}

/// `file` as the checkout at `root` names it: relative, with `/` between
/// segments, as `projectPath` names it.
pub(crate) fn project_path(root: &str, file: &str) -> String {
    let segments = |path: &str| {
        let mut out: Vec<String> = Vec::new();
        for segment in path.split(|c| c == '/' || (cfg!(windows) && c == '\\')) {
            match segment {
                "" | "." => {}
                ".." => {
                    out.pop();
                }
                other => out.push(other.to_owned()),
            }
        }
        out
    };
    let from = segments(root);
    let to = segments(file);
    let same = |left: &str, right: &str| if cfg!(windows) { left.eq_ignore_ascii_case(right) } else { left == right };
    let common = from.iter().zip(&to).take_while(|(left, right)| same(left, right)).count();
    let mut out: Vec<&str> = vec![".."; from.len() - common];
    out.extend(to[common..].iter().map(String::as_str));
    out.join("/")
}

#[cfg(test)]
#[path = "run_crossings_tests.rs"]
mod tests;
