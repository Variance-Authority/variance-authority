//! The one fold of coverage: N shards' coverage as the coverage one unsharded
//! run would have written, or a refusal naming the two shards that disagree.
//!
//! The rule is that the fold says nothing one run could not. The probe recipe
//! is singular in a run, so every shard must name the same one. A test file
//! belongs to one shard. A module the shards built from different text is
//! refused, since the regions of one do not name the regions of the other.
//! Where shards disagree about whether a module was readable, the rows that
//! measured it answer and the others say nothing; rows that agree are one
//! union, region by region, by ordinal.
//!
//! A region two shards describe differently, over one text, is a module the
//! shards' writers cut two ways: one shard cut it, another carried a row an
//! older writer cut. The fold names such modules and writes nothing; handed
//! the checkout's own cut of them, it carries every shard's crossings onto
//! that cut by address, as a carried row is cut again (`recut`), and owes a
//! run to every test whose crossings have no place in it. A region a shard's
//! row was cut without takes the region around it; one whose address the row
//! disputes, and every region inside it, takes nothing from that row, and the
//! crossers of the row's region around it, any of whom may have run it, are
//! owed the run that measures them.
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

use std::collections::BTreeMap;

use rustc_hash::FxHashMap;

use crate::journey_columns::Column;
use crate::crossing_sets::{self, SetPool};
use crate::order;
use crate::record_start::Agreed;
use crate::record_coverage::{Coverage, Phases, Text};
use crate::record_layout::LAYOUT;
use crate::record_coverage_columns::{Columns, Region};
use crate::record_coverage_dictionary::{Dictionary, Spelled};
use crate::record_coverage_recut::{carried, Disputed, Recut};

pub(crate) struct Folded {
    /// The coverage sections, in the order a record holds them.
    pub columns: Vec<Column>,
    pub tests: u32,
    pub modules: u32,
    pub crossings: u64,
    /// Per shard added, the test files it recorded, in code-unit order.
    pub files: Vec<Vec<String>>,
}

/// One record's dictionary as the fold's ids, each string looked up once.
struct Local<'a> {
    strings: Text<'a>,
    ids: Vec<u32>,
}

impl<'a> Local<'a> {
    fn new(strings: Text<'a>) -> Self {
        Local { ids: vec![u32::MAX; strings.len()], strings }
    }

    fn id(&mut self, dictionary: &mut Dictionary, id: u32) -> u32 {
        let held = &mut self.ids[id as usize];
        if *held == u32::MAX {
            *held = dictionary.id(self.strings.at(id));
        }
        *held
    }
}

struct Test {
    path: u32,
    complete: u8,
    duration: u32,
    phases: Phases,
    preconditions: (u32, u32),
}

struct Module {
    path: u32,
    source: u32,
    /// The git blob name of its text, or `no_blob` where no shard recorded one.
    blob: u32,
    instrumented: bool,
    /// The shard that first named the module, which a refusal names.
    origin: u32,
    /// In ordinal order.
    blocks: Vec<Block>,
}

/// A region row: strings as the fold's ids, crossings as sets of its pool.
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
    /// The shard that described the region, which a refusal names.
    origin: u32,
}

/// The checkout's cut of the modules the shards dispute, by path.
struct Cut<'c> {
    coverage: &'c Coverage,
    text: Text<'c>,
    rows: FxHashMap<&'c str, usize>,
}

pub(crate) struct Fold<'c> {
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
    cut: Option<Cut<'c>>,
    /// By path, the first two shards found describing a region of it apart.
    disputed: BTreeMap<String, (u32, String, String)>,
}

