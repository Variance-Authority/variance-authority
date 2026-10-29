//! The one fold of case indexes: any number of shards' cases, regions and sets
//! as the index one run of every shard would have written. `journeys stitch`
//! and `combine` both fold through it. The parts of one case that
//! `journeys stitch` joins each hold the lines of the regions they crossed, and
//! the fold joins them over those regions.
//!
//! The output is a function of the shards' contents, not of their order: cases
//! are numbered by their keys, a file's cuts are reconciled in the order of
//! their contents, and every set is written ascending. A caller that hands the
//! shards in a canonical order also makes the fold's choices among equal
//! claims — which call site a precondition is named at — independent of it.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};

use rustc_hash::FxHashMap;

use crate::case_id::{self, CaseIds};
use crate::case_lines;
use crate::case_said;
use crate::case_shard::{self, Inventory, Shard};
use crate::crossing_sets::{self, SetPool};
use crate::journey_format::{self, CaseExtras, EncodedModule, Gaps};
use crate::journey_journal::{self, Test};
use crate::journey_record::{self, Block, Module};
use crate::order;

pub(crate) struct Folded {
    pub bytes: Vec<u8>,
    pub tests: u32,
    pub modules: u32,
    pub crossings: u64,
    /// Files two shards numbered differently, read at the regions both hold.
    pub renumbered: Vec<String>,
    pub gaps: Option<Gaps>,
    /// Per shard, the id each of its cases is called by in the fold, where it
    /// is called by another than its own.
    pub renamed: Vec<HashMap<String, String>>,
    /// The id of every case in the fold.
    pub ids: Vec<String>,
}

type Key = (String, String, String, Option<String>);

