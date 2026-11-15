//! The bounded fold of one run's case journals into the crossing sets an
//! artifact or a record's case index carries: the journals stay on disk and
//! are replayed once per module slice, so the run's test-by-region relation is
//! held one slice at a time.
//!
//! A journey artifact keeps every region its modules name; a record's case
//! index keeps only the regions with a line, joins the readings a run took of
//! one file into that file's record, and gathers the test line that first
//! reached each region of a cut case (spec 0100).

use std::collections::HashMap;

use crate::case_lines;
use crate::case_owner;
use crate::crossing_sets::SetPool;
use crate::journal_scan::{self, Visitor};
use crate::journey_format::EncodedModule;
use crate::journey_journal::{CaseRun, ModuleId};
use crate::journey_record::{kept_owners, Module};
use crate::order;
use crate::record_layout::LAYOUT;

pub(crate) struct Folded {
    pub bytes: Vec<u8>,
    pub modules: u32,
    pub crossings: u64,
    pub passes: u32,
}

/// One module the fold places hits in, and each region's ordinal; `None`
/// where a region's ordinal is its place among the module's regions.
pub(crate) struct Placed {
    pub module: Module,
    pub ordinals: Option<Vec<u32>>,
}

/// What a record's case index asks of the fold beyond a journey artifact.
pub(crate) struct CaseShape<'a> {
    /// Every reading of a file other than its own, by the id its probes report
    /// under: the id of the file's record, and that record's ordinal for each
    /// of the reading's, [`NO_LAND`] where the region has no place in it.
    pub readings: &'a HashMap<ModuleId, (ModuleId, Vec<u32>)>,
    /// Which cases carry lines; `None` where no frame was cut.
    pub lined: Option<&'a [bool]>,
}

/// A reading's region with no place in its file's record.
pub(crate) const NO_LAND: u32 = u32::MAX;
const NONE: usize = usize::MAX;

