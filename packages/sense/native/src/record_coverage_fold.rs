//! The one fold of coverage: N shards' coverage as the coverage one unsharded
//! run would have written, or a refusal naming the two shards that disagree.
//!
//! The rule is that the fold says nothing one run could not. The probe recipe
//! is singular in a run, so every shard must name the same one. A test file
//! belongs to one shard. A module the shards built from different text is
//! refused, since the regions of one do not name the regions of the other.
//! Where shards disagree about whether a module was readable, the rows that
//! measured it answer and the others say nothing; rows that agree are one
//! union, region by region, by ordinal. A region two shards describe
//! differently is refused.
//!
//! Shards are added one at a time and each is dropped once added, so the fold
//! holds the output and one shard, never every shard: a region's tests are an
//! interned set, and a shard's union with what is held is computed once per
//! distinct pair of sets, not once per region.
//!
//! The output is a function of the shards' contents only: tests and modules
//! are written in code-unit order of their paths, ids are ranks in that order,
//! every set is ascending, and the dictionary holds exactly the strings the
//! output names, sorted.

use rustc_hash::FxHashMap;

use crate::case_shard;
use crate::journey_columns::Column;
use crate::journey_format::SetPool;
use crate::order;
use crate::record_combine::Agreed;
use crate::record_coverage::Coverage;
use crate::record_layout::LAYOUT;

pub(crate) struct Folded {
    /// The coverage sections, in the order a record holds them.
    pub columns: Vec<Column>,
    pub tests: u32,
    pub modules: u32,
    pub crossings: u64,
    /// Per shard added, the test files it recorded, in code-unit order.
    pub files: Vec<Vec<String>>,
}

/// Strings the output may name, owned, numbered as they are first named and
/// ranked once the output is known.
#[derive(Default)]
struct Dictionary {
    ids: FxHashMap<Box<str>, u32>,
}

impl Dictionary {
    fn id(&mut self, value: &str) -> u32 {
        if let Some(id) = self.ids.get(value) {
            return *id;
        }
        let id = self.ids.len() as u32;
        self.ids.insert(value.into(), id);
        id
    }

    /// The strings `used` names, sorted, and the rank each such id takes among them.
    fn ranked(self, used: &[bool]) -> (Vec<Box<str>>, Vec<u32>) {
        let mut kept: Vec<(Box<str>, u32)> = self.ids.into_iter().filter(|(_, id)| used[*id as usize]).collect();
        kept.sort_unstable_by(|left, right| order::code_unit(&left.0, &right.0));
        let mut rank = vec![u32::MAX; used.len()];
        for (at, (_, id)) in kept.iter().enumerate() {
            rank[*id as usize] = at as u32;
        }
        (kept.into_iter().map(|(value, _)| value).collect(), rank)
    }
}

/// One shard's dictionary as the fold's ids, each string looked up once.
struct Local<'a> {
    strings: Vec<&'a str>,
    ids: Vec<u32>,
}

impl Local<'_> {
    fn id(&mut self, dictionary: &mut Dictionary, id: u32) -> u32 {
        let held = &mut self.ids[id as usize];
        if *held == u32::MAX {
            *held = dictionary.id(self.strings[id as usize]);
        }
        *held
    }
}

struct Test {
    path: u32,
    complete: u8,
    duration: u32,
    preconditions: (u32, u32),
}

struct Module {
    path: u32,
    source: u32,
    instrumented: bool,
    /// The shard that first named the module, which a refusal names.
    origin: u32,
    /// In ordinal order.
    blocks: Vec<Block>,
}

struct Block {
    ordinal: u32,
    kind: u8,
    source: u8,
    owner: u32,
    digest: u32,
    name: u32,
    path: u32,
    start: u32,
    end: u32,
    called: u32,
    loaded: u32,
    origin: u32,
}

pub(crate) struct Fold {
    names: Vec<String>,
    instrumentation: Agreed,
    dictionary: Dictionary,
    tests: Vec<Test>,
    /// Which shard recorded each test path.
    owner: FxHashMap<u32, u32>,
    precondition_name: Vec<u32>,
    precondition_digest: Vec<u32>,
    modules: Vec<Module>,
    module_at: FxHashMap<u32, u32>,
    /// Sets over every shard's tests, a test numbered by its shard's offset
    /// and its own id: what a region's tests are until they are ranked.
    sets: SetPool,
    empty: u32,
    universe: usize,
    files: Vec<Vec<String>>,
}