/// Fold `shards`, whose cuts `case_shard::read_shard` gathered in `inventories`.
/// `always_timed` writes the duration column where no case was timed, as a
/// record's case index carries it.
pub(crate) fn fold(mut shards: Vec<Shard>, inventories: HashMap<String, Vec<Inventory>>, always_timed: bool) -> Result<Folded, String> {
    if shards.is_empty() {
        return Err("no case indexes were named".to_owned());
    }
    // A case id numbers a case among the cases its own shard ran, so a shard
    // that ran only the second of two cases sharing a name calls it by the
    // first one's id. Where every shard carries the runner's ids, a case is
    // joined by its own and the union is numbered again, as one fold over every
    // shard's frames numbers it; otherwise it is joined by case id.
    let by_runner = shards.iter().all(|shard| shard.tests.iter().all(|test| test.runner.is_some()));
    let key = |test: &Test| -> Key {
        match &test.runner {
            Some(runner) if by_runner => (test.file.clone(), test.name.clone(), runner.clone(), test.project.clone()),
            _ => (test.id.clone(), String::new(), String::new(), None),
        }
    };
    let mut tests_by_key: FxHashMap<Key, Test> = FxHashMap::default();
    for test in shards.iter().flat_map(|shard| &shard.tests) {
        if let Some(before) = tests_by_key.get_mut(&key(test)) {
            if before.file != test.file || before.name != test.name || before.project != test.project {
                return Err(format!("case id {:?} names two cases", test.id));
            }
            before.settled = journey_journal::settled_across(before.settled, test.settled);
            before.heard = case_said::join(before.heard.take(), test.heard.clone());
        } else {
            tests_by_key.insert(key(test), test.clone());
        }
    }

    let mut tests: Vec<Test> = tests_by_key.into_values().collect();
    if by_runner {
        tests.sort_by(|left, right| {
            let runner = |test: &Test| test.runner.clone().unwrap_or_default();
            case_id::order((&left.file, &left.name, left.project.as_deref(), &runner(left)),
                (&right.file, &right.name, right.project.as_deref(), &runner(right)))
        });
        let mut ids = CaseIds::default();
        for test in &mut tests {
            test.id = ids.next(&test.file, &test.name, test.project.as_deref())?;
        }
    }
    // Ids are unique by now, so the order is total and needs no stable sort.
    tests.sort_unstable_by(|left, right| {
        order::code_unit(&left.id, &right.id)
            .then_with(|| order::code_unit(&left.file, &right.file))
            .then_with(|| order::code_unit(&left.name, &right.name))
    });
    let test_at: FxHashMap<Key, u32> = tests.iter().enumerate().map(|(at, test)| (key(test), at as u32)).collect();
    let mut renamed = Vec::with_capacity(shards.len());
    for shard in &mut shards {
        shard.local_to_global = shard.tests.iter().map(|test| test_at[&key(test)]).collect();
        renamed.push(
            shard.tests.iter().zip(&shard.local_to_global)
                .filter(|(test, global)| test.id != tests[**global as usize].id)
                .map(|(test, global)| (test.id.clone(), tests[*global as usize].id.clone()))
                .collect(),
        );
    }

    let mut shapes: Vec<(String, Vec<Inventory>)> = inventories.into_iter().collect();
    shapes.sort_by(|left, right| order::code_unit(&left.0, &right.0));
    let mut modules = Vec::with_capacity(shapes.len());
    let mut landings: Vec<Vec<Vec<u32>>> = Vec::with_capacity(shapes.len());
    // Per file, where each of the inventories read stands once they are in content order.
    let mut placed: HashMap<String, Vec<usize>> = HashMap::new();
    let mut renumbered = Vec::new();
    for (file, held) in shapes {
        let mut ranked: Vec<usize> = (0..held.len()).collect();
        ranked.sort_by(|left, right| inventory_order(&held[*left], &held[*right]));
        let mut rank = vec![0; held.len()];
        for (at, from) in ranked.iter().enumerate() {
            rank[*from] = at;
        }
        let mut slots: Vec<Option<Inventory>> = held.into_iter().map(Some).collect();
        let held: Vec<Inventory> = ranked.iter().map(|from| slots[*from].take().expect("each inventory is ranked once")).collect();
        // Owners are positions among the module's own regions, so one cut
        // carries them as they are and a reconciled one reads them again.
        let (blocks, owners, lands) = if held.len() == 1 {
            let only = held.into_iter().next().expect("one inventory");
            (only.blocks, only.owners, Vec::new())
        } else {
            let cut: Vec<&[Block]> = held.iter().map(|inventory| inventory.blocks.as_slice()).collect();
            let owned: Vec<Option<&[u32]>> = held.iter().map(|inventory| inventory.owners.as_deref()).collect();
            let reconciled = journey_record::reconcile(&cut, &owned);
            renumbered.push(file.clone());
            (reconciled.blocks, reconciled.owners, reconciled.lands)
        };
        placed.insert(file.clone(), rank);
        modules.push(Module { id: file.clone(), file, blocks, owners });
        landings.push(lands);
    }
    let rows: HashMap<&str, usize> = modules.iter().enumerate().map(|(at, module)| (module.file.as_str(), at)).collect();
    let mut extras = CaseExtras { durations: vec![None; tests.len()], lines: vec![Vec::new(); tests.len()], always_timed };
    // The parts of one case each hold the lines of the regions they crossed, so
    // a case two shards hold at different lines is joined over its crossings
    // once the sets are read: `joining` names each holding by shard and case.
    let mut holder: Vec<Option<(usize, u32)>> = vec![None; tests.len()];
    let mut joining: FxHashMap<(usize, u32), usize> = FxHashMap::default();
    let mut parts: Vec<(u32, Vec<u8>, Vec<(u32, u32)>)> = Vec::new();
    for (at, shard) in shards.iter_mut().enumerate() {
        for module in &mut shard.modules {
            module.inventory = placed[&module.file][module.inventory];
        }
        // A case's lines name its regions by their order in the module, so a
        // module the fold renumbered has no row its lines stand on.
        let row_of: Vec<Result<u32, &str>> = shard.modules.iter()
            .map(|module| {
                let row = rows[module.file.as_str()];
                if landings[row].is_empty() { Ok(row as u32) } else { Err(module.file.as_str()) }
            })
            .collect();
        for (local, global) in shard.local_to_global.iter().enumerate() {
            let global = *global as usize;
            if let Some(duration) = shard.durations[local] {
                let held = &mut extras.durations[global];
                *held = Some(held.map_or(duration, |known| known.max(duration)));
            }
            if shard.lines[local].is_empty() {
                continue;
            }
            let lines = case_shard::remap_lines(&shard.lines[local], &row_of).map_err(|error| {
                format!(
                    "{}: case {:?}: {error}, so they name regions the combined record does not hold, and the shards are not combined. Shards combine when one build recorded every one, so each cuts the file the same way.",
                    shard.name, tests[global].id
                )
            })?;
            let held = &mut extras.lines[global];
            if held.is_empty() || *held == lines {
                *held = lines;
                holder[global] = Some((at, local as u32));
                continue;
            }
            if let Some(first) = holder[global].take() {
                joining.insert(first, parts.len());
                parts.push((global as u32, held.clone(), Vec::new()));
            }
            joining.insert((at, local as u32), parts.len());
            parts.push((global as u32, lines, Vec::new()));
        }
        shard.modules.sort_by(|left, right| order::code_unit(&left.file, &right.file));
    }
    let mut called_by_module = Vec::with_capacity(modules.len());
    let mut loaded_by_module = Vec::with_capacity(modules.len());
    let mut overwritten_by_module = Vec::with_capacity(modules.len());
    let mut sets = SetPool::new(tests.len());
    let mut crossings = 0_u64;
    for (row, (module, lands)) in modules.iter().zip(&landings).enumerate() {
        let mut called_by_block = vec![Vec::new(); module.blocks.len()];
        let mut overwritten_by_block = vec![Vec::new(); module.blocks.len()];
        let mut loaded = vec![false; module.blocks.len()];
        for (from, shard) in shards.iter().enumerate() {
            let Ok(at) = shard.modules.binary_search_by(|candidate| order::code_unit(&candidate.file, &module.file)) else {
                continue;
            };
            let held = &shard.modules[at];
            let landed = lands.get(held.inventory);
            for own in 0..held.called.len() {
                let block = landed.map_or(own, |landed| landed[own] as usize);
                append_members(shard, held.called[own], &mut called_by_block[block], |local| {
                    if let Some(part) = joining.get(&(from, local)) {
                        parts[*part].2.push((row as u32, block as u32));
                    }
                })?;
                loaded[block] |= held.loaded[own];
                if let Some(set) = held.overwritten.get(own) {
                    append_members(shard, *set, &mut overwritten_by_block[block], |_| {})?;
                }
            }
        }
        let mut called_ids = Vec::with_capacity(module.blocks.len());
        let mut overwritten_ids = Vec::with_capacity(module.blocks.len());
        for (mut called, mut overwritten) in called_by_block.into_iter().zip(overwritten_by_block) {
            called.sort_unstable();
            called.dedup();
            // A case is one shard's: combine refuses a test file two shards
            // hold, a stitch's journals flag no case, and the before layers
            // carry one earlier index alike. An input that names a case both
            // ways at a region is read by its called set; the two stay disjoint.
            overwritten.retain(|test| called.binary_search(test).is_err());
            overwritten.sort_unstable();
            overwritten.dedup();
            crossings += called.len() as u64;
            called_ids.push(sets.intern(&called));
            overwritten_ids.push(overwritten);
        }
        called_by_module.push(called_ids);
        loaded_by_module.push(loaded);
        // Written only for a module that holds an overwritten case, so a fold
        // of shards no layering cut writes the bytes it did before the column.
        let held = overwritten_ids.iter().any(|overwritten| !overwritten.is_empty());
        overwritten_by_module.push(if held { overwritten_ids.iter().map(|overwritten| sets.intern(overwritten)).collect() } else { Vec::new() });
    }
    join_lines(&tests, parts, &mut extras.lines)?;
    let encoded: Vec<EncodedModule<'_>> = modules
        .iter()
        .enumerate()
        .map(|(at, module)| EncodedModule { module, called: &called_by_module[at], loaded: &loaded_by_module[at], overwritten: &overwritten_by_module[at] })
        .collect();
    let gaps = union_gaps(&shards);
    let bytes = journey_format::encode(&tests, &extras, &encoded, &mut sets, gaps.as_ref())?;
    Ok(Folded {
        ids: tests.iter().map(|test| test.id.clone()).collect(),
        bytes,
        tests: tests.len() as u32,
        modules: modules.len() as u32,
        crossings,
        renumbered,
        gaps,
        renamed,
    })
}

