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

#[derive(Default)]
struct Crossed {
    /// Ordinal → the tests that crossed it themselves, and whether every consumer did.
    ordinals: HashMap<u32, (Vec<u32>, bool)>,
}

#[derive(Default)]
struct Fold {
    tests: Vec<String>,
    test_numbers: HashMap<String, u32>,
    ids: Vec<ModuleId>,
    id_numbers: HashMap<ModuleId, u32>,
    consumers: Vec<Vec<u32>>,
    hits: Vec<Crossed>,
    loaded: Vec<Crossed>,
    journals: Vec<u32>,
    collected: Vec<f64>,
    unplaced: Vec<u32>,
}

impl Fold {
    fn test(&mut self, file: String) -> u32 {
        if let Some(&number) = self.test_numbers.get(&file) {
            return number;
        }
        let number = self.tests.len() as u32;
        self.test_numbers.insert(file.clone(), number);
        self.tests.push(file);
        number
    }

    fn module(&mut self, id: &str) -> u32 {
        if let Some(&number) = self.id_numbers.get(id) {
            return number;
        }
        let number = self.ids.len() as u32;
        self.id_numbers.insert(id.to_owned(), number);
        self.ids.push(id.to_owned());
        self.consumers.push(Vec::new());
        self.hits.push(Crossed::default());
        self.loaded.push(Crossed::default());
        number
    }

    /// One journal's rows, already placed and read: `rows` is `(module, hits, shared, loaded)`.
    fn journal(&mut self, test: u32, rows: &[(u32, Vec<u32>, Vec<u32>, Vec<u32>)]) {
        let mut entered: Vec<u32> = rows.iter().map(|(module, ..)| *module).collect();
        entered.sort_unstable();
        entered.dedup();
        self.journals.push(test);
        self.journals.push(entered.len() as u32);
        self.journals.extend(entered);
        for (module, hits, shared, loaded) in rows {
            let module = *module as usize;
            self.consumers[module].push(test);
            let shared: HashSet<u32> = shared.iter().copied().collect();
            for (into, ordinals) in [(&mut self.hits[module], hits), (&mut self.loaded[module], loaded)] {
                for &ordinal in ordinals {
                    let entry = into.ordinals.entry(ordinal).or_default();
                    if shared.contains(&ordinal) {
                        entry.1 = true;
                    } else {
                        entry.0.push(test);
                    }
                }
            }
        }
    }

    fn done(mut self) -> Folded {
        // Tests renumbered in code-unit order of their paths, so that every list
        // of tests below, rising by number, is in the order the record keeps.
        let mut order: Vec<u32> = (0..self.tests.len() as u32).collect();
        order.sort_unstable_by(|left, right| code_unit(&self.tests[*left as usize], &self.tests[*right as usize]));
        let mut renumber = vec![0; order.len()];
        for (number, was) in order.iter().enumerate() {
            renumber[*was as usize] = number as u32;
        }
        let tests = order.iter().map(|was| std::mem::take(&mut self.tests[*was as usize])).collect();
        let to = |test: &mut u32| *test = renumber[*test as usize];
        self.consumers.iter_mut().flatten().for_each(to);
        for crossed in self.hits.iter_mut().chain(self.loaded.iter_mut()) {
            crossed.ordinals.values_mut().flat_map(|(own, _)| own.iter_mut()).for_each(to);
        }
        let mut at = 0;
        while at < self.journals.len() {
            to(&mut self.journals[at]);
            at += 2 + self.journals[at + 1] as usize;
        }
        for consumers in &mut self.consumers {
            consumers.sort_unstable();
            consumers.dedup();
        }
        let spell = |crossed: &[Crossed], consumers: &[Vec<u32>]| {
            let mut out = Vec::new();
            for (module, crossed) in crossed.iter().enumerate() {
                let mut ordinals: Vec<_> = crossed.ordinals.iter().collect();
                ordinals.sort_unstable_by_key(|(ordinal, _)| **ordinal);
                out.push(ordinals.len() as u32);
                for (ordinal, (own, every)) in ordinals {
                    let mut tests = if *every { consumers[module].clone() } else { own.clone() };
                    if !*every {
                        tests.sort_unstable();
                        tests.dedup();
                    }
                    out.push(*ordinal);
                    out.push(tests.len() as u32);
                    out.extend(tests);
                }
            }
            out
        };
        let hits = spell(&self.hits, &self.consumers);
        let loaded = spell(&self.loaded, &self.consumers);
        Folded {
            tests,
            ids: self.ids,
            hits,
            loaded,
            journals: self.journals,
            collected: self.collected,
            unplaced: self.unplaced,
        }
    }
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
    let mut fold = Fold::default();
    let journal = |fold: &mut Fold, test_file: &str, collected: f64, rows: Vec<(ModuleId, Vec<u32>, Vec<u32>, Vec<u32>)>| {
        let test = fold.test(project_path(options.root, test_file));
        let count = rows.len();
        let placed = rows
            .into_iter()
            .filter(|(id, ..)| options.placed.is_none_or(|placed| placed.contains(id)))
            .collect::<Vec<_>>();
        if placed.len() != count {
            fold.unplaced.push(fold.collected.len() as u32);
        }
        fold.collected.push(collected);
        let read = read_rows(fold, placed, options.readings);
        fold.journal(test, &read);
    };
    for raw in journals {
        let mut rows = Rows::default();
        scan_journal(raw, &mut rows)?;
        let test_file = rows.test.take().unwrap_or_default();
        journal(&mut fold, &test_file, rows.collected, rows.rows);
    }
    for each in carried {
        let rows = each.rows.iter().map(|row| (row.id.clone(), row.hits.clone(), row.shared.clone(), row.loaded.clone())).collect();
        journal(&mut fold, &each.test_file, 0.0, rows);
    }
    Ok(fold.done())
}

/// A journal's rows in the record of their files: where a run read a file
/// twice, each row's ordinals become the joined module's, and the rows that
/// joined become one. With no reading, the rows stay as written.
fn read_rows(
    fold: &mut Fold,
    rows: Vec<(ModuleId, Vec<u32>, Vec<u32>, Vec<u32>)>,
    readings: &HashMap<ModuleId, Reading>,
) -> Vec<(u32, Vec<u32>, Vec<u32>, Vec<u32>)> {
    if readings.is_empty() {
        return rows.into_iter().map(|(id, hits, shared, loaded)| (fold.module(&id), hits, shared, loaded)).collect();
    }
    let mut order = Vec::new();
    let mut joined: HashMap<u32, [Vec<u32>; 3]> = HashMap::new();
    for (id, hits, shared, loaded) in rows {
        let reading = readings.get(&id);
        let module = fold.module(reading.map_or(&id, |reading| &reading.id));
        let row = joined.entry(module).or_insert_with(|| {
            order.push(module);
            Default::default()
        });
        for (into, ordinals) in row.iter_mut().zip([hits, shared, loaded]) {
            for ordinal in ordinals {
                let landed = match reading {
                    None => Some(ordinal),
                    Some(reading) => reading.lands.get(ordinal as usize).copied().flatten(),
                };
                into.extend(landed);
            }
        }
    }
    order
        .into_iter()
        .map(|module| {
            let [mut hits, mut shared, mut loaded] = joined.remove(&module).unwrap_or_default();
            for list in [&mut hits, &mut shared, &mut loaded] {
                list.sort_unstable();
                list.dedup();
            }
            (module, hits, shared, loaded)
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
