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
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use rayon::prelude::*;

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
    let mut loaded_flags: Vec<AtomicBool> = (0..block_count).map(|_| AtomicBool::new(false)).collect();
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
        let called: Vec<AtomicU32> = (0..local_blocks * words).map(|_| AtomicU32::new(0)).collect();
        if let Some(lines) = lines.as_mut() {
            lines.slice(local_blocks);
        }
        let slice = Slice {
            row_of: &row_of,
            readings,
            ordinal_offsets: &ordinal_offsets,
            ordinal_blocks: &ordinal_blocks,
            first,
            last,
            first_block,
            words,
            called: &called,
            loaded: &loaded_flags[first_block..first_block + local_blocks],
            gathers: lines.is_some(),
        };
        // Every journal at once: each one's frames are charged from its own
        // first frame, and the line that first reached a region is the first
        // journal's to reach it, as one replay in order would find it.
        let reaches = (0..run.paths.len())
            .into_par_iter()
            .map(|at| {
                let frames = run.path_frames.get(at + 1).copied().unwrap_or(run.frame_tests.len());
                let mut visitor = FoldVisitor::new(&slice, Charge::at(run, run.path_frames[at]));
                journal_scan::replay(std::slice::from_ref(&run.paths[at]), &mut visitor)?;
                if visitor.charge.case_frame != frames {
                    return Err("case journal replay changed while it was being folded".to_owned());
                }
                Ok(visitor.reach)
            })
            .collect::<Result<Vec<Reach>, String>>()?;
        if let Some(lines) = lines.as_mut() {
            for reach in reaches {
                lines.reach.merge(reach);
            }
        }
        // A part's frames are charged to the cases its journeys belong to, after every case's.
        for (at, path) in run.parts.iter().enumerate() {
            let mut charge = Charge::at(run, run.frame_tests.len());
            charge.part = Some(at);
            let mut visitor = FoldVisitor::new(&slice, charge);
            journal_scan::replay_part(path, &mut visitor)?;
            if let Some(lines) = lines.as_mut() {
                lines.reach.merge(visitor.reach);
            }
        }
        let called: Vec<u32> = called.into_iter().map(AtomicU32::into_inner).collect();        passes += 1;

        for local in 0..local_blocks {
            scratch.clear();
            collect(&called, local * words, words, &mut scratch);
            let block = first_block + local;
            called_sets[block] = sets.intern(&scratch);
            crossings += scratch.len() as u64;
            if !scratch.is_empty() || *loaded_flags[block].get_mut() {
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

    let loaded_flags: Vec<bool> = loaded_flags.into_iter().map(AtomicBool::into_inner).collect();
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
    reach: Reach,
}

/// The line each frame first reached a region of the slice at: keyed by the
/// case for its own frame and by the file's first case for an ambient one.
#[derive(Default)]
struct Reach {
    width: u64,
    own: HashMap<u64, u64>,
    ambient: HashMap<u64, u64>,
}

impl Reach {
    fn reached(&mut self, test: u32, local: usize, line: u32, ambient: bool) {
        let held = if ambient { &mut self.ambient } else { &mut self.own };
        held.entry(u64::from(test) * self.width + local as u64).or_insert(u64::from(line) * 2 + u64::from(ambient));
    }

    /// Take what a later replay reached, where nothing before it reached first.
    fn merge(&mut self, later: Reach) {
        for (key, line) in later.own {
            self.own.entry(key).or_insert(line);
        }
        for (key, line) in later.ambient {
            self.ambient.entry(key).or_insert(line);
        }
    }
}

impl<'a> Lines<'a> {
    fn new(run: &CaseRun, lined: &'a [bool]) -> Self {
        let mut file_start = vec![0; run.tests.len()];
        for &(first, last) in run.tests_by_file.values() {
            file_start[first as usize..last as usize].fill(first);
        }
        Lines { lined, file_start, builders: lined.iter().map(|_| None).collect(), reach: Reach::default() }
    }

    fn slice(&mut self, width: usize) {
        self.reach = Reach { width: width as u64, ..Reach::default() };
    }

    fn region(&mut self, local: usize, members: &[u32], module: u32, block: u32) {
        for &test in members {
            if !self.lined[test as usize] {
                continue;
            }
            let reach = &self.reach;
            let value = reach
                .own
                .get(&(u64::from(test) * reach.width + local as u64))
                .or_else(|| reach.ambient.get(&(u64::from(self.file_start[test as usize]) * reach.width + local as u64)))
                .copied()
                .unwrap_or(1);
            self.builders[test as usize].get_or_insert_with(case_lines::Builder::default).add(module, block, value).expect("the fold hands a case's regions over in order");
        }
    }

    fn finish(self) -> Vec<Vec<u8>> {
        self.builders
            .into_iter()
            .zip(self.lined)
            .map(|(builder, lined)| if *lined { builder.unwrap_or_default().finish(None) } else { Vec::new() })
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
        Self::at(run, 0)
    }

    /// Charge from the `case_frame`th case frame on, as a journal replayed on its own begins.
    fn at(run: &'a CaseRun, case_frame: usize) -> Self {
        Charge { run, case_frame, test_first: 0, test_last: 0, ambient: false, targets: &[], part: None }
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

/// What every journal's replay of one module slice shares.
struct Slice<'a, 'l> {
    row_of: &'a HashMap<ModuleId, usize>,
    readings: Option<&'a HashMap<ModuleId, (ModuleId, Vec<u32>)>>,
    ordinal_offsets: &'l [usize],
    /// Each module's regions by ordinal, [`NONE`] for an ordinal it holds none at.
    ordinal_blocks: &'l [usize],
    first: usize,
    last: usize,
    first_block: usize,
    words: usize,
    called: &'l [AtomicU32],
    /// One flag per region in this slice, and no test: what ran while a module
    /// evaluated is answered through the import graph, not credited here.
    loaded: &'l [AtomicBool],
    /// Whether the line each cut hit was first reached at is gathered.
    gathers: bool,
}

struct FoldVisitor<'a, 's> {
    slice: &'s Slice<'a, 's>,
    charge: Charge<'a>,
    module_row: usize,
    /// The record's ordinal for each of the wanted row's, where it is a reading
    /// of a file read again.
    lands: Option<&'a [u32]>,
    /// Whether the wanted row carries the line each hit was first reached at.
    cut: bool,
    reach: Reach,
}

impl<'a, 's> FoldVisitor<'a, 's> {
    fn new(slice: &'s Slice<'a, 's>, charge: Charge<'a>) -> Self {
        let width = (slice.loaded.len()) as u64;
        FoldVisitor { slice, charge, module_row: 0, lands: None, cut: false, reach: Reach { width, ..Reach::default() } }
    }
}

impl Visitor for FoldVisitor<'_, '_> {
    fn test(&mut self, packed: &str) -> Result<(), String> {
        self.charge.test(packed)
    }

    fn wants(&mut self, id: &ModuleId, cut: bool) -> bool {
        let slice = self.slice;
        let reading = slice.readings.and_then(|readings| readings.get(id));
        let Some(row) = slice.row_of.get(reading.map_or(id, |(target, _)| target)).copied() else {
            return false;
        };
        if row < slice.first || row >= slice.last || self.charge.nobody() {
            return false;
        }
        self.module_row = row;
        self.lands = reading.map(|(_, lands)| lands.as_slice());
        self.cut = cut;
        true
    }

    fn module(&mut self, _: &ModuleId, hits: &[u32], shared: &[u32], _: &[u32], reached: Option<&[u32]>) {
        let slice = self.slice;
        let base = slice.ordinal_offsets[self.module_row];
        let span = slice.ordinal_offsets[self.module_row + 1] - base;
        let mut shared_at = 0;
        for (at, &hit) in hits.iter().enumerate() {
            while shared_at < shared.len() && shared[shared_at] < hit {
                shared_at += 1;
            }
            let ordinal = match self.lands {
                None => hit as usize,
                Some(lands) => lands.get(hit as usize).filter(|land| **land != NO_LAND).map_or(span, |land| *land as usize),
            };
            if ordinal >= span || slice.ordinal_blocks[base + ordinal] == NONE {
                continue;
            }
            let block = slice.ordinal_blocks[base + ordinal] - slice.first_block;
            if shared.get(shared_at) == Some(&hit) {
                slice.loaded[block].store(true, Ordering::Relaxed);
                continue;
            }
            let charge = &self.charge;
            mark_range(slice.called, block * slice.words, charge.test_first as usize, charge.test_last as usize);
            for test in charge.targets {
                slice.called[block * slice.words + (*test as usize >> 5)].fetch_or(1 << (test & 31), Ordering::Relaxed);
            }
            if let (true, true, Some(reached)) = (self.cut, slice.gathers, reached) {
                self.reach.reached(charge.test_first, block, reached[at], charge.ambient);
            }
        }
    }
}

/// Set the bits of tests `first..last`, a word at a time.
fn mark_range(bits: &[AtomicU32], at: usize, first: usize, last: usize) {
    let mut test = first;
    while test < last {
        let word = test >> 5;
        let low = test & 31;
        let high = ((word + 1) << 5).min(last) - (word << 5);
        let mask = if high - low == 32 { u32::MAX } else { ((1_u32 << (high - low)) - 1) << low };
        bits[at + word].fetch_or(mask, Ordering::Relaxed);
        test = (word + 1) << 5;
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
