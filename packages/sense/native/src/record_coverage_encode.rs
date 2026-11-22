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
//! the caller keeps once; a name no test row holds is refused, as is a test
//! row whose path another already holds.

use napi::bindgen_prelude::{Buffer, Uint32Array, Uint8Array};
use napi_derive::napi;
use rustc_hash::FxHashMap;

use crate::crossing_sets::SetPool;
use crate::journey_columns::{self, Column};
use crate::order;
use crate::record_coverage::{Phases, PHASES};
use crate::record_coverage_columns::{Columns, Region};
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
    pub block_digest: Vec<String>,
    pub block_name: Vec<String>,
    pub block_path: Vec<String>,
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
}

/// The coverage record `rows` describe, or a refusal naming what is wrong with them.
#[napi(catch_unwind)]
pub fn encode_coverage(rows: CoverageRows) -> napi::Result<Buffer> {
    encoded(&rows).map(Buffer::from).map_err(napi::Error::from_reason)
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

    // A crosser's name as its final test id, looked up once per name.
    let by_path: FxHashMap<&str, u32> = (0..tests).map(|test| (rows.test_path[test].as_str(), final_test[test])).collect();
    let member_ids = rows
        .members
        .iter()
        .map(|member| by_path.get(member.as_str()).copied().ok_or_else(|| format!("coverage crossing names an unobserved test: {member}")))
        .collect::<Vec<_>>();

    struct Module {
        path: u32,
        source: u32,
        blob: u32,
        instrumented: bool,
        blocks: Vec<Region>,
    }
    let mut pool = SetPool::new(tests);
    let mut crossers: Vec<u32> = Vec::new();
    let mut set = |offsets: &Uint32Array, members: &Uint32Array, block: usize| -> Result<u32, String> {
        crossers.clear();
        for member in &members[offsets[block] as usize..offsets[block + 1] as usize] {
            let id = member_ids.get(*member as usize).ok_or_else(|| format!("coverage crossing names member {member}, past the {} held", member_ids.len()))?;
            crossers.push(id.clone()?);
        }
        crossers.sort_unstable();
        crossers.dedup();
        Ok(pool.intern(&crossers))
    };
    let mut written: Vec<Module> = Vec::with_capacity(modules);
    for module in module_order {
        let range = rows.module_blocks[module] as usize..rows.module_blocks[module + 1] as usize;
        let mut order: Vec<usize> = range.collect();
        order.sort_by_key(|block| rows.block_ordinal[*block]);
        let mut regions = Vec::with_capacity(order.len());
        for block in order {
            let called = set(&rows.called_offsets, &rows.called, block)?;
            let loaded = set(&rows.loaded_offsets, &rows.loaded, block)?;
            regions.push(Region {
                ordinal: rows.block_ordinal[block],
                kind: rows.block_kind[block],
                source: rows.block_source[block],
                owner: rows.block_owner[block],
                digest: dictionary.id(&rows.block_digest[block]),
                name: dictionary.id(&rows.block_name[block]),
                path: dictionary.id(&rows.block_path[block]),
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
        let preconditions = inputs[test].iter().map(|(name, digest)| (ranked(*name), ranked(*digest)));
        out.test(ranked(paths[test]), rows.test_complete[test], rows.test_duration[test], phases, preconditions);
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
    bounded("tests.preconditions", &rows.test_preconditions, rows.precondition_name.len())?;
    bounded("modules.blocks", &rows.module_blocks, blocks)?;
    bounded("blocks.called", &rows.called_offsets, rows.called.len())?;
    bounded("blocks.loaded", &rows.loaded_offsets, rows.loaded.len())
}