impl Fold {
    /// A fold of shards that together record `universe` test files.
    pub fn new(universe: usize) -> Self {
        let mut sets = SetPool::new(universe);
        let empty = sets.intern(&[]);
        Fold {
            names: Vec::new(),
            instrumentation: Agreed::new("instrumentation"),
            dictionary: Dictionary::default(),
            tests: Vec::new(),
            owner: FxHashMap::default(),
            precondition_name: Vec::new(),
            precondition_digest: Vec::new(),
            modules: Vec::new(),
            module_at: FxHashMap::default(),
            sets,
            empty,
            universe,
            files: Vec::new(),
        }
    }

    /// Fold in one shard's coverage, called `name` by a refusal.
    pub fn add(&mut self, name: &str, coverage: &Coverage) -> Result<(), String> {
        let Fold { names, instrumentation, dictionary, tests, owner, modules, module_at, sets, .. } = self;
        let at = names.len() as u32;
        names.push(name.to_owned());
        let strings = coverage.strings()?;
        instrumentation.hear(name, Some(strings[coverage.instrumentation as usize]))?;
        let mut local = Local { ids: vec![u32::MAX; strings.len()], strings };

        let offset = tests.len() as u32;
        if tests.len() + coverage.tests() > self.universe {
            return Err(format!("{name} holds more test files than its header states"));
        }
        let mut files = Vec::with_capacity(coverage.tests());
        for test in 0..coverage.tests() {
            let path = local.id(dictionary, coverage.test_path[test]);
            if let Some(held) = owner.insert(path, at) {
                return Err(format!(
                    "`{}` was recorded by {} and again by {name}. A test file belongs to one shard, and two observations of it cannot both be the suite's.",
                    local.strings[coverage.test_path[test] as usize],
                    names[held as usize]
                ));
            }
            files.push(local.strings[coverage.test_path[test] as usize].to_owned());
            let from = self.precondition_name.len() as u32;
            for input in coverage.preconditions(test) {
                self.precondition_name.push(local.id(dictionary, coverage.precondition_name[input]));
                self.precondition_digest.push(local.id(dictionary, coverage.precondition_digest[input]));
            }
            tests.push(Test {
                path,
                complete: coverage.test_complete[test],
                duration: coverage.test_duration.as_ref().map_or(LAYOUT.coverage.no_duration, |duration| duration[test]),
                preconditions: (from, self.precondition_name.len() as u32),
            });
        }
        files.sort_unstable_by(|left, right| order::code_unit(left, right));
        self.files.push(files);

        // A pair of sets, the one held and the shard's, is unioned once.
        let mut unions: FxHashMap<(u32, u32), u32> = FxHashMap::default();
        let mut union = |held: u32, set: u32| -> Result<u32, String> {
            if let Some(id) = unions.get(&(held, set)) {
                return Ok(*id);
            }
            let mut members = case_shard::decode_set(case_shard::set_slice(sets.bytes(), sets.offsets(), held)?, self.universe)?;
            let stored = case_shard::set_slice(&coverage.set_bytes, &coverage.set_offsets, set)?;
            members.extend(case_shard::decode_set(stored, coverage.tests())?.into_iter().map(|test| test + offset));
            members.sort_unstable();
            members.dedup();
            let id = sets.intern(&members);
            unions.insert((held, set), id);
            Ok(id)
        };
        for row in 0..coverage.modules() {
            let path = local.id(dictionary, coverage.module_path[row]);
            let source = local.id(dictionary, coverage.module_source[row]);
            let instrumented = coverage.module_instrumented[row] == 1;
            let module = *module_at.entry(path).or_insert_with(|| {
                modules.push(Module { path, source, instrumented, origin: at, blocks: Vec::new() });
                modules.len() as u32 - 1
            });
            let held = &mut modules[module as usize];
            let file = local.strings[coverage.module_path[row] as usize];
            if held.source != source {
                return Err(format!(
                    "`{file}` is different source in {} and {name}: the two shards built it from different text, so the regions of one do not name the regions of the other.",
                    names[held.origin as usize]
                ));
            }
            if instrumented && !held.instrumented {
                held.instrumented = true;
                held.blocks.clear();
            } else if held.instrumented && !instrumented {
                continue;
            }
            for block in coverage.blocks(row) {
                let read = Block {
                    ordinal: coverage.block_ordinal[block],
                    kind: coverage.block_kind[block],
                    source: coverage.block_source[block],
                    owner: coverage.block_owner[block],
                    digest: local.id(dictionary, coverage.block_digest[block]),
                    name: local.id(dictionary, coverage.block_name[block]),
                    path: local.id(dictionary, coverage.block_path[block]),
                    start: coverage.block_start[block],
                    end: coverage.block_end[block],
                    called: coverage.block_set[block],
                    loaded: coverage.block_loaded_set[block],
                    origin: at,
                };
                match held.blocks.binary_search_by_key(&read.ordinal, |block| block.ordinal) {
                    Ok(found) => {
                        let kept = &mut held.blocks[found];
                        if !same_region(kept, &read) {
                            return Err(format!(
                                "`{file}` region {} is described differently by {} and {name}, so they are not shards of one build.",
                                read.ordinal, names[kept.origin as usize]
                            ));
                        }
                        kept.called = union(kept.called, read.called)?;
                        kept.loaded = union(kept.loaded, read.loaded)?;
                    }
                    Err(slot) => {
                        let called = union(self.empty, read.called)?;
                        let loaded = union(self.empty, read.loaded)?;
                        held.blocks.insert(slot, Block { called, loaded, ..read });
                    }
                }
            }
        }
        Ok(())
    }

