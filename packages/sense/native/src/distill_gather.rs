//! `variance distill` over records: every test file of a scope read against
//! its cases, and what each loaded for nothing gathered under the import that
//! brought it in.
//!
//! The records are read once into `DistillRecords`; a scope, its rows and one
//! test file are each a call on it, so the flat reading that decides whether the
//! file graph is worth scanning does not cost a second read. Test files are
//! read in parallel and gathered by commutative sums keyed by path id, then
//! sorted by a total order over names: the answer does not depend on how the
//! work was split. JavaScript turns the columns into the published shapes.

use std::collections::HashMap;
use std::sync::Mutex;

use napi::bindgen_prelude::{Buffer, Float64Array, Uint32Array, Uint8Array};
use napi_derive::napi;
use rayon::prelude::*;

use crate::distill_own::{causes_of, Cause, DistillGraph, FileGraph, Scratch};
use crate::distill_read::{Paths, Record};
use crate::distill_cases::DistillRegion;
use crate::distill_rank::{ranked, Ranked, IMPORT, SHARED, UNSEEN};
use crate::order::code_unit;

/// A reading's withheld code: none, no cases, an incomplete coverage row, a case that did not settle.
const READ: u8 = 0;
const NO_CASES: u8 = 1;
const INCOMPLETE: u8 = 2;
const UNSETTLED: u8 = 3;


/// Records read once for any number of distillations.
#[napi]
pub struct DistillRecords {
    paths: Paths,
    records: Vec<Record>,
}

/// Each test file read, in reading order, one column per field; ids index `names`.
#[napi(object)]
pub struct DistillReadings {
    pub file: Uint32Array,
    pub record: Uint32Array,
    pub cases: Uint32Array,
    pub withheld: Uint8Array,
    pub unsettled: Uint32Array,
    pub loaded: Uint32Array,
    pub loaded_lines: Float64Array,
    pub unentered: Uint32Array,
    pub unentered_lines: Float64Array,
}

/// A scope: its readings, its totals and its spills, heaviest first.
#[napi(object)]
pub struct DistillScope {
    pub names: Vec<String>,
    pub readings: DistillReadings,
    pub loads: f64,
    pub lines: f64,
    pub kind: Uint8Array,
    pub importer: Uint32Array,
    pub imported: Uint32Array,
    pub lazy: Uint8Array,
    pub spill_lines: Float64Array,
    pub module_offset: Uint32Array,
    pub modules: Uint32Array,
    pub file_offset: Uint32Array,
    pub files: Uint32Array,
}

/// One test file, with the modules fewer than all of its cases entered, in the order it lists them.
#[napi(object)]
pub struct DistillFile {
    /// Whether the record's coverage rows hold the file at all.
    pub held: bool,
    /// The record that holds it, by its place among the records.
    pub record: u32,
    pub names: Vec<String>,
    pub cases: u32,
    pub loaded: u32,
    pub lines: f64,
    pub withheld: u8,
    pub unsettled: u32,
    pub module: Uint32Array,
    /// The module's lines; `has_lines` says whether the record kept any.
    pub module_lines: Float64Array,
    pub has_lines: Uint8Array,
    pub entered: Uint32Array,
    pub kind: Uint8Array,
    /// An import's importer and imported; a shared module's `parts` is in `imported`.
    pub importer: Uint32Array,
    pub imported: Uint32Array,
    pub lazy: Uint8Array,
    /// How many test files load the importer.
    pub loading: Uint32Array,
    /// The files the test file loads, as the graph lists them: its subject. Empty without a graph.
    pub subjects: Uint32Array,
}

/// The records' coverage rows and case indexes, read for distillation.
#[napi(catch_unwind)]
pub fn read_distill_records(records: Vec<Buffer>) -> napi::Result<DistillRecords> {
    let mut paths = Paths::default();
    let records = records
        .iter()
        .map(|bytes| Record::read(bytes, &mut paths))
        .collect::<Result<Vec<_>, _>>()
        .map_err(napi::Error::from_reason)?;
    Ok(DistillRecords { paths, records })
}

