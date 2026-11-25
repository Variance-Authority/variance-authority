//! `encodeCoverage`: one run's coverage, handed over as columns, written as the
//! coverage sections of a record.
//!
//! The rows come in whatever order the caller holds them in. The output is a
//! function of their contents only, as the fold's is: tests and modules in
//! code-unit order of their paths (rows of one path in the order given),
//! regions by ordinal, preconditions by name then digest with repeats dropped,
//! ids as ranks in that order, every crossing set ascending, and a dictionary
//! of exactly the strings the output names, sorted.
//!
//! A region's crossers are named by index into `members`, a list of test files
//! the caller keeps once, or read from a run's crossings
//! (`record_coverage_crossers`); a name no test row holds is refused, as is a
//! test row whose path another already holds.

use napi::bindgen_prelude::{Buffer, Uint32Array, Uint8Array};
use napi_derive::napi;

use crate::crossing_sets::SetPool;
use crate::journey_columns::{self, Column};
use crate::order;
use crate::record_coverage::{Phases, Start, PHASES, START};
use crate::record_coverage_columns::{Columns, Region};
use crate::record_coverage_crossers::{self, Crossers, RunCrossed};
use crate::record_coverage_dictionary::{Dictionary, Spelled};
use crate::record_layout::LAYOUT;

/// One run's coverage as columns. Words are already the record's: a duration
/// or a phase nobody reported is `noDuration`, an owner or a line that is
/// absent is `noOwner` or `noLine`, a kind is its index in `blockKinds`.
#[napi(object)]
pub struct CoverageRows {
    pub instrumentation: String,
    pub commit: Option<String>,
    pub test_path: Vec<String>,
    pub test_complete: Uint8Array,
    pub test_duration: Uint32Array,
    /// `PHASES` words per test.
    pub test_phases: Uint32Array,
    /// `START` words per test.
    pub test_start: Uint32Array,
    /// Per test, where its preconditions start; one more entry than tests.
    pub test_preconditions: Uint32Array,
    pub precondition_name: Vec<String>,
    pub precondition_digest: Vec<String>,
    pub module_path: Vec<String>,
    pub module_source: Vec<String>,
    pub module_blob: Vec<Option<String>>,
    pub module_instrumented: Uint8Array,
    /// Per module, where its regions start; one more entry than modules.
    pub module_blocks: Uint32Array,
    pub block_ordinal: Uint32Array,
    pub block_kind: Uint8Array,
    pub block_owner: Uint32Array,
    /// A region's digest, name and path, as indexes into `block_strings`.
    pub block_digest: Uint32Array,
    pub block_name: Uint32Array,
    pub block_path: Uint32Array,
    /// The strings regions name, each once.
    pub block_strings: Vec<String>,
    pub block_start: Uint32Array,
    pub block_end: Uint32Array,
    pub block_source: Uint8Array,
    /// The test files a region's crossers are named by.
    pub members: Vec<String>,
    /// Per region, where its crossers start in `called`; one more entry than regions.
    pub called_offsets: Uint32Array,
    pub called: Uint32Array,
    /// Per region, where what loaded it starts in `loaded`; one more entry than regions.
    pub loaded_offsets: Uint32Array,
    pub loaded: Uint32Array,
    /// A run's crossings, read in place of `members`, `called` and `loaded`, which are then empty.
    pub crossed: Option<RunCrossed>,
}

/// The coverage record `rows` describe, or a refusal naming what is wrong with them.
/// bound: the modules and tests of one record
#[napi(catch_unwind)]
pub fn encode_coverage(rows: CoverageRows) -> napi::Result<Buffer> {
    encoded(&rows).map(Buffer::from).map_err(napi::Error::from_reason)
}

/// What each test file of `rows` ran over, as `[file, digest]` in row order.
/// bound: one run's test files
#[napi(catch_unwind)]
pub fn coverage_inputs(rows: CoverageRows) -> napi::Result<Vec<Vec<String>>> {
    let inputs = record_coverage_crossers::inputs(&rows).map_err(napi::Error::from_reason)?;
    Ok(inputs.into_iter().map(|(file, digest)| vec![file, digest]).collect())
}

pub(crate) fn encoded(rows: &CoverageRows) -> Result<Vec<u8>, String> {
    journey_columns::encode(columns(rows)?, LAYOUT.coverage.format)
}

