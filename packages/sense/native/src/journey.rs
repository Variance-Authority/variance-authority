use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::journey_columns;
use crate::journey_format::{self, EncodedModule, Gaps, SetPool};
use crate::journey_journal::{self, CaseRun, ModuleId, Visitor};
use crate::journey_output;
use crate::journey_record::{self, Module};
use crate::journey_stitch;
use crate::order;

const DEFAULT_BUDGET: usize = 512 * 1_048_576;

#[napi(object)]
pub struct JourneyFold {
    pub bytes: Buffer,
    pub tests: u32,
    pub modules: u32,
    pub crossings: f64,
    pub passes: u32,
    /// Files two builds numbered differently, read at the regions both hold.
    pub renumbered: Vec<String>,
    /// Modules a case ran that no record holds: a change there selects nothing.
    pub unrecorded: Vec<String>,
    /// Part files that ran code under no journey a case handed out.
    pub unclaimed: Vec<String>,
    /// Heads that wrote parts in the run before and none in this one; absent
    /// when there was no run before to compare with.
    pub silent: Option<Vec<String>>,
}

#[napi(object)]
pub struct JourneyFoldResult {
    pub tests: u32,
    pub modules: u32,
    pub crossings: f64,
    pub passes: u32,
    /// Files two builds numbered differently, read at the regions both hold.
    pub renumbered: Vec<String>,
    /// Modules a case ran that no record holds: a change there selects nothing.
    pub unrecorded: Vec<String>,
    /// Part files that ran code under no journey a case handed out.
    pub unclaimed: Vec<String>,
    /// Heads that wrote parts in the run before and none in this one; absent
    /// when there was no run before to compare with.
    pub silent: Option<Vec<String>>,
}

/// Read, fold, and encode one run's case journals without crossing per-row objects into V8.
#[napi(catch_unwind)]
pub fn fold_journey(
    case_directory: String,
    root: String,
    stores: Vec<String>,
    instrumentation: String,
    budget_megabytes: Option<u32>,
) -> napi::Result<JourneyFold> {
    let answered = answer(
        &case_directory,
        &root,
        &stores,
        &instrumentation,
        budget_megabytes,
        &[],
        &[],
        None,
    )
    .map_err(napi::Error::from_reason)?;
    Ok(JourneyFold {
        bytes: answered.folded.bytes.into(),
        tests: answered.tests,
        modules: answered.folded.modules,
        crossings: answered.folded.crossings as f64,
        passes: answered.folded.passes,
        renumbered: answered.folded.renumbered,
        unrecorded: answered.gaps.unrecorded,
        unclaimed: answered.gaps.unclaimed,
        silent: answered.gaps.silent,
    })
}

struct FoldAnswer {
    folded: Folded,
    tests: u32,
    gaps: Gaps,
}

fn answer(
    case_directory: &str,
    root: &str,
    stores: &[String],
    instrumentation: &str,
    budget_megabytes: Option<u32>,
    parts: &[String],
    part_stores: &[String],
    previous: Option<&str>,
) -> Result<FoldAnswer, String> {
    let run = journey_journal::inspect(Path::new(case_directory), Path::new(root), parts)?;
    let mut found = journey_record::read_records(stores, &run.wanted, instrumentation)?;
    if !run.part_wanted.is_empty() {
        for (id, module) in journey_record::read_part_records(part_stores, &run.part_wanted)? {
            found.entry(id).or_insert(module);
        }
    }
    let silent = previous.and_then(previous_heads).map(|before| {
        before.into_iter().filter(|head| run.heads.binary_search_by(|now| order::code_unit(now, head)).is_err()).collect()
    });
    let gaps = Gaps {
        unrecorded: unrecorded(&run, &found)?,
        unclaimed: run.unclaimed.clone(),
        heads: run.heads.clone(),
        silent,
    };
    let folded = fold(
        &run,
        found,
        budget_megabytes.map_or(DEFAULT_BUDGET, |value| value as usize * 1_048_576),
        &gaps,
    )?;
    Ok(FoldAnswer {
        folded,
        tests: run.tests.len() as u32,
        gaps,
    })
}

/// The heads the artifact already at `output` saw write parts. None when
/// nothing is there, or what is there does not carry them: with no run before
/// to compare with, no head can be said to have gone quiet.
fn previous_heads(output: &str) -> Option<Vec<String>> {
    let bytes = fs::read(output).ok()?;
    let decoded = journey_columns::decode(&bytes, journey_format::FORMAT).ok()?;
    let strings = journey_stitch::strings(&decoded).ok()?;
    Some(journey_format::read_gaps(&decoded, &strings).ok()??.heads)
}

