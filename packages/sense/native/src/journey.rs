use std::collections::HashMap;
use std::path::Path;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::journey_format::{self, EncodedModule, SetPool};
use crate::journey_journal::{self, CaseRun, ModuleId, Visitor};
use crate::journey_output;
use crate::journey_record::{self, Module};
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
}

#[napi(object)]
pub struct JourneyFoldResult {
    pub tests: u32,
    pub modules: u32,
    pub crossings: f64,
    pub passes: u32,
    /// Files two builds numbered differently, read at the regions both hold.
    pub renumbered: Vec<String>,
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
    )
    .map_err(napi::Error::from_reason)?;
    Ok(JourneyFold {
        bytes: answered.folded.bytes.into(),
        tests: answered.tests,
        modules: answered.folded.modules,
        crossings: answered.folded.crossings as f64,
        passes: answered.folded.passes,
        renumbered: answered.folded.renumbered,
    })
}

struct FoldAnswer {
    folded: Folded,
    tests: u32,
}

fn answer(
    case_directory: &str,
    root: &str,
    stores: &[String],
    instrumentation: &str,
    budget_megabytes: Option<u32>,
) -> Result<FoldAnswer, String> {
    let run = journey_journal::inspect(Path::new(case_directory), Path::new(root))?;
    let found = journey_record::read_records(stores, &run.wanted, instrumentation)?;
    let folded = fold(
        &run,
        found,
        budget_megabytes.map_or(DEFAULT_BUDGET, |value| value as usize * 1_048_576),
    )?;
    Ok(FoldAnswer {
        folded,
        tests: run.tests.len() as u32,
    })
}

/// Fold one run and write its compressed artifact without transferring it through V8.
#[napi(catch_unwind)]
pub fn fold_journey_to(
    case_directory: String,
    root: String,
    stores: Vec<String>,
    instrumentation: String,
    output: String,
    budget_megabytes: Option<u32>,
) -> napi::Result<JourneyFoldResult> {
    let answered = answer(
        &case_directory,
        &root,
        &stores,
        &instrumentation,
        budget_megabytes,
    )
    .map_err(napi::Error::from_reason)?;
    journey_output::replace(&output, &answered.folded.bytes).map_err(napi::Error::from_reason)?;
    Ok(JourneyFoldResult {
        tests: answered.tests,
        modules: answered.folded.modules,
        crossings: answered.folded.crossings as f64,
        passes: answered.folded.passes,
        renumbered: answered.folded.renumbered,
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
            bytes: journey_format::encode(&run.tests, &[], &sets)?,
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
            run,
            row_of: &row_of,
            modules: &modules,
            module_blocks: &module_blocks,
            first,
            last,
            first_block,
            words,
            called: &mut called,
            loaded: &mut loaded_flags[first_block..first_block + local_blocks],
            case_frame: 0,
            test_first: 0,
            test_last: 0,
            module_row: 0,
        };
        journey_journal::replay(&run.paths, &mut visitor)?;
        if visitor.case_frame != run.frame_tests.len() {
            return Err("case journal replay changed while it was being folded".to_owned());
        }
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
        bytes: journey_format::encode(&run.tests, &encoded, &sets)?,
        modules: module_count,
        crossings,
        passes,
        renumbered,
    })
}

struct FoldVisitor<'a> {
    run: &'a CaseRun,
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
    case_frame: usize,
    test_first: u32,
    test_last: u32,
    module_row: usize,
}

impl Visitor for FoldVisitor<'_> {
    fn test(&mut self, packed: &str) -> Result<(), String> {
        let (file, name, id, _) = journey_journal::unpack_case(packed);
        if name.is_empty() && id.is_empty() {
            let normalized = journey_journal::project_path(&self.run.root, file);
            let range = self.run.tests_by_file.get(&normalized).copied().unwrap_or((0, 0));
            self.test_first = range.0;
            self.test_last = range.1;
        } else {
            let test = self
                .run
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

    fn wants(&mut self, id: &ModuleId) -> bool {
        let Some(row) = self.row_of.get(id).copied() else {
            return false;
        };
        if row < self.first || row >= self.last || self.test_first == self.test_last {
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
                mark_range(
                    self.called,
                    (base + *block as usize) * self.words,
                    self.test_first as usize,
                    self.test_last as usize,
                );
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
