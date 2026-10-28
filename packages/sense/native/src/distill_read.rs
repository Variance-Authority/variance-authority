//! A record read once for `distill`: which test file loaded which module, and
//! how many of its cases entered each one.
//!
//! The coverage rows say what a test file loaded, the case index what its cases
//! entered; a distillation of a whole suite asks both of every test file. They
//! are read here into what that question needs and nothing more — per row the
//! flags and the line count that decide whether it is weight, and the loaders
//! as sorted path ids — so a test file's reading costs a lookup, and no
//! crossing becomes an object. The rows come from
//! [`coverage_rows`](crate::coverage_rows), the entries from
//! [`distill_cases`](crate::distill_cases). Every path is interned into one
//! table shared by every record and the graph.

use std::collections::{HashMap, HashSet};

use crate::coverage_rows::{CoverageRows, FUNCTION, MODULE, NO_LINE};
use crate::distill_cases::{CaseIndex, Cases, DistillRegion};

/// Every path a distillation names, once.
#[derive(Default)]
pub(crate) struct Paths {
    ids: HashMap<String, u32>,
    names: Vec<String>,
}

impl Paths {
    pub fn intern(&mut self, name: &str) -> u32 {
        if let Some(id) = self.ids.get(name) {
            return *id;
        }
        let id = self.names.len() as u32;
        self.ids.insert(name.to_owned(), id);
        self.names.push(name.to_owned());
        id
    }

    pub fn id(&self, name: &str) -> Option<u32> {
        self.ids.get(name).copied()
    }

    pub fn name(&self, id: u32) -> &str {
        &self.names[id as usize]
    }

    pub fn len(&self) -> usize {
        self.names.len()
    }
}

/// One coverage row: a module as one recording measured it.
pub(crate) struct Row {
    pub file: u32,
    pub instrumented: bool,
    /// Declares a function with source: something below its top level a case can enter.
    pub function: bool,
    /// Holds its top level only.
    pub only_module: bool,
    /// Where its top level ends; nothing when it kept no lines.
    pub lines: Option<u32>,
    /// Its loaders in `Record::loaders`: the test files its top level ran for.
    loaders: (u32, u32),
}

pub(crate) struct Record {
    /// The test file of each coverage test row, in row order.
    pub tests: Vec<u32>,
    held: HashSet<u32>,
    incomplete: HashSet<u32>,
    pub rows: Vec<Row>,
    loaders: Vec<u32>,
    /// The last row for each file, which is the one a file's lookup answers.
    last: HashMap<u32, u32>,
    /// Per test file, the rows it loaded that are weight candidates, in row order.
    loads: HashMap<u32, Vec<u32>>,
    index: CaseIndex,
}

impl Record {
    /// A coverage record that carries its case index, read for `distill`.
    pub fn read(bytes: &[u8], paths: &mut Paths) -> Result<Record, String> {
        let coverage = CoverageRows::read(bytes)?;
        let mut tests = Vec::with_capacity(coverage.tests());
        let mut incomplete = HashSet::new();
        for test in 0..coverage.tests() {
            let file = paths.intern(coverage.test_file(test)?);
            tests.push(file);
            if !coverage.complete(test) {
                incomplete.insert(file);
            }
        }
        let held = tests.iter().copied().collect();

        let mut rows = Vec::with_capacity(coverage.modules());
        let mut loaders = Vec::new();
        let mut last = HashMap::with_capacity(coverage.modules());
        let mut loads: HashMap<u32, Vec<u32>> = HashMap::new();
        for module in 0..coverage.modules() {
            let range = coverage.blocks(module)?;
            let first = range.clone().find(|block| coverage.kind(*block) == MODULE);
            let function = range.clone().any(|block| coverage.kind(block) == FUNCTION && coverage.source(block));
            let only_module = range.clone().all(|block| coverage.kind(block) == MODULE);
            let lines = first.filter(|block| coverage.start(*block) != NO_LINE).map(|block| coverage.end(block));
            let from = loaders.len() as u32;
            if let Some(block) = first {
                let mut by = coverage
                    .loaded_by(block)?
                    .into_iter()
                    .map(|test| tests.get(test as usize).copied().ok_or_else(|| format!("the record is damaged: a loader set names test row {test}, which it does not hold")))
                    .collect::<Result<Vec<_>, _>>()?;
                by.sort_unstable();
                by.dedup();
                loaders.extend(by);
            }
            let row = Row {
                file: paths.intern(coverage.module_file(module)?),
                instrumented: coverage.instrumented(module),
                function,
                only_module,
                lines,
                loaders: (from, loaders.len() as u32),
            };
            last.insert(row.file, module as u32);
            if row.instrumented && row.function {
                for file in &loaders[from as usize..] {
                    loads.entry(*file).or_default().push(module as u32);
                }
            }
            rows.push(row);
        }
        drop(coverage);

        let index = CaseIndex::read(bytes, paths)?;
        Ok(Record { tests, held, incomplete, rows, loaders, last, loads, index })
    }

    /// Whether the coverage rows name `file` as a test file.
    pub fn holds(&self, file: u32) -> bool {
        self.held.contains(&file)
    }

    pub fn incomplete(&self, file: u32) -> bool {
        self.incomplete.contains(&file)
    }

    pub fn row(&self, row: u32) -> &Row {
        &self.rows[row as usize]
    }

    /// The row a lookup by file answers: the last one for it.
    pub fn row_of(&self, file: u32) -> Option<&Row> {
        self.last.get(&file).map(|row| self.row(*row))
    }

    /// Whether `file`'s cases ran the row's top level.
    pub fn loaded_by(&self, row: &Row, file: u32) -> bool {
        let (from, to) = row.loaders;
        self.loaders[from as usize..to as usize].binary_search(&file).is_ok()
    }

    /// How many test files the row's top level ran for.
    pub fn loading(&self, row: &Row) -> u32 {
        row.loaders.1 - row.loaders.0
    }

    /// The weight candidates `file` loaded, by row, in row order.
    pub fn loads(&self, file: u32) -> &[u32] {
        self.loads.get(&file).map_or(&[], Vec::as_slice)
    }

    pub fn cases(&self, file: u32) -> Cases {
        self.index.cases(file)
    }

    /// How many modules the case index holds.
    pub fn indexed_modules(&self) -> Result<usize, String> {
        self.index.modules()
    }

    /// Every module's entries read up front, for a scope that asks them all from many threads.
    pub fn enter_all(&mut self, paths: &Paths) -> Result<(), String> {
        self.index.enter_all(paths)
    }

    /// How many cases of `test` entered `module` below its top level.
    pub fn entered(&self, paths: &Paths, module: u32, test: u32) -> Result<u32, String> {
        self.index.entered(paths, module, test)
    }

    /// The regions the case index keeps for `importer`, read against the cases of `file`.
    pub fn regions(&self, importer: &str, file: u32) -> Result<Vec<DistillRegion>, String> {
        self.index.regions(importer, file)
    }
}