struct Module {
    file: u32,
    lines: Option<u32>,
    entered: u32,
    cause: Option<Cause>,
}

struct Reading {
    cases: u32,
    withheld: u8,
    unsettled: u32,
    loaded: u32,
    lines: u64,
    unentered: u32,
    unentered_lines: u64,
    modules: Vec<Module>,
}

#[derive(Default)]
struct Spill {
    lazy: bool,
    modules: Vec<u32>,
    files: Vec<u32>,
    lines: u64,
}

type Key = (u8, u32, u32);

#[derive(Default)]
struct Gathered {
    rows: Vec<Reading>,
    spills: HashMap<Key, Spill>,
    loads: u64,
    lines: u64,
}

#[napi]
impl DistillRecords {
    /// Every test file the records hold under `within` (a directory without a trailing `/`; absent, all of them),
    /// record by record in code-unit order, and with a graph each spill's import.
    #[napi(catch_unwind)]
    pub fn scope(&mut self, within: Option<String>, graph: Option<DistillGraph>) -> napi::Result<DistillScope> {
        let graph = graph.map(|graph| FileGraph::new(&graph, &mut self.paths)).transpose().map_err(napi::Error::from_reason)?;
        let paths = &self.paths;
        let inside = |file: u32| within.as_ref().is_none_or(|within| {
            paths.name(file).strip_prefix(within.as_str()).is_some_and(|rest| rest.starts_with('/'))
        });
        let mut work: Vec<(u32, u32)> = Vec::new();
        for (at, record) in self.records.iter().enumerate() {
            let mut files: Vec<u32> = record.tests.iter().copied().filter(|file| inside(*file)).collect();
            files.sort_unstable();
            files.dedup();
            files.sort_by(|a, b| code_unit(paths.name(*a), paths.name(*b)));
            work.extend(files.into_iter().map(|file| (at as u32, file)));
        }
        // Reading every module's entries once costs a pass over the index; asking them one load at a time costs a
        // pass over that module's regions. A scope that asks fewer loads than the index holds modules asks them.
        let mut asked = vec![0usize; self.records.len()];
        for (record, file) in &work {
            asked[*record as usize] += self.records[*record as usize].loads(*file).len();
        }
        for (record, asked) in self.records.iter_mut().zip(asked) {
            if asked >= record.indexed_modules().map_err(napi::Error::from_reason)? {
                record.enter_all(&self.paths).map_err(napi::Error::from_reason)?;
            }
        }
        let paths = &self.paths;
        let size = paths.len();
        let records = &self.records;
        let graph = graph.as_ref();
        // One scratch per worker thread, taken by the thread that runs the reading: never contended.
        let scratches: Vec<Mutex<Option<Scratch>>> = (0..rayon::current_num_threads().max(1)).map(|_| Mutex::new(None)).collect();
        let read: Vec<(Reading, Vec<Load>)> = work
            .par_iter()
            .with_min_len(16)
            .map(|(record, file)| {
                let slot = rayon::current_thread_index().unwrap_or(0) % scratches.len();
                let mut scratch = scratches[slot].lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                let reading = read(&records[*record as usize], paths, *file, graph, scratch.get_or_insert_with(|| Scratch::new(size)))?;
                let loads = loads_of(&reading, graph.is_some());
                // A scope keeps a reading's summary; only one test file read alone lists its modules.
                Ok((Reading { modules: Vec::new(), ..reading }, loads))
            })
            .collect::<Result<_, String>>()
            .map_err(napi::Error::from_reason)?;
        // Gathered in reading order, one test file after another: the sums and the sets do not depend on how the work was split.
        let mut gathered = Gathered::default();
        for ((_, file), (_, loads)) in work.iter().zip(&read) {
            gather(&mut gathered, *file, loads);
        }
        gathered.rows = read.into_iter().map(|(reading, _)| reading).collect();
        Ok(self.present(&work, gathered))
    }