/// The modules a case ran that no record holds, by name: what ran there is
/// in no region, so a change to them selects nothing. The journals are
/// replayed again only when such a module exists.
fn unrecorded(run: &CaseRun, found: &HashMap<ModuleId, Module>) -> Result<Vec<String>, String> {
    let missing: HashSet<ModuleId> = run
        .wanted
        .iter()
        .chain(&run.part_wanted)
        .filter(|id| !found.contains_key(*id))
        .cloned()
        .collect();
    if missing.is_empty() {
        return Ok(Vec::new());
    }
    let mut visitor = UnrecordedVisitor { charge: Charge::new(run), missing: &missing, named: HashSet::new() };
    replay_run(run, &mut visitor)?;
    let mut named: Vec<String> = visitor
        .named
        .into_iter()
        .map(|id| match id {
            ModuleId::Name(name) => name,
            // A numbered module is named by its record, and there is none.
            ModuleId::Number(number) => format!("#{number}"),
        })
        .collect();
    named.sort_unstable_by(|left, right| order::code_unit(left, right));
    Ok(named)
}

/// Fold one run and write its compressed artifact without transferring it through V8.
///
/// `parts` are directories of frames written beyond a fence, joined to the
/// cases by journey id; `part_stores` hold the inventories those frames name.
#[napi(catch_unwind)]
pub fn fold_journey_to(
    case_directory: String,
    root: String,
    stores: Vec<String>,
    instrumentation: String,
    output: String,
    budget_megabytes: Option<u32>,
    parts: Option<Vec<String>>,
    part_stores: Option<Vec<String>>,
) -> napi::Result<JourneyFoldResult> {
    let answered = answer(
        &case_directory,
        &root,
        &stores,
        &instrumentation,
        budget_megabytes,
        parts.as_deref().unwrap_or_default(),
        part_stores.as_deref().unwrap_or_default(),
        Some(&output),
    )
    .map_err(napi::Error::from_reason)?;
    journey_output::replace(&output, &answered.folded.bytes).map_err(napi::Error::from_reason)?;
    Ok(JourneyFoldResult {
        tests: answered.tests,
        modules: answered.folded.modules,
        crossings: answered.folded.crossings as f64,
        passes: answered.folded.passes,
        renumbered: answered.folded.renumbered,
        unrecorded: answered.gaps.unrecorded,
        unclaimed: answered.gaps.unclaimed,
        silent: answered.gaps.silent,
    })
}

struct Folded {
    bytes: Vec<u8>,
    modules: u32,
    crossings: u64,
    passes: u32,
    renumbered: Vec<String>,
}

fn fold(
    run: &CaseRun,
    found: HashMap<ModuleId, Module>,
    budget: usize,
    gaps: &Gaps,
) -> Result<Folded, String> {
    let mut modules: Vec<Module> = found.into_values().collect();
    modules.sort_by(|left, right| {
        order::code_unit(&left.file, &right.file).then_with(|| id_order(&left.id, &right.id))
    });
    let row_of: HashMap<ModuleId, usize> = modules
        .iter()
        .enumerate()
        .map(|(row, module)| (module.id.clone(), row))
        .collect();
    let mut renumbered: Vec<String> = modules
        .iter()
        .filter(|module| !module.lands.is_empty())
        .map(|module| module.file.clone())
        .collect();
    renumbered.dedup();
    let mut module_blocks = Vec::with_capacity(modules.len() + 1);
    module_blocks.push(0);
    for module in &modules {
        module_blocks.push(module_blocks.last().copied().unwrap_or(0) + module.blocks.len());
    }
    let block_count = *module_blocks.last().unwrap_or(&0);
    let mut called_sets = vec![0; block_count];
    let mut loaded_flags = vec![false; block_count];
    let mut module_entered = vec![false; modules.len()];
    let mut sets = SetPool::new(run.tests.len());
    let empty = sets.intern(&[]);
    called_sets.fill(empty);
    if block_count == 0 || run.tests.is_empty() {
        return Ok(Folded {
            bytes: journey_format::encode(&run.tests, &[], &sets, Some(gaps))?,
            modules: 0,
            crossings: 0,
            passes: 0,
            renumbered,
        });
    }

    let words = (run.tests.len() + 31) >> 5;
    let per_block = words * 8;
    let limit = budget.max(per_block);
    let mut crossings = 0_u64;
    let mut passes = 0_u32;
    let mut first = 0;
    let mut scratch = Vec::with_capacity(run.tests.len());
    while first < modules.len() {
        let mut last = first;
        let mut held = 0;
        while last < modules.len() {
            let cost = (module_blocks[last + 1] - module_blocks[last]) * per_block;
            if last > first && held + cost > limit {
                break;
            }
            held += cost;
            last += 1;
        }
        let first_block = module_blocks[first];
        let local_blocks = module_blocks[last] - first_block;
        let mut called = vec![0_u32; local_blocks * words];
        let mut visitor = FoldVisitor {
            charge: Charge::new(run),
            row_of: &row_of,
            modules: &modules,
            module_blocks: &module_blocks,
            first,
            last,
            first_block,
            words,
            called: &mut called,
            loaded: &mut loaded_flags[first_block..first_block + local_blocks],
            module_row: 0,
        };
        replay_run(run, &mut visitor)?;
        passes += 1;

        for local in 0..local_blocks {
            let at = local * words;
            scratch.clear();
            collect(&called, at, words, &mut scratch);
            let block = first_block + local;
            called_sets[block] = sets.intern(&scratch);
            crossings += scratch.len() as u64;
            if !scratch.is_empty() || loaded_flags[block] {
                module_entered[module_of(&module_blocks, first, last, block)] = true;
            }
        }
        first = last;
    }

    let encoded: Vec<EncodedModule<'_>> = modules
        .iter()
        .enumerate()
        .filter(|(row, _)| module_entered[*row])
        .map(|(row, module)| EncodedModule {
            module,
            called: &called_sets[module_blocks[row]..module_blocks[row + 1]],
            loaded: &loaded_flags[module_blocks[row]..module_blocks[row + 1]],
        })
        .collect();
    let module_count = encoded.len() as u32;
    Ok(Folded {
        bytes: journey_format::encode(&run.tests, &encoded, &sets, Some(gaps))?,
        modules: module_count,
        crossings,
        passes,
        renumbered,
    })
}

