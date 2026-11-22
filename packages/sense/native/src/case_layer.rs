//! One run's case index laid over the one it replaces, the way the snapshot
//! lays a run over its rows (spec 0100).
//!
//! A file the run finished is replaced, every case and every crossing of it. A
//! file it did not finish is laid over: its old cases stay, and the ones that
//! ran again say how they settled this time. A file the checkout no longer
//! holds is retired, because nothing can run it again to retire it. Every other
//! case is carried untouched, so a run of one file leaves the rest of the
//! suite's answer where it was.
//!
//! A region names a set, and a set is translated to the new numbering of cases
//! once however many regions share it, so the work is regions plus distinct
//! sets, which is what the index costs to hold.
//!
//! A module the run recorded is read at the regions it recorded now, and the
//! held cases land on them through the edit between the text they were cut at
//! and the text the run recorded (`landed_through`). A module the run did not
//! record keeps the regions it was recorded with; a landing then lays it onto
//! the cut its rows were landed at ([`follow_cuts`]).

use std::borrow::Cow;
use std::cmp::Ordering;
use std::path::PathBuf;

use rustc_hash::{FxHashMap, FxHashSet};

use crate::case_shard::{read_held, Inventory, Shard};
use crate::journey_format::{self, CaseExtras, EncodedModule};
use crate::journey_journal::Test;
use crate::journey_record::{Block, NO_OWNER};
use crate::order::code_unit;

use super::case_layer_before::before_run;
use super::case_layer_landing::{cut_alike, landed_through, Edit};
use super::case_layer_lines::LaidLines;
use super::case_layer_modules::{Laid, Layer, Over, Recorded};
use super::case_layer_sets::{Pool, Translation, EMPTY};

/// The edit of a module whose two texts are one: it moved nothing.
static NO_EDIT: Edit = Edit { hunks: Vec::new(), reading: None };

/// Which test files the index holds are still in the checkout.
pub(crate) enum Present {
    /// Every one: a caller that retires nothing by absence.
    All,
    /// The ones on disk under this root.
    Under(PathBuf),
    /// These.
    Among(FxHashSet<String>),
}

/// Where each module's edit, from the text the index cut it at to the text the
/// run recorded, comes from. `None` from either is an edit that could not be
/// read: every held case of the module is overwritten on every region.
pub(crate) enum Edits<'a> {
    /// No texts are known: the two cuts read as one text.
    One,
    /// Asked of the caller, only for a module both indexes hold, so a text is
    /// read only where a held case lands through it.
    Asked(&'a dyn Fn(&str) -> Result<Option<Edit>, String>),
    /// Read by the caller before the layering, for every module the run
    /// recorded from another text than the index names it at; a module in
    /// `same_text` is no edit, and any other could not be read.
    Given(FxHashMap<String, Result<Option<Edit>, String>>),
}

/// What a run knows about the test files it was handed, and the texts its
/// modules were recorded from.
pub(crate) struct Files<'a> {
    /// Every test file the run announced, finished or not.
    pub ran: FxHashSet<String>,
    /// The files that ran to the end: their cases replace every case the index held for them.
    pub finished: FxHashSet<String>,
    pub present: Present,
    pub edits: Edits<'a>,
    /// The modules the run recorded from the text the index names them at.
    pub same_text: Option<FxHashSet<String>>,
    /// With a base, the modules the run, or a shard laid before it, recorded
    /// from the text the base names them at.
    pub same_before_text: Option<FxHashSet<String>>,
}

