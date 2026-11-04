//! `layRecords`: one record's coverage laid over the record already at the
//! target, read and written column to column. A runner's teardown lays its run
//! over the record it found, and a landing lays a combined record over the one
//! at `--into`; both lay through here.
//!
//! The rule, `current` over `previous`:
//!
//! - Under other probes, the lay is refused: one build records under one set
//!   of probes, so a record under others is another build's.
//! - A test `current` recorded complete retires its previous crossings, and so
//!   does one it recorded incomplete under other preconditions; an incomplete
//!   one under the same preconditions keeps them.
//! - Each module row of `current` claims a row of `previous` with its path:
//!   the first unclaimed one built from the same text, else the first
//!   unclaimed one. A previous region carries its crossings onto the region of
//!   the claiming row at its address (name, path and repeat) when both rows
//!   were measured, the kinds agree, and the text is the same or the cut
//!   seated its counters where the old one did. A region it has no carried
//!   crossings for reads them off the nearest region around it that has.
//! - Rows nobody claimed are carried, less retired crossings; one whose text
//!   moved on disk is cut again in the text it has now
//!   ([`crate::record_coverage_recut`]).
//! - A previous test that `current` did not record, and whose crossings were
//!   lost or land on a region an edit reached, is no longer complete. An edit
//!   reaches every region whose text moved, unless the caller's reading of it
//!   says otherwise: `none` reaches nothing, `bodies` every region but a
//!   module's own.
//!
//! The output is a function of the records' contents only: read and written in
//! one pass, in code-unit order, rows of one path re-recorded first, through
//! the writer the fold of shards writes with.

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::journey_columns::{self, Column};
use crate::order;
use crate::record_coverage::{self, Coverage, Text};
use crate::crossing_sets::{self, SetPool};
use crate::record_coverage_columns::{Columns, Region};
use crate::record_coverage_dictionary::{Merged, Spelled};
use crate::record_coverage_address::addressed_alike;
use crate::record_coverage_recut::{is_top, reaches, recut, write_cut, Readings, Recut};
use crate::record_layout::LAYOUT;

/// What a lay reads besides the two records.
#[napi(object)]
#[derive(Default)]
pub struct LayOptions {
    /// The modules whose text moved on disk, cut again in the text they have
    /// now: a record under `current`'s probes, with no tests.
    pub recut: Option<Buffer>,
    /// Per edit, keyed `path\0from\0to` by the digests of the two texts, what
    /// it reached: `none`, `bodies` or `load`. An edit with no reading reaches
    /// every region whose text moved.
    pub readings: Option<std::collections::HashMap<String, String>>,
}

/// Lay `current` over `previous`: the coverage record that lands, or `None`
/// where `previous` measured nothing and `current` lands as it is. A `previous`
/// this build cannot read, or one under other probes, is refused with the reason.
#[napi(catch_unwind)]
pub fn lay_records(previous: Buffer, current: Buffer, options: Option<LayOptions>) -> napi::Result<Option<Buffer>> {
    laid(&previous, &current, options.unwrap_or_default()).map(|bytes| bytes.map(Buffer::from)).map_err(napi::Error::from_reason)
}

fn laid(previous: &[u8], current: &[u8], options: LayOptions) -> Result<Option<Vec<u8>>, String> {
    let read = |bytes: &[u8]| record_coverage::read(bytes).map(|record| record.coverage);
    // A record that measured nothing holds nothing to lay over. The records
    // are let go before the output is encoded.
    let columns = {
        let Some(held) = read(previous)? else { return Ok(None) };
        let laid = read(current)?.ok_or("the record laid holds no coverage")?;
        let recut = options.recut.as_deref().map(read).transpose()?.flatten();
        lay(held, laid, recut, &options.readings.unwrap_or_default())?
    };
    journey_columns::encode(columns, LAYOUT.coverage.format).map(Some)
}

