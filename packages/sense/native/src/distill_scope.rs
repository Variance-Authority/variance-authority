//! Scope-wide distillation: parallel readings gathered and ranked by cause.
// compass: variance-authority.reach
use std::collections::HashMap;
use std::sync::Mutex;
use napi::bindgen_prelude::{Float64Array, Uint32Array, Uint8Array};
use napi_derive::napi;
use rayon::prelude::*;
use crate::distill_own::{Cause, DistillGraph, FileGraph, Scratch};
use crate::distill_rank::{ranked, Ranked, IMPORT, SHARED, UNSEEN};
use crate::order::code_unit;
use super::{read, DistillRecords, DistillScope, DistillReadings, Reading, Names};

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
        self.scope_using(within, graph)
    }

    #[napi(catch_unwind)]
    pub fn scope_native(&mut self, within: Option<String>, graph: &crate::selection_graph::SelectionGraph) -> napi::Result<DistillScope> {
        let graph = FileGraph::native(graph, &mut self.paths);
        self.scope_using(within, Some(graph))
    }

    fn scope_using(&mut self, within: Option<String>, graph: Option<FileGraph>) -> napi::Result<DistillScope> {
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