impl Files<'_> {
    /// Every file is kept: the caller already decided which cases stay.
    pub(crate) fn keeping(ran: FxHashSet<String>) -> Self {
        Files { finished: ran.clone(), ran, present: Present::All, edits: Edits::One, same_text: None, same_before_text: None }
    }

    pub(crate) fn edit(&self, file: &str) -> Result<Option<Cow<'_, Edit>>, String> {
        Ok(match &self.edits {
            Edits::One => Some(Cow::Borrowed(&NO_EDIT)),
            Edits::Asked(ask) => ask(file)?.map(Cow::Owned),
            Edits::Given(edits) => match edits.get(file) {
                Some(edit) => edit.as_ref().map_err(Clone::clone)?.as_ref().map(Cow::Borrowed),
                None => self.same_text.as_ref().is_some_and(|same| same.contains(file)).then_some(Cow::Borrowed(&NO_EDIT)),
            },
        })
    }

    fn present(&self, file: &str) -> bool {
        match &self.present {
            Present::All => true,
            Present::Under(root) => root.join(file).exists(),
            Present::Among(files) => files.contains(file),
        }
    }
}

pub(crate) struct Layers {
    /// The whole suite: the run laid over what the index held.
    pub merged: Vec<u8>,
    /// The id of every case `merged` holds, in its order.
    pub cases: Vec<String>,
    /// The cases the run recorded.
    pub last: Vec<String>,
    /// The cases of `last` whose files the run announced.
    pub announced: Vec<String>,
    /// The cases the run replaced, for the files it announced, as they stood before it.
    pub before: Option<Vec<u8>>,
    /// The file of every module `before` holds, in its order; empty without one.
    pub before_modules: Vec<String>,
    /// The modules of `before` cut at another text whose lines nothing could carry onto it.
    pub unlined: Vec<String>,
}

/// One case of an output, by where it is read from.
#[derive(Clone, Copy)]
pub(crate) enum Case {
    Held(usize),
    Run(usize),
}

/// The output's cases in their order, and where each input case stands among them.
pub(crate) struct Cases {
    pub order: Vec<Case>,
    /// Each held row's output case, -1 for a dropped one.
    pub held_at: Vec<i64>,
    /// Each run case's output case.
    pub run_at: Vec<usize>,
}

/// The output's cases: each held case whose file stays and that did not run
/// again, and each case of the run, a case run twice as its last run. Ordered
/// by file, name and id.
pub(crate) fn layered_cases(held: &Shard, run: &[Test], mut gone: impl FnMut(&str) -> bool) -> Result<Cases, String> {
    let mut dropped: FxHashMap<&str, bool> = FxHashMap::default();
    let gone_rows: Vec<bool> = held.tests.iter().map(|test| *dropped.entry(test.file.as_str()).or_insert_with(|| gone(&test.file))).collect();
    let mut by_id: FxHashMap<&str, usize> = FxHashMap::default();
    for (row, test) in held.tests.iter().enumerate() {
        if !gone_rows[row] {
            by_id.insert(&test.id, row);
        }
    }
    let mut run_by_id: FxHashMap<&str, usize> = FxHashMap::default();
    for (at, test) in run.iter().enumerate() {
        by_id.remove(test.id.as_str());
        run_by_id.insert(&test.id, at);
    }
    let test_of = |case: &Case| match case {
        Case::Held(row) => &held.tests[*row],
        Case::Run(at) => &run[*at],
    };
    let mut order: Vec<Case> = by_id.into_values().map(Case::Held).chain(run_by_id.into_values().map(Case::Run)).collect();
    order.sort_unstable_by(|left, right| {
        let (left, right) = (test_of(left), test_of(right));
        code_unit(&left.file, &right.file).then_with(|| code_unit(&left.name, &right.name)).then_with(|| code_unit(&left.id, &right.id))
    });
    let at: FxHashMap<&str, usize> = order.iter().enumerate().map(|(at, case)| (test_of(case).id.as_str(), at)).collect();
    let held_at = placed(held, &at, |row| gone_rows[row])?;
    let run_at = run.iter().map(|test| at[test.id.as_str()]).collect();
    Ok(Cases { order, held_at, run_at })
}

/// Where each held case stands among `at`, by its id, and -1 where `dropped`.
pub(crate) fn placed(held: &Shard, at: &FxHashMap<&str, usize>, dropped: impl Fn(usize) -> bool) -> Result<Vec<i64>, String> {
    held.tests
        .iter()
        .enumerate()
        .map(|(row, test)| {
            if dropped(row) {
                return Ok(-1);
            }
            at.get(test.id.as_str()).map(|to| *to as i64).ok_or_else(|| "a case index names a case it does not hold".to_owned())
        })
        .collect()
}