/// `current` laid over `previous`, as coverage sections.
fn lay(previous: Coverage, current: Coverage, recut: Option<Coverage>, readings: &Readings) -> Result<Vec<Column>, String> {
    let Written { merged, mut out, pool, instrumentation, commit } = written(&previous, &current, recut.as_ref(), readings)?;
    // Every row is written, and the dictionaries are all that is read from here.
    let strings: Vec<_> = [Some(previous), Some(current), recut].into_iter().flatten().map(Coverage::into_strings).collect();
    let texts = strings.iter().map(|strings| strings.text()).collect::<Result<Vec<_>, _>>()?;
    let mut used = vec![false; merged.len()];
    used[instrumentation as usize] = true;
    commit.into_iter().for_each(|commit| used[commit as usize] = true);
    out.name_in(&mut used);
    let Spelled { blob, offsets, rank } = merged.spelled(&texts, &used);
    drop(used);
    out.renumber(&rank);
    out.encoded(blob, offsets, rank[instrumentation as usize], commit.map(|commit| rank[commit as usize]), &pool)
}

/// The rows of `current` laid over `previous`, strings as ranks of both dictionaries at once.
struct Written {
    merged: Merged,
    out: Columns,
    pool: SetPool,
    instrumentation: u32,
    commit: Option<u32>,
}