/// Two cuts of one file in the order of their contents: region by region, then
/// the owners they name, a cut that names none first.
fn inventory_order(left: &Inventory, right: &Inventory) -> Ordering {
    let block = |left: &Block, right: &Block| {
        order::code_unit(&left.kind, &right.kind)
            .then_with(|| order::code_unit(&left.name, &right.name))
            .then_with(|| order::code_unit(&left.path, &right.path))
            .then_with(|| left.start_line.cmp(&right.start_line))
            .then_with(|| left.end_line.cmp(&right.end_line))
            .then_with(|| left.source.cmp(&right.source))
    };
    left.blocks.iter().zip(&right.blocks)
        .map(|(left, right)| block(left, right))
        .find(|ordering| ordering.is_ne())
        .unwrap_or_else(|| left.blocks.len().cmp(&right.blocks.len()))
        .then_with(|| left.owners.cmp(&right.owners))
}

/// Every shard's gaps together, or none when one shard carries none: a shard
/// that was not asked cannot be read as one that found nothing.
fn union_gaps(shards: &[Shard]) -> Option<Gaps> {
    let every: Vec<&Gaps> = shards.iter().map(|shard| shard.gaps.as_ref()).collect::<Option<_>>()?;
    let joined = |pick: fn(&Gaps) -> Option<&Vec<String>>| -> Option<Vec<String>> {
        let mut names: Vec<String> = every.iter().map(|gaps| pick(gaps)).collect::<Option<Vec<_>>>()?.into_iter().flatten().cloned().collect();
        names.sort_unstable_by(|left, right| order::code_unit(left, right));
        names.dedup();
        Some(names)
    };
    Some(Gaps {
        unrecorded: joined(|gaps| Some(&gaps.unrecorded))?,
        unclaimed: joined(|gaps| Some(&gaps.unclaimed))?,
        heads: joined(|gaps| Some(&gaps.heads))?,
        silent: joined(|gaps| gaps.silent.as_ref()),
    })
}