/// Where the frame being replayed is charged: one case, a case file's range,
/// or the cases a part frame's journey belongs to. The fold and the count of
/// unrecorded modules resolve frames through this one reading, so the two
/// cannot disagree on who ran what.
struct Charge<'a> {
    run: &'a CaseRun,
    case_frame: usize,
    test_first: u32,
    test_last: u32,
    /// The cases a part frame is charged to; cases themselves use the range.
    targets: &'a [u32],
    /// The part file being replayed, once the case frames are done.
    part: Option<usize>,
}

impl<'a> Charge<'a> {
    fn new(run: &'a CaseRun) -> Self {
        Charge { run, case_frame: 0, test_first: 0, test_last: 0, targets: &[], part: None }
    }

    /// Whether the frame is charged to no case.
    fn nobody(&self) -> bool {
        self.test_first == self.test_last && self.targets.is_empty()
    }

    fn test(&mut self, packed: &str) -> Result<(), String> {
        let run = self.run;
        if let Some(part) = self.part {
            let journey = journey_journal::journey_of(packed);
            self.test_first = 0;
            self.test_last = 0;
            // A journey no case handed out is work the writer did for nobody in
            // particular: a trace its tracer started at import, or a request
            // from outside the run. That is every case it served, the same as
            // work under no journey at all.
            self.targets = if journey.is_empty() {
                &run.part_tests[part]
            } else {
                run.journey_tests.get(journey).map_or(&run.part_tests[part], Vec::as_slice)
            };
            return Ok(());
        }
        let (file, name, id, _) = journey_journal::unpack_case(packed);
        if name.is_empty() && id.is_empty() {
            let normalized = journey_journal::project_path(&run.root, file);
            let range = run.tests_by_file.get(&normalized).copied().unwrap_or((0, 0));
            self.test_first = range.0;
            self.test_last = range.1;
        } else {
            let test = run
                .frame_tests
                .get(self.case_frame)
                .copied()
                .ok_or_else(|| "case journal replay changed while it was being folded".to_owned())?;
            self.case_frame += 1;
            self.test_first = test;
            self.test_last = test + 1;
        }
        Ok(())
    }
}

trait Charged<'a>: Visitor {
    fn charge(&mut self) -> &mut Charge<'a>;
}

/// Replay every case journal, then every part, charging each frame.
fn replay_run<'a>(run: &CaseRun, visitor: &mut impl Charged<'a>) -> Result<(), String> {
    journey_journal::replay(&run.paths, visitor)?;
    if visitor.charge().case_frame != run.frame_tests.len() {
        return Err("case journal replay changed while it was being folded".to_owned());
    }
    for (at, path) in run.parts.iter().enumerate() {
        visitor.charge().part = Some(at);
        journey_journal::replay_part(path, visitor)?;
    }
    Ok(())
}

