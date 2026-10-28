//! The coverage sections of a record, written row by row in output order: the
//! one writer the fold of shards and the layering of two records share.
//!
//! A caller writes tests in the order a record holds them, then modules and
//! their regions in theirs, each region's tests as an interned set of the
//! output's test ids. Strings are written as ids the caller numbers; where
//! they are not yet the output dictionary's ranks, [`Columns::renumber`] makes
//! them so once that dictionary is known.

use rustc_hash::FxHashMap;

use crate::journey_columns::Column;
use crate::crossing_sets::SetPool;
use crate::record_coverage::{Phases, PHASES};
use crate::record_layout::LAYOUT;

/// One region row as it is written.
pub(crate) struct Region {
    pub ordinal: u32,
    pub kind: u8,
    pub source: u8,
    pub owner: u32,
    pub digest: u32,
    pub name: u32,
    pub path: u32,
    pub start: u32,
    pub end: u32,
    pub called: u32,
    pub loaded: u32,
}

pub(crate) struct Columns {
    test_path: Vec<u32>,
    test_complete: Vec<u8>,
    test_preconditions: Vec<u32>,
    test_duration: Vec<u32>,
    test_phases: Vec<u32>,
    precondition_name: Vec<u32>,
    precondition_digest: Vec<u32>,
    module_path: Vec<u32>,
    module_source: Vec<u32>,
    module_instrumented: Vec<u8>,
    module_blocks: Vec<u32>,
    block_ordinal: Vec<u32>,
    block_kind: Vec<u8>,
    block_owner: Vec<u32>,
    block_digest: Vec<u32>,
    block_name: Vec<u32>,
    block_path: Vec<u32>,
    block_start: Vec<u32>,
    block_end: Vec<u32>,
    block_source: Vec<u8>,
    block_set: Vec<u32>,
    block_loaded_set: Vec<u32>,
}

impl Columns {
    /// Columns that hold up to the counts given without growing.
    pub fn sized(tests: usize, inputs: usize, modules: usize, blocks: usize) -> Self {
        Columns {
            test_path: Vec::with_capacity(tests),
            test_complete: Vec::with_capacity(tests),
            test_preconditions: Vec::with_capacity(tests + 1),
            test_duration: Vec::with_capacity(tests),
            test_phases: Vec::with_capacity(tests * PHASES),
            precondition_name: Vec::with_capacity(inputs),
            precondition_digest: Vec::with_capacity(inputs),
            module_path: Vec::with_capacity(modules),
            module_source: Vec::with_capacity(modules),
            module_instrumented: Vec::with_capacity(modules),
            module_blocks: Vec::with_capacity(modules + 1),
            block_ordinal: Vec::with_capacity(blocks),
            block_kind: Vec::with_capacity(blocks),
            block_owner: Vec::with_capacity(blocks),
            block_digest: Vec::with_capacity(blocks),
            block_name: Vec::with_capacity(blocks),
            block_path: Vec::with_capacity(blocks),
            block_start: Vec::with_capacity(blocks),
            block_end: Vec::with_capacity(blocks),
            block_source: Vec::with_capacity(blocks),
            block_set: Vec::with_capacity(blocks),
            block_loaded_set: Vec::with_capacity(blocks),
        }
    }

    /// The next test, its preconditions as `(name, digest)` ids in the order written.
    pub fn test(&mut self, path: u32, complete: u8, duration: u32, phases: Phases, preconditions: impl IntoIterator<Item = (u32, u32)>) {
        self.test_path.push(path);
        self.test_complete.push(complete);
        self.test_duration.push(duration);
        self.test_phases.extend_from_slice(&phases);
        self.test_preconditions.push(self.precondition_name.len() as u32);
        for (name, digest) in preconditions {
            self.precondition_name.push(name);
            self.precondition_digest.push(digest);
        }
    }

    /// The next module row; its regions are the ones written until the next.
    pub fn module(&mut self, path: u32, source: u32, instrumented: bool) {
        self.module_path.push(path);
        self.module_source.push(source);
        self.module_instrumented.push(u8::from(instrumented));
        self.module_blocks.push(self.block_ordinal.len() as u32);
    }

    pub fn region(&mut self, region: Region) {
        self.block_ordinal.push(region.ordinal);
        self.block_kind.push(region.kind);
        self.block_owner.push(region.owner);
        self.block_digest.push(region.digest);
        self.block_name.push(region.name);
        self.block_path.push(region.path);
        self.block_start.push(region.start);
        self.block_end.push(region.end);
        self.block_source.push(region.source);
        self.block_set.push(region.called);
        self.block_loaded_set.push(region.loaded);
    }

