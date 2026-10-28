//! Coverage records written for tests, spelled column by column as
//! `format.ts` lays them out but with the dictionary in the order strings were
//! first named, not sorted, so a fold that trusted a shard's ids to be ranks
//! would be caught; and the same records read back as plain values.

use rustc_hash::FxHashMap;

use crate::journey_columns::{self, Column};
use crate::crossing_sets::{self, SetPool};
use crate::record_coverage;
use crate::record_layout::LAYOUT;

pub struct Test {
    pub file: &'static str,
    pub complete: bool,
    pub duration: Option<u32>,
    /// Its phases, written only in the current layout; `None` for a runner that reported none.
    pub phases: Option<record_coverage::Phases>,
    pub preconditions: Vec<(&'static str, &'static str)>,
}

pub struct Block {
    pub ordinal: u32,
    pub name: String,
    pub start: u32,
    /// The ordinal of the region around it, or `no_owner`.
    pub owner: u32,
    /// The tests, by their row in the shard, that called the region.
    pub called: Vec<u32>,
    pub loaded: Vec<u32>,
}

pub struct Module {
    pub file: &'static str,
    pub source: &'static str,
    pub instrumented: bool,
    pub blocks: Vec<Block>,
}

pub struct Spec {
    pub version: u8,
    pub instrumentation: &'static str,
    pub commit: Option<&'static str>,
    pub tests: Vec<Test>,
    pub modules: Vec<Module>,
    /// Case parts, `(part, bytes)`, in the order a record holds them.
    pub parts: Vec<(&'static str, Vec<u8>)>,
    /// The record its run started from, as the `base` part holds it: `none`
    /// unless a test names one, and no part at all for `None`.
    pub base: Option<&'static str>,
}

pub fn test(file: &'static str) -> Test {
    Test { file, complete: true, duration: Some(file.len() as u32), phases: None, preconditions: Vec::new() }
}

pub fn block(ordinal: u32, called: &[u32]) -> Block {
    Block { ordinal, name: format!("f{ordinal}"), start: ordinal + 1, owner: LAYOUT.coverage.no_owner, called: called.to_vec(), loaded: Vec::new() }
}

pub fn module(file: &'static str, blocks: Vec<Block>) -> Module {
    Module { file, source: "text-1", instrumented: true, blocks }
}

pub fn spec(tests: Vec<Test>, modules: Vec<Module>) -> Spec {
    Spec { version: LAYOUT.coverage.format, instrumentation: "istanbul", commit: Some("c0ffee"), tests, modules, parts: Vec::new(), base: Some("none") }
}

#[derive(Default)]
struct Strings {
    ids: FxHashMap<String, u32>,
    values: Vec<String>,
}

impl Strings {
    fn id(&mut self, value: &str) -> u32 {
        if let Some(id) = self.ids.get(value) {
            return *id;
        }
        self.ids.insert(value.to_owned(), self.values.len() as u32);
        self.values.push(value.to_owned());
        self.values.len() as u32 - 1
    }
}

fn name(section: &str) -> &'static str {
    LAYOUT.coverage.sections.iter().find(|name| name.as_str() == section).unwrap().as_str()
}

