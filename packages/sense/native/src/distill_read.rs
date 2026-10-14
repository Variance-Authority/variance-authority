//! A record read once for `distill`: which test file loaded which module, and
//! how many of its cases entered each one.
//!
//! The coverage rows say what a test file loaded, the case index what its cases
//! entered; a distillation of a whole suite asks both of every test file. They
//! are read here into what that question needs and nothing more — per row the
//! flags and the line count that decide whether it is weight, the loaders as
//! sorted path ids, and per module the cases of each test file that entered it —
//! so a test file's reading costs a lookup, and no crossing becomes an object.
//! Every path is interned into one table shared by every record and the graph.

use std::collections::{HashMap, HashSet};

use crate::journey_columns;
use crate::journey_read::Journey;
use crate::journey_stitch::{decode_set, strings};

/// The coverage layouts a distillation reads: `FORMAT`, `UNCASED_FORMAT` and
/// `UNTIMED_FORMAT` in `format-layout.ts`.
const COVERAGE: [u8; 3] = [10, 9, 8];
/// `BLOCK_KINDS` in `format-layout.ts`.
const MODULE: u32 = 0;
const FUNCTION: u32 = 1;
/// `NO_LINE` in `written-lines.ts`: a region that kept no lines.
const NO_LINE: u32 = 0;
/// `tests.stopped` for a case that finished.
const FINISHED: u8 = 1;

const COLUMNS: [&str; 14] = [
    "strings.blob",
    "strings.off",
    "tests.path",
    "tests.complete",
    "modules.path",
    "modules.instrumented",
    "modules.blocks",
    "blocks.kind",
    "blocks.start",
    "blocks.end",
    "blocks.source",
    "blocks.loadedSet",
    "sets.blob",
    "sets.off",
];

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

/// A test file's cases, as the case index keeps them.
#[derive(Clone, Copy, Default)]
pub(crate) struct Cases {
    pub count: u32,
    /// Cases that stopped, or did not say whether they finished.
    pub unsettled: u32,
}

pub(crate) struct Record {
    /// The test file of each coverage test row, in row order.
    pub tests: Vec<u32>,
    incomplete: HashSet<u32>,
    pub rows: Vec<Row>,
    loaders: Vec<u32>,
    /// The last row for each file, which is the one a file's lookup answers.
    last: HashMap<u32, u32>,
    /// Per test file, the rows it loaded that are weight candidates, in row order.
    loads: HashMap<u32, Vec<u32>>,
    cases: HashMap<u32, Cases>,
    /// Per module file, `(test file, cases of it that entered the module)`, by test file.
    entered: HashMap<u32, Vec<(u32, u32)>>,
}