pub(crate) fn pool_of(shard: &Shard) -> Pool<'_> {
    Pool { bytes: &shard.set_bytes, offsets: &shard.set_offsets, tests: shard.tests.len() }
}

/// The last row of each file the index holds, in code-unit order of path.
pub(crate) fn module_rows(held: &Shard) -> Vec<usize> {
    let mut last: FxHashMap<&str, usize> = FxHashMap::default();
    for (row, module) in held.modules.iter().enumerate() {
        last.insert(&module.file, row);
    }
    let mut rows: Vec<usize> = last.into_values().collect();
    rows.sort_unstable_by(|left, right| code_unit(&held.modules[*left].file, &held.modules[*right].file));
    rows
}

/// The index in `bytes` opened at its cuts, or `None` where it is one this build does not lay over.
fn opened(bytes: &[u8]) -> Option<(Shard, Vec<Inventory>)> {
    read_held(bytes).ok().flatten()
}

/// `fresh` laid over `previous`. `base` is the index the before layer is cut
/// from when it is not `previous`; `before` says whether to cut it at all.
/// An index this cannot open is no index to lay over, and the run is written alone.
pub(crate) fn layer(previous: Option<&[u8]>, fresh: &[u8], files: &Files, base: Option<&[u8]>, before: bool) -> Result<Layers, String> {
    let (run, run_cuts) = opened(fresh).ok_or_else(|| "a case fold wrote an index it cannot open".to_owned())?;
    let last: Vec<String> = run.tests.iter().map(|test| test.id.clone()).collect();
    let announced = run.tests.iter().filter(|test| files.ran.contains(&test.file)).map(|test| test.id.clone()).collect();
    let Some((held, held_cuts)) = previous.and_then(opened) else {
        return Ok(Layers { merged: fresh.to_vec(), cases: last.clone(), last, announced, before: None, before_modules: Vec::new(), unlined: Vec::new() });
    };
    let cases = layered_cases(&held, &run.tests, |file| files.finished.contains(file) || !files.present(file))?;
    let count = cases.order.len();
    let mut sets = Translation::new(count);
    // Every case this run ran crossed the recorded text or was seen not to.
    let ran = sets.of(cases.run_at.iter().map(|at| *at as u32));
    let mut from_run = Translation::from(pool_of(&run), cases.run_at.iter().map(|at| *at as i64).collect());
    let lines = LaidLines::open(&held.lines, &run.lines, &cases.held_at, &cases.run_at, count)?;
    let mut layer = Layer { sets, from_held: Translation::from(pool_of(&held), cases.held_at.clone()), lines, ran };
    let run_modules = run_rows(&run);
    // The before layer reads only the two indexes and the run's files, so it is
    // cut on its own thread while the run is laid. A scoped thread, not rayon's
    // pool: an edit may be asked of the JavaScript thread this runs on.
    let (ran_files, same_text, same_before_text) = (&files.ran, files.same_text.as_ref(), files.same_before_text.as_ref());
    let (held_ref, held_cuts_ref, run_ref, run_cuts_ref, run_modules_ref) = (&held, &held_cuts, &run, &run_cuts, &run_modules);
    std::thread::scope(|scope| {
        let cutting = before.then(|| scope.spawn(move || cut_before(held_ref, held_cuts_ref, run_ref, run_cuts_ref, run_modules_ref, ran_files, same_text, same_before_text, base)));
        let mut laid: Vec<Laid> = Vec::new();
        for (row, recorded) in module_union(&held, &run, &run_modules) {
            let Some(at) = recorded else {
                let row = row.expect("a union entry names a side");
                if let Some(kept) = layer.carried_row(&held.modules[row], &held_cuts[row], false)? {
                    if let Some(lines) = layer.lines.as_mut() {
                        lines.carried(laid.len() as u32, row as u32)?;
                    }
                    laid.push(kept);
                }
                continue;
            };
            let (module, cut) = (&run.modules[at], &run_cuts[at]);
            let recorded = Recorded { file: &module.file, blocks: &cut.blocks, owners: cut.owners.as_deref(), called: &module.called, loaded: &module.loaded, overwritten: &module.overwritten };
            // The held cases land through the edit from the text they were cut at
            // to the text this run recorded: the regions it left alone, where it places them.
            let over = match row {
                Some(row) => {
                    let edit = files.edit(&module.file)?;
                    Some(Over { row: row as u32, module: &held.modules[row], pairing: landed_through(&held_cuts[row].blocks, &cut.blocks, cut.owners.as_deref(), edit.as_deref()) })
                }
                None => None,
            };
            let at_out = laid.len() as u32;
            laid.push(layer.laid_on(&recorded, Some(&mut from_run), over.as_ref(), at_out, at as u32)?);
        }
        let ids = cases.order.iter().map(|case| match case {
            Case::Held(row) => held.tests[*row].id.clone(),
            Case::Run(at) => run.tests[*at].id.clone(),
        });
        let ids: Vec<String> = ids.collect();
        let lines = layer.lines.take().map(LaidLines::finish);
        let owned = held_cuts.iter().any(|cut| cut.owners.is_some());
        let merged = write(&held, Some(&run), &cases.order, &laid, layer.sets, lines, owned)?;
        let (before, unlined) = match cutting {
            Some(cutting) => cutting.join().map_err(|_| "cutting the before layer panicked".to_owned())??,
            None => (None, Vec::new()),
        };
        let (before, before_modules) = before.map_or((None, Vec::new()), |(bytes, modules)| (Some(bytes), modules));
        Ok(Layers { merged, cases: ids, last, announced, before, before_modules, unlined })
    })
}