    /// The coverage of every shard added, naming `commit`: the one the shards agree on.
    pub fn finish(self, commit: Option<&str>) -> Result<Folded, String> {
        let Fold { names, instrumentation, mut dictionary, tests, precondition_name, precondition_digest, mut modules, sets, universe, files, .. } = self;
        if names.is_empty() {
            return Err("folding needs at least one coverage record".to_owned());
        }
        let instrumentation = dictionary.id(instrumentation.value().unwrap_or_default());
        let commit = commit.map(|value| dictionary.id(value));
        let mut used = vec![false; dictionary.ids.len()];
        let mut use_ = |id: u32| used[id as usize] = true;
        use_(instrumentation);
        commit.into_iter().for_each(&mut use_);
        for test in &tests {
            use_(test.path);
        }
        precondition_name.iter().chain(&precondition_digest).copied().for_each(&mut use_);
        for module in &modules {
            use_(module.path);
            use_(module.source);
            for block in &module.blocks {
                use_(block.digest);
                use_(block.name);
                use_(block.path);
            }
        }
        let (strings, rank) = dictionary.ranked(&used);
        let ranked = |id: u32| rank[id as usize];

        // Tests, by path. Ids are ranks, so they do not depend on which shard held a test.
        let mut order: Vec<u32> = (0..tests.len() as u32).collect();
        order.sort_unstable_by_key(|test| ranked(tests[*test as usize].path));
        let mut final_id = vec![0_u32; tests.len()];
        let mut out = Columns::default();
        for (at, test) in order.iter().enumerate() {
            final_id[*test as usize] = at as u32;
            let test = &tests[*test as usize];
            out.test_path.push(ranked(test.path));
            out.test_complete.push(test.complete);
            out.test_duration.push(test.duration);
            out.test_preconditions.push(out.precondition_name.len() as u32);
            for input in test.preconditions.0 as usize..test.preconditions.1 as usize {
                out.precondition_name.push(ranked(precondition_name[input]));
                out.precondition_digest.push(ranked(precondition_digest[input]));
            }
        }
        out.test_preconditions.push(out.precondition_name.len() as u32);

        // Modules, by path; each region's tests as the final ids, interned in output order.
        modules.sort_unstable_by_key(|module| ranked(module.path));
        let mut pool = SetPool::new(tests.len());
        let mut placed: Vec<Option<(u32, u32)>> = vec![None; sets.offsets().len() - 1];
        let mut set = |held: u32| -> Result<(u32, u32), String> {
            if let Some(placed) = placed[held as usize] {
                return Ok(placed);
            }
            let members = case_shard::decode_set(case_shard::set_slice(sets.bytes(), sets.offsets(), held)?, universe)?;
            let mut members: Vec<u32> = members.into_iter().map(|test| final_id[test as usize]).collect();
            members.sort_unstable();
            let interned = (pool.intern(&members), members.len() as u32);
            placed[held as usize] = Some(interned);
            Ok(interned)
        };
        let mut crossings = 0_u64;
        for module in &modules {
            out.module_path.push(ranked(module.path));
            out.module_source.push(ranked(module.source));
            out.module_instrumented.push(u8::from(module.instrumented));
            out.module_blocks.push(out.block_ordinal.len() as u32);
            for block in &module.blocks {
                out.block_ordinal.push(block.ordinal);
                out.block_kind.push(block.kind);
                out.block_owner.push(block.owner);
                out.block_digest.push(ranked(block.digest));
                out.block_name.push(ranked(block.name));
                out.block_path.push(ranked(block.path));
                out.block_start.push(block.start);
                out.block_end.push(block.end);
                out.block_source.push(block.source);
                let (called, entered) = set(block.called)?;
                crossings += u64::from(entered);
                out.block_set.push(called);
                out.block_loaded_set.push(set(block.loaded)?.0);
            }
        }
        out.module_blocks.push(out.block_ordinal.len() as u32);
        let modules = out.module_path.len() as u32;
        let columns = encoded(out, &strings, ranked(instrumentation), commit.map(ranked), &pool)?;
        Ok(Folded { columns, tests: tests.len() as u32, modules, crossings, files })
    }
}