pub fn write(spec: &Spec) -> Vec<u8> {
    let mut strings = Strings::default();
    let words = |section: &str, values: Vec<u32>| Column::Words(name(section), values);
    let bytes = |section: &str, values: Vec<u8>| Column::Bytes(name(section), values);
    let instrumentation = strings.id(spec.instrumentation);
    let commit: Vec<u32> = spec.commit.iter().map(|commit| strings.id(commit)).collect();
    let mut preconditions = vec![0];
    let (mut names, mut digests) = (Vec::new(), Vec::new());
    for test in &spec.tests {
        for (name, digest) in &test.preconditions {
            names.push(strings.id(name));
            digests.push(strings.id(digest));
        }
        preconditions.push(names.len() as u32);
    }
    let test_path: Vec<u32> = spec.tests.iter().map(|test| strings.id(test.file)).collect();
    let mut sets = SetPool::new(spec.tests.len());
    let (mut module_blocks, mut ordinal, mut digest, mut block_name, mut start, mut owner, mut set, mut loaded) =
        (vec![0], Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for module in &spec.modules {
        for block in &module.blocks {
            ordinal.push(block.ordinal);
            digest.push(strings.id(&format!("d{}", block.ordinal)));
            block_name.push(strings.id(&block.name));
            start.push(block.start);
            owner.push(block.owner);
            set.push(sets.intern(&block.called));
            loaded.push(sets.intern(&block.loaded));
        }
        module_blocks.push(ordinal.len() as u32);
    }
    let module_path: Vec<u32> = spec.modules.iter().map(|module| strings.id(module.file)).collect();
    let module_source: Vec<u32> = spec.modules.iter().map(|module| strings.id(module.source)).collect();
    let blocks = ordinal.len();
    let mut offsets = vec![0];
    let mut blob = Vec::new();
    for value in &strings.values {
        blob.extend_from_slice(value.as_bytes());
        offsets.push(blob.len() as u32);
    }
    let mut columns = vec![
        Column::Blob(name("strings.blob"), blob, offsets.clone()),
        words("strings.off", offsets),
        words("snapshot.instrumentation", vec![instrumentation]),
        words("snapshot.commit", commit),
        words("tests.path", test_path),
        bytes("tests.complete", spec.tests.iter().map(|test| u8::from(test.complete)).collect()),
        words("tests.preconditions", preconditions),
    ];
    if spec.version != LAYOUT.coverage.untimed {
        columns.push(words(&LAYOUT.coverage.duration, spec.tests.iter().map(|test| test.duration.unwrap_or(LAYOUT.coverage.no_duration)).collect()));
    }
    if spec.version == LAYOUT.coverage.format {
        let none = [LAYOUT.coverage.no_duration; record_coverage::PHASES];
        columns.push(words(&LAYOUT.coverage.phases, spec.tests.iter().flat_map(|test| test.phases.unwrap_or(none)).collect()));
    }
    columns.extend([
        words("preconditions.name", names),
        words("preconditions.digest", digests),
        words("modules.path", module_path),
        words("modules.source", module_source),
        bytes("modules.instrumented", spec.modules.iter().map(|module| u8::from(module.instrumented)).collect()),
        words("modules.blocks", module_blocks),
        words("blocks.ordinal", ordinal),
        // A region with an owner is a function's, never a module's top level.
        bytes("blocks.kind", owner.iter().map(|owner| u8::from(*owner != LAYOUT.coverage.no_owner)).collect()),
        words("blocks.owner", owner),
        words("blocks.digest", digest),
        words("blocks.name", block_name.clone()),
        words("blocks.path", block_name),
        words("blocks.start", start.clone()),
        words("blocks.end", start),
        bytes("blocks.source", vec![1; blocks]),
        words("blocks.set", set),
        words("blocks.loadedSet", loaded),
        Column::Blob(name("sets.blob"), sets.bytes().to_vec(), sets.offsets().to_vec()),
        words("sets.off", sets.offsets().to_vec()),
    ]);
    for (part, bytes) in &spec.parts {
        columns.push(Column::Plain(LAYOUT.coverage.part(part), bytes.clone()));
    }
    if let Some(base) = spec.base {
        columns.push(Column::Plain(LAYOUT.coverage.part("base"), base.as_bytes().to_vec()));
    }
    journey_columns::encode(columns, spec.version).unwrap()
}

/// One region as read back: its ordinal, and the files of the tests that called and loaded it.
pub type Region = (u32, Vec<String>, Vec<String>);

/// Each test's file and phases, in the order the record holds them.
pub fn phases(bytes: &[u8]) -> Vec<(String, record_coverage::Phases)> {
    let coverage = record_coverage::read(bytes).unwrap().coverage.unwrap();
    let strings = coverage.strings().unwrap();
    (0..coverage.tests()).map(|at| (strings[coverage.test_path[at] as usize].to_owned(), coverage.phases(at))).collect()
}

/// A record's coverage as plain values: `(file, complete, duration)` a test, and `(file, instrumented, regions)` a module.
pub fn read(bytes: &[u8]) -> (Vec<(String, bool, Option<u32>)>, Vec<(String, bool, Vec<Region>)>) {
    let record = record_coverage::read(bytes).unwrap();
    let coverage = record.coverage.unwrap();
    let strings = coverage.strings().unwrap();
    let files: Vec<String> = coverage.test_path.iter().map(|id| strings[*id as usize].to_owned()).collect();
    let tests = (0..coverage.tests())
        .map(|at| {
            let duration = coverage.test_duration.as_ref().map(|duration| duration[at]).filter(|value| *value != LAYOUT.coverage.no_duration);
            (files[at].clone(), coverage.test_complete[at] == 1, duration)
        })
        .collect();
    let members = |set: u32| -> Vec<String> {
        let stored = crossing_sets::set_slice(&coverage.set_bytes, &coverage.set_offsets, set).unwrap();
        crossing_sets::decode_set(stored, coverage.tests()).unwrap().into_iter().map(|test| files[test as usize].clone()).collect()
    };
    let modules = (0..coverage.modules())
        .map(|at| {
            let regions = coverage.blocks(at).map(|row| (coverage.block_ordinal[row], members(coverage.block_set[row]), members(coverage.block_loaded_set[row]))).collect();
            (strings[coverage.module_path[at] as usize].to_owned(), coverage.module_instrumented[at] == 1, regions)
        })
        .collect();
    (tests, modules)
}