/// The modules no record holds that a frame charged to a case named.
struct UnrecordedVisitor<'a> {
    charge: Charge<'a>,
    missing: &'a HashSet<ModuleId>,
    named: HashSet<ModuleId>,
}

impl<'a> Charged<'a> for UnrecordedVisitor<'a> {
    fn charge(&mut self) -> &mut Charge<'a> {
        &mut self.charge
    }
}

impl Visitor for UnrecordedVisitor<'_> {
    fn test(&mut self, packed: &str) -> Result<(), String> {
        self.charge.test(packed)
    }

    fn wants(&mut self, id: &ModuleId) -> bool {
        if self.missing.contains(id) && !self.charge.nobody() {
            self.named.insert(id.clone());
        }
        false
    }

    fn module(&mut self, _: &ModuleId, _: &[u32], _: &[u32], _: &[u32]) {}
}

struct FoldVisitor<'a> {
    charge: Charge<'a>,
    row_of: &'a HashMap<ModuleId, usize>,
    modules: &'a [Module],
    module_blocks: &'a [usize],
    first: usize,
    last: usize,
    first_block: usize,
    words: usize,
    called: &'a mut [u32],
    /// One flag per region in this pass, and no test: what ran while a module
    /// evaluated is answered through the import graph, not credited here.
    loaded: &'a mut [bool],
    module_row: usize,
}

impl<'a> Charged<'a> for FoldVisitor<'a> {
    fn charge(&mut self) -> &mut Charge<'a> {
        &mut self.charge
    }
}

impl Visitor for FoldVisitor<'_> {
    fn test(&mut self, packed: &str) -> Result<(), String> {
        self.charge.test(packed)
    }

    fn wants(&mut self, id: &ModuleId) -> bool {
        let Some(row) = self.row_of.get(id).copied() else {
            return false;
        };
        if row < self.first || row >= self.last || self.charge.nobody() {
            return false;
        }
        self.module_row = row;
        true
    }

    fn module(&mut self, _: &ModuleId, hits: &[u32], shared: &[u32], _: &[u32]) {
        let modules = self.modules;
        let module = &modules[self.module_row];
        let base = self.module_blocks[self.module_row] - self.first_block;
        let mut shared_at = 0;
        for ordinal in hits {
            let ordinal_value = *ordinal;
            let ordinal = ordinal_value as usize;
            let own = [ordinal_value];
            let targets: &[u32] = if module.lands.is_empty() {
                if ordinal >= module.blocks.len() {
                    continue;
                }
                &own
            } else {
                let Some(targets) = module.lands.get(ordinal) else {
                    continue;
                };
                targets
            };
            while shared_at < shared.len() && shared[shared_at] < ordinal_value {
                shared_at += 1;
            }
            if shared.get(shared_at).copied() == Some(ordinal_value) {
                for block in targets {
                    self.loaded[base + *block as usize] = true;
                }
                continue;
            }
            for block in targets {
                let at = (base + *block as usize) * self.words;
                mark_range(self.called, at, self.charge.test_first as usize, self.charge.test_last as usize);
                for test in self.charge.targets {
                    self.called[at + (*test as usize >> 5)] |= 1 << (test & 31);
                }
            }
        }
    }
}

fn mark_range(bits: &mut [u32], at: usize, first: usize, last: usize) {
    for test in first..last {
        bits[at + (test >> 5)] |= 1 << (test & 31);
    }
}

fn collect(bits: &[u32], at: usize, words: usize, out: &mut Vec<u32>) {
    for word in 0..words {
        let mut value = bits[at + word];
        while value != 0 {
            let low = value.trailing_zeros();
            out.push(((word as u32) << 5) + low);
            value &= value - 1;
        }
    }
}

fn module_of(offsets: &[usize], first: usize, last: usize, block: usize) -> usize {
    let mut low = first;
    let mut high = last;
    while low + 1 < high {
        let middle = (low + high) >> 1;
        if offsets[middle] <= block {
            low = middle;
        } else {
            high = middle;
        }
    }
    low
}

fn id_order(left: &ModuleId, right: &ModuleId) -> std::cmp::Ordering {
    match (left, right) {
        (ModuleId::Number(left), ModuleId::Number(right)) => left.cmp(right),
        (ModuleId::Number(_), ModuleId::Name(_)) => std::cmp::Ordering::Less,
        (ModuleId::Name(_), ModuleId::Number(_)) => std::cmp::Ordering::Greater,
        (ModuleId::Name(left), ModuleId::Name(right)) => order::code_unit(left, right),
    }
}