    /// One test file, as the record holding it reads it; with a graph each unentered module's cause.
    #[napi(catch_unwind)]
    pub fn file(&mut self, file: String, graph: Option<DistillGraph>) -> napi::Result<DistillFile> {
        let graph = graph.map(|graph| FileGraph::new(&graph, &mut self.paths)).transpose().map_err(napi::Error::from_reason)?;
        let id = self.paths.id(&file);
        let found = id.and_then(|id| self.records.iter().position(|record| record.holds(id)).map(|at| (id, at)));
        let mut names = Names::default();
        let Some((id, at)) = found else {
            return Ok(DistillFile::empty());
        };
        let record = &self.records[at];
        let mut scratch = Scratch::new(self.paths.len());
        let reading = read(record, &self.paths, id, graph.as_ref(), &mut scratch).map_err(napi::Error::from_reason)?;
        let column = |pick: &dyn Fn(&Module) -> u32| Uint32Array::new(reading.modules.iter().map(pick).collect());
        let module = Uint32Array::new(reading.modules.iter().map(|module| names.id(&self.paths, module.file)).collect());
        let (mut importer, mut imported, mut kind, mut lazy, mut loading) = (vec![], vec![], vec![], vec![], vec![]);
        for module in &reading.modules {
            let (k, a, b, l) = match module.cause {
                None => (0, 0, 0, false),
                Some(Cause::Import { importer, imported, lazy }) => (IMPORT, names.id(&self.paths, importer), names.id(&self.paths, imported), lazy),
                Some(Cause::Shared { parts }) => (SHARED, 0, names.id(&self.paths, parts), false),
                Some(Cause::Unseen) => (UNSEEN, 0, 0, false),
            };
            let loads = match module.cause {
                Some(Cause::Import { importer, .. }) => record.row_of(importer).map_or(0, |row| record.loading(row)),
                _ => 0,
            };
            kind.push(k);
            importer.push(a);
            imported.push(b);
            lazy.push(u8::from(l));
            loading.push(loads);
        }
        let subjects = graph.as_ref().map_or_else(Vec::new, |graph| graph.imports(id).iter().map(|file| names.id(&self.paths, *file)).collect());
        Ok(DistillFile {
            held: true,
            record: at as u32,
            cases: reading.cases,
            loaded: reading.loaded,
            lines: reading.lines as f64,
            withheld: reading.withheld,
            unsettled: reading.unsettled,
            module,
            module_lines: Float64Array::new(reading.modules.iter().map(|module| module.lines.unwrap_or(0) as f64).collect()),
            has_lines: Uint8Array::new(reading.modules.iter().map(|module| u8::from(module.lines.is_some())).collect()),
            entered: column(&|module| module.entered),
            kind: Uint8Array::new(kind),
            importer: Uint32Array::new(importer),
            imported: Uint32Array::new(imported),
            lazy: Uint8Array::new(lazy),
            loading: Uint32Array::new(loading),
            subjects: Uint32Array::new(subjects),
            names: names.names,
        })
    }
}

#[napi]
impl DistillRecords {
    /// The record that holds `file`, by its place among the records; none when no record does.
    #[napi(catch_unwind)]
    pub fn holder(&self, file: String) -> Option<u32> {
        let id = self.paths.id(&file)?;
        self.records.iter().position(|record| record.holds(id)).map(|at| at as u32)
    }

    /// The regions the record holding `file` keeps for `importer`, read against
    /// `file`'s cases; none when no record holds it or the index keeps no module for `importer`.
    #[napi(catch_unwind)]
    pub fn regions(&self, file: String, importer: String) -> napi::Result<Vec<DistillRegion>> {
        let Some(id) = self.paths.id(&file) else { return Ok(Vec::new()) };
        let Some(record) = self.records.iter().find(|record| record.holds(id)) else { return Ok(Vec::new()) };
        record.regions(&importer, id).map_err(napi::Error::from_reason)
    }
}

impl DistillFile {
    fn empty() -> DistillFile {
        DistillFile {
            held: false,
            record: 0,
            names: Vec::new(),
            cases: 0,
            loaded: 0,
            lines: 0.0,
            withheld: READ,
            unsettled: 0,
            module: Uint32Array::new(vec![]),
            module_lines: Float64Array::new(vec![]),
            has_lines: Uint8Array::new(vec![]),
            entered: Uint32Array::new(vec![]),
            kind: Uint8Array::new(vec![]),
            importer: Uint32Array::new(vec![]),
            imported: Uint32Array::new(vec![]),
            lazy: Uint8Array::new(vec![]),
            loading: Uint32Array::new(vec![]),
            subjects: Uint32Array::new(vec![]),
        }
    }
}