impl Record {
    /// A coverage record that carries its case index, read for `distill`.
    pub fn read(bytes: &[u8], paths: &mut Paths) -> Result<Record, String> {
        let (version, decoded) = journey_columns::decode_wanted(bytes, &COLUMNS)?;
        if !COVERAGE.contains(&version) {
            return Err(format!("unsupported test coverage version: {version}"));
        }
        let text = strings(&decoded)?;
        let path = |id: u32, paths: &mut Paths| -> Result<u32, String> {
            text.get(id as usize).map(|name| paths.intern(name)).ok_or_else(|| format!("coverage string id {id} is out of bounds"))
        };
        let test_path = decoded.words("tests.path")?;
        let complete = decoded.values("tests.complete")?;
        if complete.len() != test_path.len() {
            return Err("coverage test columns disagree".to_owned());
        }
        let mut tests = Vec::with_capacity(test_path.len());
        let mut incomplete = HashSet::new();
        for (at, id) in test_path.iter().enumerate() {
            let file = path(*id, paths)?;
            tests.push(file);
            if complete[at] != 1 {
                incomplete.insert(file);
            }
        }

        let module_path = decoded.words("modules.path")?;
        let instrumented = decoded.values("modules.instrumented")?;
        let bounds = decoded.words("modules.blocks")?;
        let kind = decoded.values("blocks.kind")?;
        let start = decoded.words("blocks.start")?;
        let end = decoded.words("blocks.end")?;
        let source = decoded.values("blocks.source")?;
        let loaded_set = decoded.words("blocks.loadedSet")?;
        let sets = decoded.bytes("sets.blob")?;
        let set_offsets = decoded.words("sets.off")?;
        let blocks = kind.len();
        if instrumented.len() != module_path.len() || bounds.len() != module_path.len() + 1 {
            return Err("coverage module columns disagree".to_owned());
        }
        if [start.len(), end.len(), source.len(), loaded_set.len()].iter().any(|length| *length != blocks) {
            return Err("coverage block columns disagree".to_owned());
        }
        let members = |set: u32| -> Result<Vec<u32>, String> {
            let at = set as usize;
            let (from, to) = match (set_offsets.get(at), set_offsets.get(at + 1)) {
                (Some(from), Some(to)) if from <= to && (*to as usize) <= sets.len() => (*from as usize, *to as usize),
                _ => return Err(format!("coverage set id {set} is out of bounds")),
            };
            decode_set(&sets[from..to], tests.len())
        };

        let mut rows = Vec::with_capacity(module_path.len());
        let mut loaders = Vec::new();
        let mut last = HashMap::with_capacity(module_path.len());
        let mut loads: HashMap<u32, Vec<u32>> = HashMap::new();
        for module in 0..module_path.len() {
            let (from, to) = (bounds[module] as usize, bounds[module + 1] as usize);
            if from > to || to > blocks {
                return Err("coverage module block bounds are invalid".to_owned());
            }
            let range = from..to;
            let first = range.clone().find(|block| kind[*block] == MODULE);
            let function = range.clone().any(|block| kind[block] == FUNCTION && source[block] == 1);
            let only_module = range.clone().all(|block| kind[block] == MODULE);
            let lines = first.filter(|block| start[*block] != NO_LINE).map(|block| end[block]);
            let held = loaders.len() as u32;
            if let Some(block) = first {
                let mut by: Vec<u32> = members(loaded_set[block])?
                    .into_iter()
                    .map(|test| tests[test as usize])
                    .collect();
                by.sort_unstable();
                by.dedup();
                loaders.extend(by);
            }
            let row = Row {
                file: path(module_path[module], paths)?,
                instrumented: instrumented[module] == 1,
                function,
                only_module,
                lines,
                loaders: (held, loaders.len() as u32),
            };
            last.insert(row.file, module as u32);
            if row.instrumented && row.function {
                for file in &loaders[held as usize..] {
                    loads.entry(*file).or_default().push(module as u32);
                }
            }
            rows.push(row);
        }

        let (cases, entered) = read_cases(bytes, paths)?;
        Ok(Record { tests, incomplete, rows, loaders, last, loads, cases, entered })
    }

    /// Whether the coverage rows name `file` as a test file.
    pub fn holds(&self, file: u32) -> bool {
        self.tests.contains(&file)
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
        self.cases.get(&file).copied().unwrap_or_default()
    }

    /// How many cases of `test` entered `module` below its top level.
    pub fn entered(&self, module: u32, test: u32) -> u32 {
        let Some(found) = self.entered.get(&module) else { return 0 };
        found.binary_search_by_key(&test, |(file, _)| *file).map_or(0, |at| found[at].1)
    }
}

type Entered = HashMap<u32, Vec<(u32, u32)>>;

/// The case index's cases by test file, and per module how many cases of each
/// test file crossed a region below its top level. A crossing made while the
/// module loaded is not a call: the set spelling keeps it as the region's load
/// flag, never in the called set.
fn read_cases(bytes: &[u8], paths: &mut Paths) -> Result<(HashMap<u32, Cases>, Entered), String> {
    let journey = Journey::of("the record's case index", bytes.to_vec())?;
    let mut file_of = Vec::with_capacity(journey.tests());
    let mut cases: HashMap<u32, Cases> = HashMap::new();
    for test in 0..journey.tests() {
        let file = paths.intern(journey.test_file(test)?);
        file_of.push(file);
        let held = cases.entry(file).or_default();
        held.count += 1;
        if journey.test_settled(test)? != Some(FINISHED) {
            held.unsettled += 1;
        }
    }
    let mut entered = HashMap::with_capacity(journey.modules());
    let mut crossed: Vec<u32> = Vec::new();
    for module in 0..journey.modules() {
        crossed.clear();
        for region in journey.regions(module)? {
            if journey.text(region.kind)? != "module" {
                crossed.extend(journey.members(region.called)?);
            }
        }
        crossed.sort_unstable();
        crossed.dedup();
        let mut counts: Vec<(u32, u32)> = crossed.iter().map(|test| (file_of[*test as usize], 1)).collect();
        counts.sort_unstable_by_key(|(file, _)| *file);
        counts.dedup_by(|next, held| {
            let same = next.0 == held.0;
            if same {
                held.1 += 1;
            }
            same
        });
        // A later row for the same file is the one a lookup by file answers.
        entered.insert(paths.intern(journey.module_file(module)?), counts);
    }
    Ok((cases, entered))
}