fn written(previous: &Coverage, current: &Coverage, fresh: Option<&Coverage>, readings: &Readings) -> Result<Written, String> {
    let (ps, cs) = (previous.text()?, current.text()?);
    let fs = fresh.map(Coverage::text).transpose()?;
    let (before, now) = (ps.at(previous.instrumentation), cs.at(current.instrumentation));
    if before != now {
        return Err(format!(
            "the record was written under the probes `{before}` and the run under `{now}`, so the run cannot be laid over it: one build records under one set of probes"
        ));
    }
    let rerecorded: FxHashMap<&str, usize> = (0..current.tests()).map(|test| (cs.at(current.test_path[test]), test)).collect();
    let held: FxHashMap<&str, usize> = (0..previous.tests()).map(|test| (ps.at(previous.test_path[test]), test)).collect();
    let retired: Vec<bool> = (0..current.tests())
        .map(|test| {
            current.test_complete[test] == 1
                || held.get(cs.at(current.test_path[test])).is_some_and(|before| {
                    preconditions(previous, ps, *before) != preconditions(current, cs, test)
                })
        })
        .collect();

    // The universe: the tests `current` recorded, then the previous tests it did not.
    let mut carried = 0;
    let mut again = vec![false; previous.tests()];
    let universe: Vec<Option<u32>> = (0..previous.tests())
        .map(|test| match rerecorded.get(ps.at(previous.test_path[test])) {
            Some(now) => {
                again[test] = true;
                (!retired[*now]).then_some(*now as u32)
            }
            None => {
                carried += 1;
                Some((current.tests() + carried - 1) as u32)
            }
        })
        .collect();

    // Strings are ranks in both records' dictionaries at once, so none is
    // copied; tests are numbered as the output numbers them, by path.
    let merged = Merged::new(&[Some(ps), Some(cs), fs].into_iter().flatten().collect::<Vec<_>>());
    let (before, now) = (&merged.ranks[0], &merged.ranks[1]);
    let cut = fresh.zip(fs).map(|(fresh, fs)| {
        let rows: FxHashMap<&str, usize> = (0..fresh.modules()).map(|module| (fs.at(fresh.module_path[module]), module)).collect();
        (fresh, fs, &merged.ranks[2], rows)
    });
    let mut written: Vec<(u32, Row)> = (0..current.tests()).map(|test| (now[current.test_path[test] as usize], Row::Current(test))).collect();
    written.extend((0..previous.tests()).filter(|test| !again[*test]).map(|test| (before[previous.test_path[test] as usize], Row::Previous(test))));
    written.sort_unstable_by_key(|(path, _)| *path);
    let mut numbered = vec![0_u32; current.tests() + carried];
    for (at, (_, row)) in written.iter().enumerate() {
        numbered[match row {
            Row::Current(test) => *test,
            Row::Previous(test) => universe[*test].map_or(0, |id| id as usize),
        }] = at as u32;
    }
    let universe: Vec<Option<u32>> = universe.into_iter().map(|id| id.map(|id| numbered[id as usize])).collect();
    let now_id = |test: u32| numbered[test as usize];

    // Every previous row by path, rows of one path in row order; each row of
    // `current` claims one before anything is written.
    let mut by_path: Vec<u32> = (0..previous.modules() as u32).collect();
    by_path.sort_by_key(|row| before[previous.module_path[*row as usize] as usize]);
    let mut claimed = vec![false; previous.modules()];
    let claims: Vec<Option<usize>> = (0..current.modules())
        .map(|module| {
            let (path, source) = (now[current.module_path[module] as usize], now[current.module_source[module] as usize]);
            let from = by_path.partition_point(|row| before[previous.module_path[*row as usize] as usize] < path);
            let rows = by_path[from..].iter().map(|row| *row as usize).take_while(|row| before[previous.module_path[*row] as usize] == path);
            let mut rows = rows.filter(|row| !claimed[*row]).peekable();
            let first = rows.peek().copied();
            let claim = rows.find(|row| before[previous.module_source[*row] as usize] == source).or(first);
            if let Some(row) = claim {
                claimed[row] = true;
            }
            claim
        })
        .collect();

    // Modules by path, the rows of `current` before the previous rows nobody claimed.
    let mut rows: Vec<(u32, Row)> = (0..current.modules()).map(|module| (now[current.module_path[module] as usize], Row::Current(module))).collect();
    rows.extend((0..previous.modules()).filter(|row| !claimed[*row]).map(|row| (before[previous.module_path[row] as usize], Row::Previous(row))));
    rows.sort_by_key(|(path, _)| *path);
    let blocks: usize = rows.iter().map(|(_, row)| match row {
        Row::Current(module) => current.blocks(*module).len(),
        Row::Previous(row) => previous.blocks(*row).len(),
    }).sum();
    let inputs = current.precondition_name.len() + previous.precondition_name.len();
    let mut out = Columns::sized(current.tests() + carried, inputs, rows.len(), blocks);

    let previous_members = |set: u32| crossing_sets::decode_set(crossing_sets::set_slice(&previous.set_bytes, &previous.set_offsets, set)?, previous.tests());
    let current_members = |set: u32| crossing_sets::decode_set(crossing_sets::set_slice(&current.set_bytes, &current.set_offsets, set)?, current.tests());
    let mut stale = vec![false; previous.tests()];
    let mut staled = vec![false; previous.set_offsets.len() - 1];
    let mut lose = |set: u32, stale: &mut [bool]| -> Result<(), String> {
        if !std::mem::replace(&mut staled[set as usize], true) {
            for test in previous_members(set)? {
                stale[test as usize] |= !again[test as usize];
            }
        }
        Ok(())
    };
    // A region of `row` with no place in the new cut owes a run to each test
    // it held that the region around it, the nearest one `taken` placed, does
    // not hold: that region kept what the test ran there, and nothing else did.
    let owe_unplaced = |row: usize, taken: &FxHashSet<usize>, unplaced: &[usize], stale: &mut [bool]| -> Result<(), String> {
        let blocks = previous.blocks(row);
        let own: Vec<Option<usize>> = blocks.clone().map(|block| taken.contains(&block).then_some(block)).collect();
        let kept = around(previous, blocks.clone(), &own);
        for held in unplaced {
            let around = kept[held - blocks.start].map(|kept| previous_members(previous.block_set[kept])).transpose()?.unwrap_or_default();
            for test in previous_members(previous.block_set[*held])? {
                stale[test as usize] |= !around.contains(&test) && !again[test as usize];
            }
        }
        Ok(())
    };
    // Sets are interned as they are written, so their ids follow the output.
    let mut pool = SetPool::new(current.tests() + carried);
    let mut unions: FxHashMap<(u32, u32), u32> = FxHashMap::default();
    let mut union = |pool: &mut SetPool, held: Option<u32>, set: u32| -> Result<u32, String> {
        let key = (held.unwrap_or(u32::MAX), set);
        if let Some(id) = unions.get(&key) {
            return Ok(*id);
        }
        let mut members: Vec<u32> = held.map(previous_members).transpose()?.unwrap_or_default().into_iter().filter_map(|test| universe[test as usize]).collect();
        members.extend(current_members(set)?.into_iter().map(now_id));
        members.sort_unstable();
        members.dedup();
        let id = pool.intern(&members);
        unions.insert(key, id);
        Ok(id)
    };
    let mut remapped = vec![u32::MAX; previous.set_offsets.len() - 1];
    let mut remap = |pool: &mut SetPool, set: u32| -> Result<u32, String> {
        if remapped[set as usize] == u32::MAX {
            let mut members: Vec<u32> = previous_members(set)?.into_iter().filter_map(|test| universe[test as usize]).collect();
            members.sort_unstable();
            remapped[set as usize] = pool.intern(&members);
        }
        Ok(remapped[set as usize])
    };

    for (path, row) in rows {
        let module = match row {
            Row::Current(module) => module,
            // A row nobody claimed: cut again where its text moved, else as it
            // is, less retired crossings.
            Row::Previous(row) => {
                let file = ps.at(previous.module_path[row]);
                if let Some((fresh, fs, again_ranks, rows)) = &cut {
                    if let Some(module) = rows.get(file).copied() {
                        let (from, to) = (ps.at(previous.module_source[row]), fs.at(fresh.module_source[module]));
                        match recut((previous, ps), row, (fresh, *fs), module, |kind| reaches(readings, file, from, to, kind)) {
                            Recut::Kept => {}
                            Recut::Mislaid => {
                                for block in previous.blocks(row) {
                                    lose(previous.block_set[block], &mut stale)?;
                                }
                            }
                            Recut::Cut { from, owed, .. } => {
                                for held in owed {
                                    lose(previous.block_set[held], &mut stale)?;
                                }
                                // A crosser the new text holds no region for has nowhere a diff could reach it.
                                let taken: FxHashSet<usize> = from.iter().flatten().copied().collect();
                                let unplaced: Vec<usize> = previous.blocks(row).filter(|held| !taken.contains(held)).collect();
                                owe_unplaced(row, &taken, &unplaced, &mut stale)?;
                                write_cut(&mut out, path, (fresh, again_ranks), module, from, |held, loaded| match held {
                                    Some(held) => remap(&mut pool, if loaded { previous.block_loaded_set[held] } else { previous.block_set[held] }),
                                    None => Ok(pool.intern(&[])),
                                })?;
                                continue;
                            }
                        }
                    }
                }
                out.module(path, before[previous.module_source[row] as usize], previous.blob_in(row, |id| before[id as usize]), previous.module_instrumented[row] == 1);
                for block in previous.blocks(row) {
                    out.region(Region {
                        ordinal: previous.block_ordinal[block],
                        kind: previous.block_kind[block],
                        source: previous.block_source[block],
                        owner: previous.block_owner[block],
                        digest: before[previous.block_digest[block] as usize],
                        name: before[previous.block_name[block] as usize],
                        path: before[previous.block_path[block] as usize],
                        start: previous.block_start[block],
                        end: previous.block_end[block],
                        called: remap(&mut pool, previous.block_set[block])?,
                        loaded: remap(&mut pool, previous.block_loaded_set[block])?,
                    });
                }
                continue;
            }
        };
        let source = now[current.module_source[module] as usize];
        let blocks = current.blocks(module);
        let mut surviving: Vec<Option<usize>> = vec![None; blocks.len()];
        let mut unplaced: Vec<usize> = Vec::new();
        let claimed = claims[module];
        if let Some(row) = claimed {
            let held_source = before[previous.module_source[row] as usize];
            let address = |coverage: &Coverage, strings: Text, block: usize| (strings.at(coverage.block_name[block]).to_owned(), strings.at(coverage.block_path[block]).to_owned());
            let alike = addressed_alike(previous.blocks(row).map(|block| address(previous, ps, block)), blocks.clone().map(|block| address(current, cs, block)));
            let measured = current.module_instrumented[module] == 1 && previous.module_instrumented[row] == 1;
            let mut seen: FxHashMap<(u32, u32), u32> = FxHashMap::default();
            let mut addressed = FxHashMap::default();
            for block in blocks.clone() {
                let at = (now[current.block_name[block] as usize], now[current.block_path[block] as usize]);
                let nth = seen.entry(at).and_modify(|nth| *nth += 1).or_insert(1);
                addressed.insert((at.0, at.1, *nth), block);
            }
            seen.clear();
            // The top level is one region in every cut, whatever its branches did.
            let top = blocks.clone().find(|block| is_top(current.block_kind[*block]));
            for held in previous.blocks(row) {
                let at = (before[previous.block_name[held] as usize], before[previous.block_path[held] as usize]);
                let nth = *seen.entry(at).and_modify(|nth| *nth += 1).or_insert(1);
                let paired = if is_top(previous.block_kind[held]) {
                    top.as_ref()
                } else if alike(ps.at(previous.block_name[held]), ps.at(previous.block_path[held])) {
                    addressed.get(&(at.0, at.1, nth))
                } else {
                    None
                };
                match paired {
                    Some(block) if measured && previous.block_kind[held] == current.block_kind[*block] => {
                        surviving[*block - blocks.start] = Some(held);
                        if held_source != source
                            && before[previous.block_digest[held] as usize] != now[current.block_digest[*block] as usize]
                            && reaches(readings, cs.at(current.module_path[module]), ps.at(previous.module_source[row]), cs.at(current.module_source[module]), previous.block_kind[held])
                        {
                            lose(previous.block_set[held], &mut stale)?;
                        }
                    }
                    _ if measured => unplaced.push(held),
                    _ => lose(previous.block_set[held], &mut stale)?,
                }
            }
        }
        let around = around(current, blocks.clone(), &surviving);
        if let Some(row) = claimed.filter(|_| !unplaced.is_empty()) {
            owe_unplaced(row, &surviving.iter().flatten().copied().collect(), &unplaced, &mut stale)?;
        }
        out.module(path, source, current.blob_in(module, |id| now[id as usize]), current.module_instrumented[module] == 1);
        for (at, block) in blocks.enumerate() {
            let held = around[at];
            let start = current.block_start[block];
            out.region(Region {
                ordinal: current.block_ordinal[block],
                kind: current.block_kind[block],
                source: u8::from(current.block_source[block] == 1),
                owner: current.block_owner[block],
                digest: now[current.block_digest[block] as usize],
                name: now[current.block_name[block] as usize],
                path: now[current.block_path[block] as usize],
                start,
                end: if start == LAYOUT.coverage.no_line { LAYOUT.coverage.no_line } else { current.block_end[block] },
                called: union(&mut pool, held.map(|held| previous.block_set[held]), current.block_set[block])?,
                loaded: union(&mut pool, held.map(|held| previous.block_loaded_set[held]), current.block_loaded_set[block])?,
            });
        }
    }
    // Every previous region `current` claimed has been seen, so staleness is known.
    for (path, row) in written {
        match row {
            Row::Current(test) => {
                let inputs = settled(current, cs, test).into_iter().map(|(name, digest)| (now[name as usize], now[digest as usize]));
                out.test(path, u8::from(current.test_complete[test] == 1), current.duration(test), current.phases(test), inputs);
            }
            Row::Previous(test) => {
                let inputs: Vec<(u32, u32)> = if ascending(previous, test) {
                    previous.preconditions(test).map(|input| (previous.precondition_name[input], previous.precondition_digest[input])).collect()
                } else {
                    settled(previous, ps, test)
                };
                let complete = previous.test_complete[test] == 1 && !stale[test];
                out.test(path, u8::from(complete), previous.duration(test), previous.phases(test), inputs.into_iter().map(|(name, digest)| (before[name as usize], before[digest as usize])));
            }
        }
    }

    let (instrumentation, commit) = (now[current.instrumentation as usize], current.commit.map(|commit| now[commit as usize]));
    Ok(Written { merged, out, pool, instrumentation, commit })
}