/// The before layer: the index the run is laid over, or `base`, cut to the
/// cases of the files the run announced, at the lines of the text each module
/// is named at.
#[allow(clippy::too_many_arguments)]
fn cut_before(
    held: &Shard,
    held_cuts: &[Inventory],
    run: &Shard,
    run_cuts: &[Inventory],
    run_modules: &FxHashMap<&str, usize>,
    ran: &FxHashSet<String>,
    same_text: Option<&FxHashSet<String>>,
    same_before_text: Option<&FxHashSet<String>>,
    base: Option<&[u8]>,
) -> Result<(Option<(Vec<u8>, Vec<String>)>, Vec<String>), String> {
    let mut unlined = Vec::new();
    let based = match base {
        Some(bytes) => match opened(bytes) {
            Some(opened) => Some(opened),
            None => return Ok((None, unlined)),
        },
        None => None,
    };
    let (cut, cut_cuts) = based.as_ref().map_or((held, held_cuts), |(shard, cuts)| (shard, cuts.as_slice()));
    let ran_files: FxHashSet<&str> = ran.iter().map(String::as_str).chain(run.tests.iter().map(|test| test.file.as_str())).collect();
    let held_rows = (based.is_some()).then(|| {
        let mut last: FxHashMap<&str, usize> = FxHashMap::default();
        for (row, module) in held.modules.iter().enumerate() {
            last.insert(&module.file, row);
        }
        last
    });
    let empty = FxHashSet::default();
    let recorded_of = |row: usize| -> Option<(&str, &[Block])> {
        let named = cut.modules[row].file.as_str();
        let Some(held_rows) = &held_rows else {
            let at = *run_modules.get(named)?;
            return same_text.is_some_and(|same| same.contains(named)).then(|| (named, run_cuts[at].blocks.as_slice()));
        };
        if !same_before_text.unwrap_or(&empty).contains(named) {
            return None;
        }
        // A landing's earlier shard may have recorded what this one did not; the
        // index it laid, the one this run is laid over, stands at those lines.
        match run_modules.get(named) {
            Some(at) => Some((named, run_cuts[*at].blocks.as_slice())),
            None => held_rows.get(named).map(|row| (named, held_cuts[*row].blocks.as_slice())),
        }
    };
    let laid = before_run(cut, cut_cuts, &ran_files, recorded_of, &mut unlined)?;
    Ok((Some(laid), unlined))
}