/// Fold the run, and encode the modules a case entered with `encode`, which
/// is handed each case's lines, empty where the run gathered none.
pub(crate) fn fold(
    run: &CaseRun,
    mut placed: Vec<Placed>,
    budget: usize,
    case: Option<&CaseShape<'_>>,
    encode: impl FnOnce(&[EncodedModule<'_>], Vec<Vec<u8>>, &mut SetPool) -> Result<Vec<u8>, String>,
) -> Result<Folded, String> {
    placed.sort_by(|left, right| {
        order::code_unit(&left.module.file, &right.module.file).then_with(|| order::code_unit(&left.module.id, &right.module.id))
    });
    let row_of: HashMap<ModuleId, usize> = placed.iter().enumerate().map(|(row, at)| (at.module.id.clone(), row)).collect();
    let mut module_blocks = Vec::with_capacity(placed.len() + 1);
    let mut ordinal_offsets = Vec::with_capacity(placed.len() + 1);
    module_blocks.push(0);
    ordinal_offsets.push(0);
    for at in &placed {
        let blocks = at.module.blocks.len();
        let span = at.ordinals.as_ref().map_or(blocks, |ordinals| ordinals.iter().map(|ordinal| *ordinal as usize + 1).max().unwrap_or(0));
        module_blocks.push(module_blocks[module_blocks.len() - 1] + blocks);
        ordinal_offsets.push(ordinal_offsets[ordinal_offsets.len() - 1] + span);
    }
    let mut ordinal_blocks = vec![NONE; ordinal_offsets[placed.len()]];
    for (row, at) in placed.iter().enumerate() {
        for place in 0..at.module.blocks.len() {
            let ordinal = at.ordinals.as_ref().map_or(place, |ordinals| ordinals[place] as usize);
            ordinal_blocks[ordinal_offsets[row] + ordinal] = module_blocks[row] + place;
        }
    }
    // Each region's place among its module's regions with a line, or `None`
    // for one the transform wrote: a case index keeps only the first.
    let written: Vec<Option<u32>> = placed
        .iter()
        .flat_map(|at| {
            let mut kept = 0;
            at.module.blocks.iter().map(move |block| {
                let place = (case.is_none() || block.start_line != LAYOUT.coverage.no_line).then_some(kept);
                kept += u32::from(place.is_some());
                place
            })
        })
        .collect();

    let block_count = module_blocks[placed.len()];
    let mut called_sets = vec![0; block_count];
    let mut loaded_flags = vec![false; block_count];
    let mut module_entered = vec![false; placed.len()];
    let mut sets = SetPool::new(run.tests.len());
    let empty = sets.intern(&[]);
    called_sets.fill(empty);
    if block_count == 0 || run.tests.is_empty() {
        return Ok(Folded { bytes: encode(&[], Vec::new(), &mut sets)?, modules: 0, crossings: 0, passes: 0 });
    }

    let words = (run.tests.len() + 31) >> 5;
    let per_block = words * 8;
    let limit = budget.max(per_block);
    let mut lines = case.and_then(|case| case.lined).map(|lined| Lines::new(run, lined));
    let readings = case.map(|case| case.readings);
    let mut crossings = 0_u64;
    let mut passes = 0_u32;
    let mut first = 0;
    // The module the collection has reached, and how many before it a case entered.
    let mut encoded_row = 0;
    let mut encoded_at = 0_u32;
    let mut scratch = Vec::with_capacity(run.tests.len());
    while first < placed.len() {
        let mut last = first;
        let mut held = 0;
        while last < placed.len() {
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
        if let Some(lines) = lines.as_mut() {
            lines.slice(local_blocks);
        }
        let mut visitor = FoldVisitor {
            charge: Charge::new(run),
            row_of: &row_of,
            readings,
            ordinal_offsets: &ordinal_offsets,
            ordinal_blocks: &ordinal_blocks,
            first,
            last,
            first_block,
            words,
            called: &mut called,
            loaded: &mut loaded_flags[first_block..first_block + local_blocks],
            module_row: 0,
            lands: None,
            cut: false,
            lines: lines.as_mut(),
        };
        replay_run(run, &mut visitor)?;
        passes += 1;

        for local in 0..local_blocks {
            scratch.clear();
            collect(&called, local * words, words, &mut scratch);
            let block = first_block + local;
            called_sets[block] = sets.intern(&scratch);
            crossings += scratch.len() as u64;
            if !scratch.is_empty() || loaded_flags[block] {
                module_entered[module_of(&module_blocks, first, last, block)] = true;
            }
            let (Some(lines), Some(place)) = (lines.as_mut(), written[block]) else { continue };
            if scratch.is_empty() {
                continue;
            }
            while module_blocks[encoded_row + 1] <= block {
                encoded_at += u32::from(module_entered[encoded_row]);
                encoded_row += 1;
            }
            lines.region(local, &scratch, encoded_at, place);
        }
        first = last;
    }

    let lines = lines.map(Lines::finish).unwrap_or_default();
    let entered: Vec<usize> = (0..placed.len()).filter(|row| module_entered[*row]).collect();
    if case.is_none() {
        let encoded: Vec<EncodedModule<'_>> = entered
            .iter()
            .map(|&row| EncodedModule {
                module: &placed[row].module,
                called: &called_sets[module_blocks[row]..module_blocks[row + 1]],
                loaded: &loaded_flags[module_blocks[row]..module_blocks[row + 1]],
                overwritten: &[],
            })
            .collect();
        let bytes = encode(&encoded, lines, &mut sets)?;
        return Ok(Folded { bytes, modules: encoded.len() as u32, crossings, passes });
    }
    // The regions with a line, as `executionIndexFrom` keeps them: the rest
    // were written by the transform, and a case has nowhere to name them.
    let cut: Vec<(Module, Vec<u32>, Vec<bool>)> = entered
        .iter()
        .map(|&row| {
            let module = &placed[row].module;
            let range = module_blocks[row]..module_blocks[row + 1];
            let kept: Vec<usize> = range.filter(|block| written[*block].is_some()).collect();
            let owners = kept_owners(module.owners.as_deref().unwrap_or_default(), &written[module_blocks[row]..module_blocks[row + 1]]);
            let written_module = Module {
                id: module.id.clone(),
                file: module.file.clone(),
                blocks: kept.iter().map(|block| module.blocks[block - module_blocks[row]].clone()).collect(),
                owners: Some(owners),
            };
            (written_module, kept.iter().map(|block| called_sets[*block]).collect(), kept.iter().map(|block| loaded_flags[*block]).collect())
        })
        .collect();
    let encoded: Vec<EncodedModule<'_>> = cut
        .iter()
        .map(|(module, called, loaded)| EncodedModule { module, called, loaded, overwritten: &[] })
        .collect();
    let bytes = encode(&encoded, lines, &mut sets)?;
    Ok(Folded { bytes, modules: encoded.len() as u32, crossings, passes })
}

/// The test line that first reached each region, gathered one module slice at
/// a time: a slice holds the line each cut frame reached, keyed by the case
/// for its own frame and by the file's first case for an ambient one, the
/// first frame to reach it winning. Once a region's set is collected, each
/// lined member takes its own line, else its file's, else a hook's line 0.
struct Lines<'a> {
    lined: &'a [bool],
    file_start: Vec<u32>,
    /// Each case's lines, its modules closed into runs as the next begins.
    builders: Vec<Option<case_lines::Builder>>,
    width: u64,
    own: HashMap<u64, u64>,
    ambient: HashMap<u64, u64>,
}

impl<'a> Lines<'a> {
    fn new(run: &CaseRun, lined: &'a [bool]) -> Self {
        let mut file_start = vec![0; run.tests.len()];
        for &(first, last) in run.tests_by_file.values() {
            file_start[first as usize..last as usize].fill(first);
        }
        Lines { lined, file_start, builders: lined.iter().map(|_| None).collect(), width: 0, own: HashMap::new(), ambient: HashMap::new() }
    }

    fn slice(&mut self, width: usize) {
        self.width = width as u64;
        self.own.clear();
        self.ambient.clear();
    }

    fn reached(&mut self, test: u32, local: usize, line: u32, ambient: bool) {
        let held = if ambient { &mut self.ambient } else { &mut self.own };
        held.entry(u64::from(test) * self.width + local as u64).or_insert(u64::from(line) * 2 + u64::from(ambient));
    }

    fn region(&mut self, local: usize, members: &[u32], module: u32, block: u32) {
        for &test in members {
            if !self.lined[test as usize] {
                continue;
            }
            let value = self
                .own
                .get(&(u64::from(test) * self.width + local as u64))
                .or_else(|| self.ambient.get(&(u64::from(self.file_start[test as usize]) * self.width + local as u64)))
                .copied()
                .unwrap_or(1);
            self.builders[test as usize].get_or_insert_with(case_lines::Builder::default).add(module, block, value);
        }
    }

    fn finish(self) -> Vec<Vec<u8>> {
        self.builders
            .into_iter()
            .zip(self.lined)
            .map(|(builder, lined)| if *lined { builder.unwrap_or_default().finish() } else { Vec::new() })
            .collect()
    }
}

/// Where the frame being replayed is charged: one case, a case file's range,
/// or the cases a part frame's journey belongs to. The fold and the count of
/// unrecorded modules resolve frames through this one reading, so the two
/// cannot disagree on who ran what.
pub(crate) struct Charge<'a> {
    run: &'a CaseRun,
    case_frame: usize,
    test_first: u32,
    test_last: u32,
    /// Whether the frame is a file's ambient one, charged to its whole range.
    ambient: bool,
    /// The cases a part frame is charged to; cases themselves use the range.
    targets: &'a [u32],
    /// The part file being replayed, once the case frames are done.
    part: Option<usize>,
}

impl<'a> Charge<'a> {
    pub(crate) fn new(run: &'a CaseRun) -> Self {
        Charge { run, case_frame: 0, test_first: 0, test_last: 0, ambient: false, targets: &[], part: None }
    }

    /// Whether the frame is charged to no case.
    pub(crate) fn nobody(&self) -> bool {
        self.test_first == self.test_last && self.targets.is_empty()
    }

    pub(crate) fn test(&mut self, packed: &str) -> Result<(), String> {
        let run = self.run;
        self.ambient = false;
        if let Some(part) = self.part {
            let journey = case_owner::journey_of(packed);
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
        let (file, name, id, _) = case_owner::unpack_case(packed);
        if name.is_empty() && id.is_empty() {
            let normalized = case_owner::project_path(&run.root, file);
            let range = run.tests_by_file.get(&normalized).copied().unwrap_or((0, 0));
            self.test_first = range.0;
            self.test_last = range.1;
            self.ambient = true;
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

pub(crate) trait Charged<'a>: Visitor {
    fn charge(&mut self) -> &mut Charge<'a>;
}

/// Replay every case journal, then every part, charging each frame.
pub(crate) fn replay_run<'a>(run: &CaseRun, visitor: &mut impl Charged<'a>) -> Result<(), String> {
    journal_scan::replay(&run.paths, visitor)?;
    if visitor.charge().case_frame != run.frame_tests.len() {
        return Err("case journal replay changed while it was being folded".to_owned());
    }
    for (at, path) in run.parts.iter().enumerate() {
        visitor.charge().part = Some(at);
        journal_scan::replay_part(path, visitor)?;
    }
    Ok(())
}

struct FoldVisitor<'a, 'l> {
    charge: Charge<'a>,
    row_of: &'a HashMap<ModuleId, usize>,
    readings: Option<&'a HashMap<ModuleId, (ModuleId, Vec<u32>)>>,
    ordinal_offsets: &'a [usize],
    /// Each module's regions by ordinal, [`NONE`] for an ordinal it holds none at.
    ordinal_blocks: &'a [usize],
    first: usize,
    last: usize,
    first_block: usize,
    words: usize,
    called: &'l mut [u32],
    /// One flag per region in this pass, and no test: what ran while a module
    /// evaluated is answered through the import graph, not credited here.
    loaded: &'l mut [bool],
    module_row: usize,
    /// The record's ordinal for each of the wanted row's, where it is a reading
    /// of a file read again.
    lands: Option<&'a [u32]>,
    /// Whether the wanted row carries the line each hit was first reached at.
    cut: bool,
    lines: Option<&'l mut Lines<'a>>,
}

impl<'a> Charged<'a> for FoldVisitor<'a, '_> {
    fn charge(&mut self) -> &mut Charge<'a> {
        &mut self.charge
    }
}

impl Visitor for FoldVisitor<'_, '_> {
    fn test(&mut self, packed: &str) -> Result<(), String> {
        self.charge.test(packed)
    }

    fn wants(&mut self, id: &ModuleId, cut: bool) -> bool {
        let reading = self.readings.and_then(|readings| readings.get(id));
        let Some(row) = self.row_of.get(reading.map_or(id, |(target, _)| target)).copied() else {
            return false;
        };
        if row < self.first || row >= self.last || self.charge.nobody() {
            return false;
        }
        self.module_row = row;
        self.lands = reading.map(|(_, lands)| lands.as_slice());
        self.cut = cut;
        true
    }

    fn module(&mut self, _: &ModuleId, hits: &[u32], shared: &[u32], _: &[u32], reached: Option<&[u32]>) {
        let base = self.ordinal_offsets[self.module_row];
        let span = self.ordinal_offsets[self.module_row + 1] - base;
        let mut shared_at = 0;
        for (at, &hit) in hits.iter().enumerate() {
            while shared_at < shared.len() && shared[shared_at] < hit {
                shared_at += 1;
            }
            let ordinal = match self.lands {
                None => hit as usize,
                Some(lands) => lands.get(hit as usize).filter(|land| **land != NO_LAND).map_or(span, |land| *land as usize),
            };
            if ordinal >= span || self.ordinal_blocks[base + ordinal] == NONE {
                continue;
            }
            let block = self.ordinal_blocks[base + ordinal] - self.first_block;
            if shared.get(shared_at) == Some(&hit) {
                self.loaded[block] = true;
                continue;
            }
            let charge = &self.charge;
            mark_range(self.called, block * self.words, charge.test_first as usize, charge.test_last as usize);
            for test in charge.targets {
                self.called[block * self.words + (*test as usize >> 5)] |= 1 << (test & 31);
            }
            if let (true, Some(lines), Some(reached)) = (self.cut, self.lines.as_deref_mut(), reached) {
                lines.reached(charge.test_first, block, reached[at], charge.ambient);
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