fn columns(rows: &CoverageRows) -> Result<Vec<Column>, String> {
    let tests = rows.test_path.len();
    let modules = rows.module_path.len();
    let blocks = rows.block_ordinal.len();
    shaped(rows, tests, modules, blocks)?;

    // Tests by path, rows of one path kept in the order given, so a repeat is
    // found beside the row it repeats.
    let mut test_order: Vec<usize> = (0..tests).collect();
    test_order.sort_by(|left, right| order::code_unit(&rows.test_path[*left], &rows.test_path[*right]));
    if test_order.windows(2).any(|pair| rows.test_path[pair[0]] == rows.test_path[pair[1]]) {
        return Err("duplicate test coverage observation".to_owned());
    }
    let mut final_test = vec![0_u32; tests];
    for (at, test) in test_order.iter().enumerate() {
        final_test[*test] = at as u32;
    }
    let mut module_order: Vec<usize> = (0..modules).collect();
    module_order.sort_by(|left, right| order::code_unit(&rows.module_path[*left], &rows.module_path[*right]));

    let mut dictionary = Dictionary::default();
    let instrumentation = dictionary.id(&rows.instrumentation);
    let commit = rows.commit.as_deref().map(|commit| dictionary.id(commit));

    // Each test's preconditions, sorted and distinct.
    let mut inputs: Vec<Vec<(u32, u32)>> = Vec::with_capacity(tests);
    let mut input_count = 0;
    for test in 0..tests {
        let range = rows.test_preconditions[test] as usize..rows.test_preconditions[test + 1] as usize;
        let mut held: Vec<(&str, &str)> = range.map(|at| (rows.precondition_name[at].as_str(), rows.precondition_digest[at].as_str())).collect();
        held.sort_by(|left, right| order::code_unit(left.0, right.0).then_with(|| order::code_unit(left.1, right.1)));
        held.dedup();
        input_count += held.len();
        inputs.push(held.into_iter().map(|(name, digest)| (dictionary.id(name), dictionary.id(digest))).collect());
    }
    let paths: Vec<u32> = rows.test_path.iter().map(|path| dictionary.id(path)).collect();

    let crossers = Crossers::of(rows)?;

    struct Module {
        path: u32,
        source: u32,
        blob: u32,
        instrumented: bool,
        blocks: Vec<Region>,
    }
    let mut pool = SetPool::new(tests);
    let mut ids: Vec<u32> = Vec::new();
    let mut set = |module: usize, block: usize, loaded: bool| -> Result<u32, String> {
        ids.clear();
        for row in crossers.rows_of(module, block, loaded) {
            ids.push(final_test[row? as usize]);
        }
        ids.sort_unstable();
        ids.dedup();
        Ok(pool.intern(&ids))
    };
    // A region's strings are interned once each, as the first region naming one reaches it.
    let mut block_ids: Vec<Option<u32>> = vec![None; rows.block_strings.len()];
    let mut block_string = |at: u32, dictionary: &mut Dictionary| -> u32 {
        *block_ids[at as usize].get_or_insert_with(|| dictionary.id(&rows.block_strings[at as usize]))
    };
    let mut written: Vec<Module> = Vec::with_capacity(modules);
    for module in module_order {
        let range = rows.module_blocks[module] as usize..rows.module_blocks[module + 1] as usize;
        let mut order: Vec<usize> = range.collect();
        order.sort_by_key(|block| rows.block_ordinal[*block]);
        let mut regions = Vec::with_capacity(order.len());
        for block in order {
            let called = set(module, block, false)?;
            let loaded = set(module, block, true)?;
            regions.push(Region {
                ordinal: rows.block_ordinal[block],
                kind: rows.block_kind[block],
                source: rows.block_source[block],
                owner: rows.block_owner[block],
                digest: block_string(rows.block_digest[block], &mut dictionary),
                name: block_string(rows.block_name[block], &mut dictionary),
                path: block_string(rows.block_path[block], &mut dictionary),
                start: rows.block_start[block],
                end: rows.block_end[block],
                called,
                loaded,
            });
        }
        written.push(Module {
            path: dictionary.id(&rows.module_path[module]),
            source: dictionary.id(&rows.module_source[module]),
            blob: rows.module_blob[module].as_deref().map_or(LAYOUT.coverage.no_blob, |blob| dictionary.id(blob)),
            instrumented: rows.module_instrumented[module] == 1,
            blocks: regions,
        });
    }

    // Every string interned above is named by the output.
    let used = vec![true; dictionary.len()];
    let Spelled { blob, offsets, rank } = dictionary.spelled(&used);
    let ranked = |id: u32| rank[id as usize];
    let mut out = Columns::sized(tests, input_count, modules, blocks);
    for test in test_order {
        let mut phases: Phases = [0; PHASES];
        phases.copy_from_slice(&rows.test_phases[test * PHASES..(test + 1) * PHASES]);
        let mut start: Start = [0; START];
        start.copy_from_slice(&rows.test_start[test * START..(test + 1) * START]);
        let preconditions = inputs[test].iter().map(|(name, digest)| (ranked(*name), ranked(*digest)));
        out.test(ranked(paths[test]), rows.test_complete[test], rows.test_duration[test], phases, start, preconditions);
    }
    for module in written {
        let blob = if module.blob == LAYOUT.coverage.no_blob { module.blob } else { ranked(module.blob) };
        out.module(ranked(module.path), ranked(module.source), blob, module.instrumented);
        for region in module.blocks {
            out.region(Region { digest: ranked(region.digest), name: ranked(region.name), path: ranked(region.path), ..region });
        }
    }
    out.encoded(blob, offsets, ranked(instrumentation), commit.map(ranked), &pool)
}