fn append_members(shard: &Shard, set: u32, out: &mut Vec<u32>, mut each: impl FnMut(u32)) -> Result<(), String> {
    let held = crossing_sets::set_slice(&shard.set_bytes, &shard.set_offsets, set)?;
    for local in crossing_sets::decode_set(held, shard.tests.len())? {
        out.push(shard.local_to_global[local as usize]);
        each(local);
    }
    Ok(())
}

/// The lines of each case two shards hold at different lines, joined over the
/// regions each holding crossed (`case_lines`). A holding whose sets say it
/// crossed a region its lines hold no value for is refused: its record does
/// not agree with itself.
fn join_lines(tests: &[Test], parts: Vec<(u32, Vec<u8>, Vec<(u32, u32)>)>, lines: &mut [Vec<u8>]) -> Result<(), String> {
    let mut joined: BTreeMap<u32, BTreeMap<(u32, u32), u64>> = BTreeMap::new();
    for (global, bytes, crossed) in parts {
        let id = &tests[global as usize].id;
        let held = case_lines::decode(&bytes).map_err(|error| format!("case {id:?}: {error}"))?
            .expect("a joined holding recorded its lines");
        let values = joined.entry(global).or_default();
        for (row, block) in crossed {
            let value = case_lines::value_at(&held, row, block)
                .ok_or_else(|| format!("case {id:?} crossed a region its lines hold no value for, so its record does not agree with itself"))?;
            values.entry((row, block)).and_modify(|kept| *kept = case_lines::earlier(*kept, value)).or_insert(value);
        }
    }
    for (global, values) in joined {
        lines[global as usize] = case_lines::encode(&values);
    }
    Ok(())
}

#[cfg(test)]
#[path = "case_fold_tests.rs"]
mod tests;