/// One test file's loads against its cases' entries, `readTestFile` in `@variance-authority/distill` before it moved here.
fn read(record: &Record, paths: &Paths, file: u32, graph: Option<&FileGraph>, scratch: &mut Scratch) -> Result<Reading, String> {
    let cases = record.cases(file);
    let candidates: Vec<u32> = record.loads(file).iter().copied().filter(|row| record.row(*row).file != file).collect();
    let lines = candidates.iter().map(|row| u64::from(record.row(*row).lines.unwrap_or(0))).sum();
    let withheld = if cases.count == 0 {
        NO_CASES
    } else if record.incomplete(file) {
        INCOMPLETE
    } else if cases.unsettled > 0 {
        UNSETTLED
    } else {
        READ
    };
    let mut reading = Reading { cases: cases.count, withheld, unsettled: cases.unsettled, loaded: candidates.len() as u32, lines, unentered: 0, unentered_lines: 0, modules: Vec::new() };
    if withheld != READ {
        return Ok(reading);
    }
    let mut modules: Vec<Module> = candidates
        .iter()
        .map(|row| {
            let measured = record.row(*row);
            Ok(Module { file: measured.file, lines: measured.lines, entered: record.entered(paths, measured.file, file)?, cause: None })
        })
        .collect::<Result<_, String>>()?;
    if let Some(graph) = graph {
        let asked: Vec<u32> = modules.iter().filter(|module| module.entered == 0).map(|module| module.file).collect();
        if !asked.is_empty() {
            let mut entered: Vec<(u32, u32)> = modules.iter().map(|module| (module.file, module.entered)).collect();
            entered.sort_unstable();
            entered.dedup();
            let causes = causes_of(record, graph, file, &entered, &asked, scratch);
            for (module, cause) in modules.iter_mut().filter(|module| module.entered == 0).zip(causes) {
                module.cause = Some(cause);
            }
        }
    }
    modules.retain(|module| module.entered < cases.count);
    // Stable, so a file the coverage rows repeat keeps their order.
    modules.sort_by(|left, right| {
        left.entered
            .cmp(&right.entered)
            .then_with(|| right.lines.map_or(-1, i64::from).cmp(&left.lines.map_or(-1, i64::from)))
            .then_with(|| code_unit(paths.name(left.file), paths.name(right.file)))
    });
    let unentered = modules.iter().filter(|module| module.entered == 0);
    reading.unentered = unentered.clone().count() as u32;
    reading.unentered_lines = unentered.map(|module| u64::from(module.lines.unwrap_or(0))).sum();
    reading.modules = modules;
    Ok(reading)
}

/// One module a test file loaded and no case of it entered, under its cause.
struct Load {
    key: Key,
    lazy: bool,
    module: u32,
    lines: u64,
}

/// A reading's unentered modules under their causes; with no graph, each module is its own spill.
fn loads_of(reading: &Reading, caused: bool) -> Vec<Load> {
    reading
        .modules
        .iter()
        .filter(|module| module.entered == 0)
        .map(|module| {
            let (key, lazy) = match module.cause {
                _ if !caused => ((0, module.file, 0), false),
                Some(Cause::Import { importer, imported, lazy }) => ((IMPORT, importer, imported), lazy),
                Some(Cause::Shared { .. }) => ((SHARED, 0, 0), false),
                Some(Cause::Unseen) | None => ((UNSEEN, 0, 0), false),
            };
            Load { key, lazy, module: module.file, lines: u64::from(module.lines.unwrap_or(0)) }
        })
        .collect()
}

fn gather(held: &mut Gathered, file: u32, loads: &[Load]) {
    for load in loads {
        let spill = held.spills.entry(load.key).or_default();
        spill.lazy = load.lazy;
        spill.modules.push(load.module);
        if spill.files.last() != Some(&file) {
            spill.files.push(file);
        }
        spill.lines += load.lines;
        held.loads += 1;
        held.lines += load.lines;
    }
}

