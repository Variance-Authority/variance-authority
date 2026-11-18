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

#[path = "distill_scope.rs"]
mod scope;

use std::collections::HashMap;

use napi::bindgen_prelude::{Buffer, Float64Array, Uint32Array, Uint8Array};
use napi_derive::napi;

use crate::distill_own::{causes_of, Cause, DistillGraph, FileGraph, Scratch};
use crate::distill_read::{Paths, Record};
use crate::distill_cases::DistillRegion;
use crate::distill_rank::{IMPORT, SHARED, UNSEEN};
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

#[napi]
impl DistillRecords {
    /// One test file, as the record holding it reads it; with a graph each unentered module's cause.
    #[napi(catch_unwind)]
    pub fn file(&mut self, file: String, graph: Option<DistillGraph>) -> napi::Result<DistillFile> {
        let graph = graph.map(|graph| FileGraph::new(&graph, &mut self.paths)).transpose().map_err(napi::Error::from_reason)?;
        self.file_using(file, graph)
    }

    #[napi(catch_unwind)]
    pub fn file_native(&mut self, file: String, graph: &crate::selection_graph::SelectionGraph) -> napi::Result<DistillFile> {
        let graph = FileGraph::native(graph, &mut self.paths);
        self.file_using(file, Some(graph))
    }

    fn file_using(&mut self, file: String, graph: Option<FileGraph>) -> napi::Result<DistillFile> {
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