    pub fn modules(&self) -> usize {
        self.module_path.len()
    }

    /// Every string id written, as `used` marks them.
    pub fn name_in(&self, used: &mut [bool]) {
        for column in self.strings() {
            for id in column {
                used[*id as usize] = true;
            }
        }
    }

    /// Every string id written, as `rank` numbers it.
    pub fn renumber(&mut self, rank: &[u32]) {
        for column in self.strings_mut() {
            for id in column.iter_mut() {
                *id = rank[*id as usize];
            }
        }
    }

    fn strings(&self) -> [&Vec<u32>; 8] {
        [
            &self.test_path,
            &self.precondition_name,
            &self.precondition_digest,
            &self.module_path,
            &self.module_source,
            &self.block_digest,
            &self.block_name,
            &self.block_path,
        ]
    }

    fn strings_mut(&mut self) -> [&mut Vec<u32>; 8] {
        [
            &mut self.test_path,
            &mut self.precondition_name,
            &mut self.precondition_digest,
            &mut self.module_path,
            &mut self.module_source,
            &mut self.block_digest,
            &mut self.block_name,
            &mut self.block_path,
        ]
    }

    /// The sections, in the order a record holds them, naming the dictionary
    /// `blob` and `offsets` spell and the region sets of `sets`.
    pub fn encoded(mut self, blob: Vec<u8>, offsets: Vec<u32>, instrumentation: u32, commit: Option<u32>, sets: &SetPool) -> Result<Vec<Column>, String> {
        self.test_preconditions.push(self.precondition_name.len() as u32);
        self.module_blocks.push(self.block_ordinal.len() as u32);
        let name = |name: &str| -> Result<&'static str, String> {
            LAYOUT.coverage.sections.iter().find(|section| section.as_str() == name).map(String::as_str).ok_or_else(|| {
                format!("record-layout.json names no coverage section {name}, and the fold writes one")
            })
        };
        let columns = [
            Column::Blob(name("strings.blob")?, blob, offsets.clone()),
            Column::Words(name("strings.off")?, offsets),
            Column::Words(name("snapshot.instrumentation")?, vec![instrumentation]),
            Column::Words(name("snapshot.commit")?, commit.into_iter().collect()),
            Column::Words(name("tests.path")?, self.test_path),
            Column::Bytes(name("tests.complete")?, self.test_complete),
            Column::Words(name("tests.preconditions")?, self.test_preconditions),
            Column::Words(name(&LAYOUT.coverage.duration)?, self.test_duration),
            Column::Words(name(&LAYOUT.coverage.phases)?, self.test_phases),
            Column::Words(name("preconditions.name")?, self.precondition_name),
            Column::Words(name("preconditions.digest")?, self.precondition_digest),
            Column::Words(name("modules.path")?, self.module_path),
            Column::Words(name("modules.source")?, self.module_source),
            Column::Bytes(name("modules.instrumented")?, self.module_instrumented),
            Column::Words(name("modules.blocks")?, self.module_blocks),
            Column::Words(name("blocks.ordinal")?, self.block_ordinal),
            Column::Bytes(name("blocks.kind")?, self.block_kind),
            Column::Words(name("blocks.owner")?, self.block_owner),
            Column::Words(name("blocks.digest")?, self.block_digest),
            Column::Words(name("blocks.name")?, self.block_name),
            Column::Words(name("blocks.path")?, self.block_path),
            Column::Words(name("blocks.start")?, self.block_start),
            Column::Words(name("blocks.end")?, self.block_end),
            Column::Bytes(name("blocks.source")?, self.block_source),
            Column::Words(name("blocks.set")?, self.block_set),
            Column::Words(name("blocks.loadedSet")?, self.block_loaded_set),
            Column::Blob(name("sets.blob")?, sets.bytes().to_vec(), sets.offsets().to_vec()),
            Column::Words(name("sets.off")?, sets.offsets().to_vec()),
        ];
        let mut columns: FxHashMap<&str, Column> = columns
            .into_iter()
            .map(|column| match &column {
                Column::Bytes(name, _) | Column::Words(name, _) | Column::Blob(name, _, _) | Column::Plain(name, _) => (*name, column),
            })
            .collect();
        // Every section the layout names, in its order; one the writer does not write fails here.
        LAYOUT.coverage.sections.iter().map(|section| columns.remove(section.as_str()).ok_or_else(|| format!("the fold writes no coverage section {section}"))).collect()
    }
}