impl DistillRecords {
    fn present(&self, work: &[(u32, u32)], mut gathered: Gathered) -> DistillScope {
        let paths = &self.paths;
        let mut names = Names::default();
        let rows = &gathered.rows;
        let readings = DistillReadings {
            file: Uint32Array::new(work.iter().map(|(_, file)| names.id(paths, *file)).collect()),
            record: Uint32Array::new(work.iter().map(|(record, _)| *record).collect()),
            cases: Uint32Array::new(rows.iter().map(|reading| reading.cases).collect()),
            withheld: Uint8Array::new(rows.iter().map(|reading| reading.withheld).collect()),
            unsettled: Uint32Array::new(rows.iter().map(|reading| reading.unsettled).collect()),
            loaded: Uint32Array::new(rows.iter().map(|reading| reading.loaded).collect()),
            loaded_lines: Float64Array::new(rows.iter().map(|reading| reading.lines as f64).collect()),
            unentered: Uint32Array::new(rows.iter().map(|reading| reading.unentered).collect()),
            unentered_lines: Float64Array::new(rows.iter().map(|reading| reading.unentered_lines as f64).collect()),
        };

        let mut spills: Vec<(Key, Spill)> = gathered
            .spills
            .drain()
            .map(|(key, mut spill)| {
                let by_name = |a: &u32, b: &u32| code_unit(paths.name(*a), paths.name(*b));
                spill.modules.sort_unstable();
                spill.modules.dedup();
                spill.modules.sort_by(by_name);
                spill.files.sort_unstable();
                spill.files.dedup();
                spill.files.sort_by(by_name);
                (key, spill)
            })
            .collect();
        let rank_of = |(key, spill): &(Key, Spill)| Ranked {
            kind: key.0,
            importer: match key.0 {
                0 => paths.name(spill.modules[0]),
                IMPORT => paths.name(key.1),
                _ => "",
            },
            imported: if key.0 == IMPORT { paths.name(key.2) } else { "" },
            lazy: spill.lazy,
            lines: spill.lines,
            files: spill.files.len(),
        };
        spills.sort_by(|a, b| ranked(&rank_of(a), &rank_of(b)));

        let (mut kind, mut importer, mut imported, mut lazy, mut lines) = (vec![], vec![], vec![], vec![], vec![]);
        let (mut module_offset, mut modules, mut file_offset, mut files) = (vec![0], vec![], vec![0], vec![]);
        for ((k, a, b), spill) in &spills {
            kind.push(*k);
            importer.push(if *k == IMPORT { names.id(paths, *a) } else { 0 });
            imported.push(if *k == IMPORT { names.id(paths, *b) } else { 0 });
            lazy.push(u8::from(spill.lazy));
            lines.push(spill.lines as f64);
            modules.extend(spill.modules.iter().map(|module| names.id(paths, *module)));
            module_offset.push(modules.len() as u32);
            files.extend(spill.files.iter().map(|file| names.id(paths, *file)));
            file_offset.push(files.len() as u32);
        }
        DistillScope {
            names: names.names,
            readings,
            loads: gathered.loads as f64,
            lines: gathered.lines as f64,
            kind: Uint8Array::new(kind),
            importer: Uint32Array::new(importer),
            imported: Uint32Array::new(imported),
            lazy: Uint8Array::new(lazy),
            spill_lines: Float64Array::new(lines),
            module_offset: Uint32Array::new(module_offset),
            modules: Uint32Array::new(modules),
            file_offset: Uint32Array::new(file_offset),
            files: Uint32Array::new(files),
        }
    }
}

/// The path ids an answer names, renumbered into a table of only those.
#[derive(Default)]
struct Names {
    ids: HashMap<u32, u32>,
    names: Vec<String>,
}

impl Names {
    fn id(&mut self, paths: &Paths, path: u32) -> u32 {
        *self.ids.entry(path).or_insert_with(|| {
            self.names.push(paths.name(path).to_owned());
            self.names.len() as u32 - 1
        })
    }
}