/// A row of the output, by where it is read from.
#[derive(Clone, Copy)]
enum Row {
    Current(usize),
    Previous(usize),
}

/// A test's preconditions as text, compared as a set.
fn preconditions<'a>(coverage: &Coverage, strings: Text<'a>, test: usize) -> FxHashSet<(&'a str, &'a str)> {
    coverage.preconditions(test).map(|input| (strings.at(coverage.precondition_name[input]), strings.at(coverage.precondition_digest[input]))).collect()
}

/// A test's preconditions as ids, in code-unit order of their text, once each.
fn settled(coverage: &Coverage, strings: Text, test: usize) -> Vec<(u32, u32)> {
    let mut inputs: Vec<(u32, u32)> = coverage.preconditions(test).map(|input| (coverage.precondition_name[input], coverage.precondition_digest[input])).collect();
    let text = |(name, digest): &(u32, u32)| (strings.at(*name), strings.at(*digest));
    let order = |left: &(u32, u32), right: &(u32, u32)| {
        let (left, right) = (text(left), text(right));
        order::code_unit(left.0, right.0).then_with(|| order::code_unit(left.1, right.1))
    };
    inputs.sort_by(order);
    inputs.dedup_by(|right, left| order(left, right).is_eq());
    inputs
}

/// Whether a test's precondition ids ascend: its dictionary is sorted, so it was written settled.
fn ascending(coverage: &Coverage, test: usize) -> bool {
    let range = coverage.preconditions(test);
    let id = |input: usize| (coverage.precondition_name[input], coverage.precondition_digest[input]);
    (range.start + 1..range.end).all(|input| id(input - 1) < id(input))
}