/// Every column the length its counts say, and every offset column within what it indexes.
fn shaped(rows: &CoverageRows, tests: usize, modules: usize, blocks: usize) -> Result<(), String> {
    let lengths = [
        ("tests.complete", rows.test_complete.len(), tests),
        ("tests.duration", rows.test_duration.len(), tests),
        ("tests.phases", rows.test_phases.len(), tests * PHASES),
        ("tests.start", rows.test_start.len(), tests * START),
        ("tests.preconditions", rows.test_preconditions.len(), tests + 1),
        ("preconditions.digest", rows.precondition_digest.len(), rows.precondition_name.len()),
        ("modules.source", rows.module_source.len(), modules),
        ("modules.blob", rows.module_blob.len(), modules),
        ("modules.instrumented", rows.module_instrumented.len(), modules),
        ("modules.blocks", rows.module_blocks.len(), modules + 1),
        ("blocks.kind", rows.block_kind.len(), blocks),
        ("blocks.owner", rows.block_owner.len(), blocks),
        ("blocks.digest", rows.block_digest.len(), blocks),
        ("blocks.name", rows.block_name.len(), blocks),
        ("blocks.path", rows.block_path.len(), blocks),
        ("blocks.start", rows.block_start.len(), blocks),
        ("blocks.end", rows.block_end.len(), blocks),
        ("blocks.source", rows.block_source.len(), blocks),
        ("blocks.called", rows.called_offsets.len(), blocks + 1),
        ("blocks.loaded", rows.loaded_offsets.len(), blocks + 1),
    ];
    if let Some((name, held, want)) = lengths.iter().find(|(_, held, want)| held != want) {
        return Err(format!("coverage rows hold {held} entries of {name} where {want} were due"));
    }
    let bounded = |name: &str, offsets: &[u32], within: usize| -> Result<(), String> {
        let sound = offsets.first() == Some(&0) && offsets.windows(2).all(|pair| pair[0] <= pair[1]) && offsets.last().is_some_and(|end| *end as usize == within);
        if sound { Ok(()) } else { Err(format!("coverage rows' {name} offsets do not cover what they index")) }
    };
    let table = rows.block_strings.len();
    for (name, column) in [("blocks.digest", &rows.block_digest), ("blocks.name", &rows.block_name), ("blocks.path", &rows.block_path)] {
        if let Some(at) = column.iter().find(|at| **at as usize >= table) {
            return Err(format!("coverage rows' {name} names string {at}, past the {table} held"));
        }
    }
    bounded("tests.preconditions", &rows.test_preconditions, rows.precondition_name.len())?;
    bounded("modules.blocks", &rows.module_blocks, blocks)?;
    bounded("blocks.called", &rows.called_offsets, rows.called.len())?;
    bounded("blocks.loaded", &rows.loaded_offsets, rows.loaded.len())
}