/// Each file the run recorded, at its last module of that file.
fn run_rows(run: &Shard) -> FxHashMap<&str, usize> {
    run.modules.iter().enumerate().map(|(at, module)| (module.file.as_str(), at)).collect()
}

/// The output's modules in code-unit order of path: each held row the run did
/// not record, and each module the run recorded with the held row of its path.
fn module_union(held: &Shard, run: &Shard, run_modules: &FxHashMap<&str, usize>) -> Vec<(Option<usize>, Option<usize>)> {
    let mut recorded: Vec<usize> = run_modules.values().copied().collect();
    recorded.sort_unstable_by(|left, right| code_unit(&run.modules[*left].file, &run.modules[*right].file));
    let rows = module_rows(held);
    let mut union = Vec::with_capacity(rows.len() + recorded.len());
    let mut next = recorded.into_iter().peekable();
    for row in rows {
        let file = &held.modules[row].file;
        while let Some(at) = next.next_if(|at| code_unit(&run.modules[*at].file, file) == Ordering::Less) {
            union.push((None, Some(at)));
        }
        match next.next_if(|at| run.modules[*at].file == *file) {
            Some(at) => union.push((Some(row), Some(at))),
            None => union.push((Some(row), None)),
        }
    }
    union.extend(next.map(|at| (None, Some(at))));
    union
}

/// `kept` and `retired` as one before: `retired` laid over `kept`, which the
/// earlier runs at one commit left. A deleted test file stays: its cases are
/// what the base had.
pub(crate) fn layer_before(kept: Option<&[u8]>, retired: Option<&[u8]>, ran: FxHashSet<String>) -> Result<Option<Vec<u8>>, String> {
    match (kept, retired) {
        (None, retired) => Ok(retired.map(<[u8]>::to_vec)),
        (Some(kept), None) => Ok(Some(kept.to_vec())),
        (Some(kept), Some(retired)) => layer(Some(kept), retired, &Files::keeping(ran), None, false).map(|layers| Some(layers.merged)),
    }
}

/// One cut a module's rows were landed at.
pub(crate) struct RowCut {
    pub file: String,
    pub blocks: Vec<Block>,
    pub owners: Vec<u32>,
}