/// Whether two block rows describe one region: everything but who entered it.
fn same_region(left: &Block, right: &Block) -> bool {
    (left.kind, left.owner, left.start, left.end, left.source, left.digest, left.name, left.path)
        == (right.kind, right.owner, right.start, right.end, right.source, right.digest, right.name, right.path)
}

#[derive(Default)]
struct Columns {
    test_path: Vec<u32>,
    test_complete: Vec<u8>,
    test_preconditions: Vec<u32>,
    test_duration: Vec<u32>,
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

fn encoded(out: Columns, strings: &[Box<str>], instrumentation: u32, commit: Option<u32>, sets: &SetPool) -> Result<Vec<Column>, String> {
    let mut blob = Vec::new();
    let mut offsets = Vec::with_capacity(strings.len() + 1);
    offsets.push(0);
    for value in strings {
        blob.extend_from_slice(value.as_bytes());
        offsets.push(blob.len() as u32);
    }
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
        Column::Words(name("tests.path")?, out.test_path),
        Column::Bytes(name("tests.complete")?, out.test_complete),
        Column::Words(name("tests.preconditions")?, out.test_preconditions),
        Column::Words(name(&LAYOUT.coverage.duration)?, out.test_duration),
        Column::Words(name("preconditions.name")?, out.precondition_name),
        Column::Words(name("preconditions.digest")?, out.precondition_digest),
        Column::Words(name("modules.path")?, out.module_path),
        Column::Words(name("modules.source")?, out.module_source),
        Column::Bytes(name("modules.instrumented")?, out.module_instrumented),
        Column::Words(name("modules.blocks")?, out.module_blocks),
        Column::Words(name("blocks.ordinal")?, out.block_ordinal),
        Column::Bytes(name("blocks.kind")?, out.block_kind),
        Column::Words(name("blocks.owner")?, out.block_owner),
        Column::Words(name("blocks.digest")?, out.block_digest),
        Column::Words(name("blocks.name")?, out.block_name),
        Column::Words(name("blocks.path")?, out.block_path),
        Column::Words(name("blocks.start")?, out.block_start),
        Column::Words(name("blocks.end")?, out.block_end),
        Column::Bytes(name("blocks.source")?, out.block_source),
        Column::Words(name("blocks.set")?, out.block_set),
        Column::Words(name("blocks.loadedSet")?, out.block_loaded_set),
        Column::Blob(name("sets.blob")?, sets.bytes().to_vec(), sets.offsets().to_vec()),
        Column::Words(name("sets.off")?, sets.offsets().to_vec()),
    ];
    let mut columns: FxHashMap<&str, Column> = columns
        .into_iter()
        .map(|column| match &column {
            Column::Bytes(name, _) | Column::Words(name, _) | Column::Blob(name, _, _) | Column::Plain(name, _) => (*name, column),
        })
        .collect();
    // Every section the layout names, in its order; one the fold does not write fails here.
    LAYOUT.coverage.sections.iter().map(|section| columns.remove(section.as_str()).ok_or_else(|| format!("the fold writes no coverage section {section}"))).collect()
}

#[cfg(test)]
#[path = "record_coverage_fold_tests.rs"]
mod tests;