/// Per region of a module row, the previous region its crossings come from:
/// its own, else the nearest region around it that has one.
///
/// A region born in a re-cut has no identity to carry crossings by, and an
/// empty crossing list is not an absence: it says *no test entered these
/// lines*, which nobody measured. Selection would then skip every test over a
/// diff inside it, because no valve opens for a row that exists. Arrival nests,
/// so every test on the enclosing region was somewhere inside it, perhaps here;
/// handing those tests down answers only diffs that land in the new region,
/// where demoting every holder of the module would run them on every diff in
/// the file. Both crossing lists ride together, and the walk stops at the module
/// root, which no cut ever bears anew; `landedThrough` in `region-edit.ts`
/// hands a born case index region its owner's cases by the same owners.
fn around(coverage: &Coverage, blocks: std::ops::Range<usize>, own: &[Option<usize>]) -> Vec<Option<usize>> {
    let ordinals: FxHashMap<u32, usize> = blocks.clone().enumerate().map(|(at, block)| (coverage.block_ordinal[block], at)).collect();
    let owner = |at: usize| {
        let owner = coverage.block_owner[blocks.start + at];
        (owner != LAYOUT.coverage.no_owner).then(|| ordinals.get(&owner).copied()).flatten()
    };
    let mut resolved: Vec<Option<Option<usize>>> = vec![None; own.len()];
    for start in 0..own.len() {
        let (mut handed, mut seen, mut at, mut answer) = (Vec::new(), FxHashSet::default(), Some(start), None);
        while let Some(region) = at {
            if !seen.insert(region) {
                break;
            }
            if let Some(already) = resolved[region] {
                answer = already;
                break;
            }
            if own[region].is_some() {
                resolved[region] = Some(own[region]);
                answer = own[region];
                break;
            }
            handed.push(region);
            at = owner(region);
        }
        for region in handed {
            resolved[region] = Some(answer);
        }
    }
    resolved.into_iter().map(Option::flatten).collect()
}

#[cfg(test)]
#[path = "record_coverage_layer_tests.rs"]
mod tests;