/// The index in `bytes` with each module `cuts` names laid onto that cut, or
/// `None` when every one already stands at it, or the index is one this build
/// does not lay over. A module none of whose cases land or are overwritten
/// leaves the index; a held one already at its cut's lines is carried as it is.
/// `edit` is asked only of a held module laid onto another cut.
pub(crate) fn follow_cuts(bytes: &[u8], cuts: &[RowCut], edit: &dyn Fn(&str) -> Result<Option<Edit>, String>) -> Result<Option<Vec<u8>>, String> {
    let Some((held, held_cuts)) = opened(bytes) else { return Ok(None) };
    let cut_at: FxHashMap<&str, &RowCut> = cuts.iter().map(|cut| (cut.file.as_str(), cut)).collect();
    let rows = module_rows(&held);
    // FIXME: lines are the only evidence a held module already stands at its
    // rows. A body edited in place moves no line, so its cases stay on the
    // edited region. See the todo in `land-carried-index.test.ts`.
    let onto: FxHashMap<usize, &RowCut> = rows
        .iter()
        .filter_map(|row| cut_at.get(held.modules[*row].file.as_str()).filter(|cut| !cut_alike(&held_cuts[*row].blocks, &cut.blocks)).map(|cut| (*row, *cut)))
        .collect();
    if onto.is_empty() {
        return Ok(None);
    }
    let cases = layered_cases(&held, &[], |_| false)?;
    let count = cases.order.len();
    let lines = LaidLines::open(&held.lines, &[], &cases.held_at, &[], count)?;
    let mut layer = Layer { sets: Translation::new(count), from_held: Translation::from(pool_of(&held), cases.held_at.clone()), lines, ran: EMPTY };
    let mut laid: Vec<Laid> = Vec::new();
    for row in rows {
        let module = &held.modules[row];
        let Some(cut) = onto.get(&row) else {
            if let Some(kept) = layer.carried_row(module, &held_cuts[row], false)? {
                if let Some(lines) = layer.lines.as_mut() {
                    lines.carried(laid.len() as u32, row as u32)?;
                }
                laid.push(kept);
            }
            continue;
        };
        // FIXME: a region born in the re-cut whose owners recorded none landed
        // is laid with no case, inside a module that stays: absent read as no
        // test, where the rows widen from the region around it. Nothing ran
        // over the new text here, so the empty set is pure absence.
        // A region whose cases land names their lines as it is laid, so a
        // module that keeps none named nothing, and leaving it out shifts nobody.
        let (called, loaded) = (vec![EMPTY; cut.blocks.len()], vec![false; cut.blocks.len()]);
        let recorded = Recorded { file: &module.file, blocks: &cut.blocks, owners: Some(&cut.owners), called: &called, loaded: &loaded, overwritten: &[] };
        let edit = edit(&module.file)?;
        let over = Over { row: row as u32, module, pairing: landed_through(&held_cuts[row].blocks, &cut.blocks, Some(&cut.owners), edit.as_ref()) };
        let at = laid.len() as u32;
        let followed = layer.laid_on(&recorded, None, Some(&over), at, 0)?;
        if followed.entered() {
            laid.push(followed);
        }
    }
    let lines = layer.lines.take().map(LaidLines::finish);
    let owned = held_cuts.iter().any(|cut| cut.owners.is_some());
    write(&held, None, &cases.order, &laid, layer.sets, lines, owned).map(Some)
}

/// The output written: each case as its side held it, without the runner and
/// project a layered index does not carry, and every module as laid.
/// `held_owned` says the held index names its regions' owners.
pub(crate) fn write(held: &Shard, run: Option<&Shard>, order: &[Case], laid: &[Laid], sets: Translation, lines: Option<Vec<Vec<u8>>>, held_owned: bool) -> Result<Vec<u8>, String> {
    let mut tests = Vec::with_capacity(order.len());
    let mut extras = CaseExtras { durations: Vec::new(), limits: Vec::new(), times: Vec::new(), lines: lines.unwrap_or_default(), always_timed: true };
    for case in order {
        let (shard, at) = match case {
            Case::Held(row) => (held, *row),
            Case::Run(at) => (run.expect("a run case is laid from a run"), *at),
        };
        let mut test = shard.tests[at].clone();
        test.runner = None;
        test.project = None;
        tests.push(test);
        extras.durations.push(shard.durations[at]);
        // Zero is a runner's word for no limit; a held case keeps the word it was stored with.
        extras.limits.push(match case {
            Case::Held(_) => shard.limits[at],
            Case::Run(_) => shard.limits[at].filter(|limit| *limit != 0),
        });
        extras.times.push(shard.times[at].clone());
    }
    // An owner is carried where either side recorded one; a region neither did names none.
    let owned = held_owned || laid.iter().any(|module| module.module.owners.is_some());
    let modules: Vec<_> = laid
        .iter()
        .map(|module| {
            let mut written = module.module.clone();
            if owned && written.owners.is_none() {
                written.owners = Some(vec![NO_OWNER; written.blocks.len()]);
            }
            written
        })
        .collect();
    let encoded: Vec<EncodedModule<'_>> = modules
        .iter()
        .zip(laid)
        .map(|(module, laid)| EncodedModule { module, called: &laid.called, loaded: &laid.loaded, overwritten: &laid.overwritten })
        .collect();
    journey_format::encode(&tests, &extras, &encoded, &mut sets.into_pool(), None)
}

#[cfg(test)]
#[path = "case_layer_tests.rs"]
mod tests;