impl<'c> Fold<'c> {
    /// A fold of shards that together record `universe` test files, carrying
    /// the modules they dispute onto `cut`, the checkout's cut of them.
    pub fn new(universe: usize, cut: Option<&'c Coverage>) -> Result<Self, String> {
        let cut = cut
            .map(|coverage| -> Result<Cut<'c>, String> {
                let text = coverage.text()?;
                let rows = (0..coverage.modules()).map(|row| (text.at(coverage.module_path[row]), row)).collect();
                Ok(Cut { coverage, text, rows })
            })
            .transpose()?;
        let mut sets = SetPool::new(universe);
        let empty = sets.intern(&[]);
        Ok(Fold {
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
            cut,
            disputed: BTreeMap::new(),
        })
    }

    /// The instrumentation every shard named, once one was added.
    pub fn instrumentation(&self) -> Option<&str> {
        self.instrumentation.value()
    }

    /// Each module the shards describe apart, with what refuses it once the
    /// checkout's cut, if any, could not carry it.
    pub fn disputed(&self) -> Vec<(String, String)> {
        self.disputed
            .iter()
            .map(|(file, (region, first, then))| {
                let why = match self.cut.as_ref().map(|cut| cut.rows.get(file.as_str()).map(|row| (cut, *row))) {
                    None => "and nothing cut it again".to_owned(),
                    Some(None) => format!("and the checkout holds no text of `{file}` to cut it again in"),
                    Some(Some((cut, row))) if cut.coverage.module_instrumented[row] != 1 => format!("and the checkout's `{file}` does not cut under their instrumentation"),
                    Some(Some(_)) => format!("and the checkout holds `{file}` at another text than they were built from"),
                };
                (file.clone(), format!("`{file}` region {region} is described differently by {first} and {then}, {why}, so they are not shards of one build."))
            })
            .collect()
    }

    /// Fold in one shard's coverage, called `name` by a refusal.
    pub fn add(&mut self, name: &str, coverage: &Coverage) -> Result<(), String> {
        let Fold { names, instrumentation, dictionary, tests, owner, modules, module_at, sets, cut, disputed, empty, .. } = self;
        let empty = *empty;
        let at = names.len() as u32;
        names.push(name.to_owned());
        let strings = coverage.text()?;
        instrumentation.hear(name, Some(strings.at(coverage.instrumentation)))?;
        if let Some(cut) = cut.as_ref().filter(|cut| cut.text.at(cut.coverage.instrumentation) != strings.at(coverage.instrumentation)) {
            return Err(format!("the checkout was cut under {}, and {name} under {}", cut.text.at(cut.coverage.instrumentation), strings.at(coverage.instrumentation)));
        }
        let mut local = Local::new(strings);

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
                    local.strings.at(coverage.test_path[test]),
                    names[held as usize]
                ));
            }
            files.push(local.strings.at(coverage.test_path[test]).to_owned());
            let from = self.precondition_name.len() as u32;
            for input in coverage.preconditions(test) {
                self.precondition_name.push(local.id(dictionary, coverage.precondition_name[input]));
                self.precondition_digest.push(local.id(dictionary, coverage.precondition_digest[input]));
            }
            tests.push(Test {
                path,
                complete: coverage.test_complete[test],
                duration: coverage.duration(test),
                phases: coverage.phases(test),
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
            let mut members = crossing_sets::decode_set(crossing_sets::set_slice(sets.bytes(), sets.offsets(), held)?, self.universe)?;
            let stored = crossing_sets::set_slice(&coverage.set_bytes, &coverage.set_offsets, set)?;
            members.extend(crossing_sets::decode_set(stored, coverage.tests())?.into_iter().map(|test| test + offset));
            members.sort_unstable();
            members.dedup();
            let id = sets.intern(&members);
            unions.insert((held, set), id);
            Ok(id)
        };
        for row in 0..coverage.modules() {
            let path = local.id(dictionary, coverage.module_path[row]);
            let source = local.id(dictionary, coverage.module_source[row]);
            let blob = coverage.blob_in(row, |id| local.id(dictionary, id));
            let instrumented = coverage.module_instrumented[row] == 1;
            let file = local.strings.at(coverage.module_path[row]);
            // The checkout's row, where it cut this text under these probes.
            let fresh = cut.as_ref().and_then(|cut| {
                let fresh = *cut.rows.get(file)?;
                let same = cut.coverage.module_instrumented[fresh] == 1 && cut.text.at(cut.coverage.module_source[fresh]) == local.strings.at(coverage.module_source[row]);
                same.then_some((cut, fresh))
            });
            let module = *module_at.entry(path).or_insert_with(|| {
                let blocks = fresh.map_or_else(Vec::new, |(cut, fresh)| {
                    let (coverage, text) = (cut.coverage, cut.text);
                    coverage
                        .blocks(fresh)
                        .map(|block| Block {
                            ordinal: coverage.block_ordinal[block],
                            kind: coverage.block_kind[block],
                            source: coverage.block_source[block],
                            owner: coverage.block_owner[block],
                            digest: dictionary.id(text.at(coverage.block_digest[block])),
                            name: dictionary.id(text.at(coverage.block_name[block])),
                            path: dictionary.id(text.at(coverage.block_path[block])),
                            start: coverage.block_start[block],
                            end: coverage.block_end[block],
                            called: empty,
                            loaded: empty,
                            origin: at,
                        })
                        .collect()
                });
                modules.push(Module { path, source, blob, instrumented: instrumented || fresh.is_some(), origin: at, blocks });
                modules.len() as u32 - 1
            });
            let held = &mut modules[module as usize];
            if held.source != source {
                return Err(format!(
                    "`{file}` is different source in {} and {name}: the two shards built it from different text, so the regions of one do not name the regions of the other.",
                    names[held.origin as usize]
                ));
            }
            if held.blob == LAYOUT.coverage.no_blob {
                held.blob = blob;
            }
            if instrumented && !held.instrumented {
                held.instrumented = true;
                held.blocks.clear();
            } else if held.instrumented && !instrumented || disputed.contains_key(file) {
                continue;
            }
            if let Some((cut, fresh)) = fresh {
                // A row lends each region's crossings by address, and a region
                // the row was cut without takes the region around it. A region
                // whose address the row disputes takes nothing, nor does one
                // inside it: the row's regions that have no place, and the one
                // around a withheld region, owe their crossers the run that
                // measures them.
                let first = coverage.blocks(row).start;
                let mut taken = vec![false; coverage.blocks(row).len()];
                let mut owed = Vec::new();
                if let Recut::Cut { from, owed: around } = carried((coverage, local.strings), row, (cut.coverage, cut.text), fresh, Disputed::Withhold, |_| false) {
                    for from in from.iter().flatten() {
                        taken[from - first] = true;
                    }
                    owed = around;
                    for (kept, from) in held.blocks.iter_mut().zip(from) {
                        let Some(from) = from else { continue };
                        kept.called = union(kept.called, coverage.block_set[from])?;
                        kept.loaded = union(kept.loaded, coverage.block_loaded_set[from])?;
                    }
                }
                let untaken = coverage.blocks(row).zip(taken).filter(|(_, taken)| !taken).map(|(block, _)| block);
                for block in untaken.chain(owed) {
                    for set in [coverage.block_set[block], coverage.block_loaded_set[block]] {
                        for test in crossing_sets::decode_set(crossing_sets::set_slice(&coverage.set_bytes, &coverage.set_offsets, set)?, coverage.tests())? {
                            tests[(offset + test) as usize].complete = 0;
                        }
                    }
                }
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
                            disputed.insert(file.to_owned(), (read.ordinal, names[kept.origin as usize].clone(), name.to_owned()));
                            break;
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
    pub fn finish(mut self, commit: Option<&str>) -> Result<Folded, String> {
        if self.names.is_empty() {
            return Err("folding needs at least one coverage record".to_owned());
        }
        let mut dictionary = std::mem::take(&mut self.dictionary);
        let instrumentation = dictionary.id(self.instrumentation.value().unwrap_or_default());
        let commit = commit.map(|value| dictionary.id(value));
        let Fold { tests, precondition_name, precondition_digest, mut modules, sets, universe, files, .. } = self;
        let mut used = vec![false; dictionary.len()];
        let mut use_ = |id: u32| used[id as usize] = true;
        use_(instrumentation);
        commit.into_iter().for_each(&mut use_);
        for test in &tests {
            use_(test.path);
        }
        precondition_name.iter().chain(&precondition_digest).copied().for_each(&mut use_);
        let mut blocks = 0;
        for module in &modules {
            use_(module.path);
            use_(module.source);
            if module.blob != LAYOUT.coverage.no_blob {
                use_(module.blob);
            }
            blocks += module.blocks.len();
            for block in &module.blocks {
                use_(block.digest);
                use_(block.name);
                use_(block.path);
            }
        }
        let Spelled { blob, offsets, rank } = dictionary.spelled(&used);
        drop(used);
        let ranked = |id: u32| rank[id as usize];

        // Tests, by path. Ids are ranks, so they do not depend on which shard held a test.
        let mut order: Vec<u32> = (0..tests.len() as u32).collect();
        order.sort_unstable_by_key(|test| ranked(tests[*test as usize].path));
        let mut final_id = vec![0_u32; tests.len()];
        let mut out = Columns::sized(tests.len(), precondition_name.len(), modules.len(), blocks);
        for (at, test) in order.iter().enumerate() {
            final_id[*test as usize] = at as u32;
            let test = &tests[*test as usize];
            let inputs = test.preconditions.0 as usize..test.preconditions.1 as usize;
            out.test(ranked(test.path), test.complete, test.duration, test.phases, inputs.map(|input| (ranked(precondition_name[input]), ranked(precondition_digest[input]))));
        }

        // Modules, by path, rows of one path in the order they were added; each
        // region's tests as the final ids, interned in output order.
        modules.sort_by_key(|module| ranked(module.path));
        let mut pool = SetPool::new(tests.len());
        let mut placed: Vec<Option<(u32, u32)>> = vec![None; sets.offsets().len() - 1];
        let mut set = |held: u32| -> Result<(u32, u32), String> {
            if let Some(placed) = placed[held as usize] {
                return Ok(placed);
            }
            let members = crossing_sets::decode_set(crossing_sets::set_slice(sets.bytes(), sets.offsets(), held)?, universe)?;
            let mut members: Vec<u32> = members.into_iter().map(|test| final_id[test as usize]).collect();
            members.sort_unstable();
            let interned = (pool.intern(&members), members.len() as u32);
            placed[held as usize] = Some(interned);
            Ok(interned)
        };
        let mut crossings = 0_u64;
        for module in modules {
            let blob = if module.blob == LAYOUT.coverage.no_blob { module.blob } else { ranked(module.blob) };
            out.module(ranked(module.path), ranked(module.source), blob, module.instrumented);
            for block in &module.blocks {
                let (called, entered) = set(block.called)?;
                crossings += u64::from(entered);
                out.region(Region {
                    ordinal: block.ordinal,
                    kind: block.kind,
                    source: block.source,
                    owner: block.owner,
                    digest: ranked(block.digest),
                    name: ranked(block.name),
                    path: ranked(block.path),
                    start: block.start,
                    end: block.end,
                    called,
                    loaded: set(block.loaded)?.0,
                });
            }
        }
        let modules = out.modules() as u32;
        let columns = out.encoded(blob, offsets, ranked(instrumentation), commit.map(ranked), &pool)?;
        Ok(Folded { columns, tests: tests.len() as u32, modules, crossings, files })
    }
}

/// Whether two block rows describe one region: everything but who entered it.
fn same_region(left: &Block, right: &Block) -> bool {
    (left.kind, left.owner, left.start, left.end, left.source, left.digest, left.name, left.path)
        == (right.kind, right.owner, right.start, right.end, right.source, right.digest, right.name, right.path)
}

#[cfg(test)]
#[path = "record_coverage_fold_tests.rs"]
mod tests;
