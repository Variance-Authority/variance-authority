//! Each case's lines as a layer lays them: a carried module keeps the segments
//! its held cases stored, and a module the run recorded takes each case's line
//! from the side whose set holds it, the run's where both do (spec 0100).
//!
//! A case has lines only when every side it came from recorded them: a case
//! that ran again over a held one whose lines were not recorded, or the
//! reverse, would otherwise read a region the other side reached as reached by
//! nothing.
//!
//! Modules are handed over in the order the layer writes them, each region of
//! a recorded module in order, and kept as steps: every case's builder reads
//! them in that order, so it sees its modules rising.

use rayon::prelude::*;
use rustc_hash::FxHashMap;

use crate::case_lines::{decode, value_at, Builder, Lines};

use super::case_layer_sets::Translation;

/// One module, or one region of one, as the layer handed it over.
enum Step {
    /// A held row carried as it was stored, written as the `module`-th.
    Carried { module: u32, row: u32 },
    /// Region `block` of the `module`-th written, the run's `run_module`-th,
    /// entered by the output set `mine` and by the output set of a held row's region.
    Recorded { module: u32, block: u32, run_module: u32, mine: u32, held: Option<(u32, u32, u32)> },
}

pub(crate) struct LaidLines {
    held: Vec<Option<Lines>>,
    run: Vec<Option<Lines>>,
    held_source: Vec<bool>,
    lined: Vec<bool>,
    /// The held cases' segments by the held row they name, the output cases beside each, ascending.
    carried: FxHashMap<u32, Vec<usize>>,
    steps: Vec<Step>,
}

impl LaidLines {
    /// The layer's lines, or `None` where neither index recorded any.
    /// `held_at` names each held row's output case, -1 for a dropped one, and
    /// `run_at` each run case's.
    pub(crate) fn open(held_rows: &[Vec<u8>], run_rows: &[Vec<u8>], held_at: &[i64], run_at: &[usize], count: usize) -> Result<Option<Self>, String> {
        if held_rows.iter().chain(run_rows).all(Vec::is_empty) {
            return Ok(None);
        }
        let mut held: Vec<Option<Lines>> = (0..count).map(|_| None).collect();
        let mut run: Vec<Option<Lines>> = (0..count).map(|_| None).collect();
        let mut held_source = vec![false; count];
        let mut run_source = vec![false; count];
        for (row, at) in held_at.iter().enumerate() {
            if *at < 0 {
                continue;
            }
            let at = *at as usize;
            held_source[at] = true;
            held[at] = decode(held_rows.get(row).map_or(&[][..], Vec::as_slice))?;
        }
        for (test, at) in run_at.iter().enumerate() {
            run_source[*at] = true;
            run[*at] = decode(run_rows.get(test).map_or(&[][..], Vec::as_slice))?;
        }
        let lined: Vec<bool> = (0..count).map(|at| (!held_source[at] || held[at].is_some()) && (!run_source[at] || run[at].is_some())).collect();
        let mut carried: FxHashMap<u32, Vec<usize>> = FxHashMap::default();
        for (at, lines) in held.iter().enumerate() {
            let Some(lines) = lines else { continue };
            if !lined[at] {
                continue;
            }
            for row in lines.segments.keys() {
                carried.entry(*row).or_default().push(at);
            }
        }
        Ok(Some(LaidLines { held, run, held_source, lined, carried, steps: Vec::new() }))
    }

    /// The held module at `row`, carried as it was stored, written as the `module`-th.
    pub(crate) fn carried(&mut self, module: u32, row: u32) {
        self.steps.push(Step::Carried { module, row });
    }

    /// A region of the `module`-th module written, recorded by the run as
    /// region `block` of its module `run_module`, entered by the cases of the
    /// output set `mine`; and by the held cases of the output set `held` names
    /// at a region of a held row, where the held cut has one under it.
    pub(crate) fn recorded(&mut self, module: u32, block: u32, run_module: u32, mine: u32, held: Option<(u32, u32, u32)>) {
        self.steps.push(Step::Recorded { module, block, run_module, mine, held });
    }

    /// Every output case's lines, in output order; an unlined case's are empty.
    /// Each case is built on its own from the steps, so the cases are split
    /// across every core, each slice reading the steps for its own cases.
    pub(crate) fn finish(self, sets: &Translation) -> Result<Vec<Vec<u8>>, String> {
        let count = self.lined.len();
        let slice = count.div_ceil(rayon::current_num_threads() * 4).max(64);
        let slices: Vec<Vec<Vec<u8>>> = (0..count.div_ceil(slice))
            .into_par_iter()
            .map(|at| self.slice(sets, at * slice..count.min((at + 1) * slice)))
            .collect::<Result<_, String>>()?;
        Ok(slices.into_iter().flatten().collect())
    }

    /// The lines of the cases in `cases`.
    fn slice(&self, sets: &Translation, cases: std::ops::Range<usize>) -> Result<Vec<Vec<u8>>, String> {
        let within = |members: &[u32]| -> std::ops::Range<usize> {
            members.partition_point(|at| (*at as usize) < cases.start)..members.partition_point(|at| (*at as usize) < cases.end)
        };
        let mut builders: Vec<Option<Builder>> = cases.clone().map(|_| None).collect();
        for step in &self.steps {
            match *step {
                Step::Carried { module, row } => {
                    let Some(held) = self.carried.get(&row) else { continue };
                    let from = held.partition_point(|at| *at < cases.start);
                    for at in held[from..].iter().take_while(|at| **at < cases.end) {
                        let (values, starts) = &self.held[*at].as_ref().expect("a carried case holds lines").segments[&row];
                        builders[at - cases.start].get_or_insert_with(Builder::default).segment(module, values, starts)?;
                    }
                }
                Step::Recorded { module, block, run_module, mine, held } => {
                    let mine = sets.members(mine);
                    for at in &mine[within(mine)] {
                        let at = *at as usize;
                        if self.lined[at] {
                            let value = reached(value_at(self.run[at].as_ref().expect("a lined run case holds lines"), run_module, block))?;
                            builders[at - cases.start].get_or_insert_with(Builder::default).add(module, block, value)?;
                        }
                    }
                    let Some((row, held_block, members)) = held else { continue };
                    let members = sets.members(members);
                    for at in &members[within(members)] {
                        if mine.binary_search(at).is_ok() || !self.lined[*at as usize] {
                            continue;
                        }
                        let at = *at as usize;
                        let value = reached(value_at(self.held[at].as_ref().expect("a lined held case holds lines"), row, held_block))?;
                        builders[at - cases.start].get_or_insert_with(Builder::default).add(module, block, value)?;
                    }
                }
            }
        }
        Ok(builders
            .into_iter()
            .zip(cases)
            .map(|(builder, at)| {
                if !self.lined[at] {
                    return Vec::new();
                }
                // A carried module without a segment stands at the held fallback, so it stays the fallback.
                let fallback = if self.held_source[at] { self.held[at].as_ref().and_then(|lines| lines.fallback) } else { None };
                builder.unwrap_or_default().finish(fallback)
            })
            .collect())
    }
}

/// A crossed region's value; a case whose lines name no value for a region it
/// crossed was not written by a fold.
fn reached(value: Option<u64>) -> Result<u64, String> {
    value.ok_or_else(|| "not a variance-authority execution index".to_owned())
}
