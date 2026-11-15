//! A layer's modules: a held one carried at the regions it was stored with,
//! and one cut now with the held cases landed on it (spec 0100).
//!
//! Every set is named by the output pool a [`Translation`] builds, and each is
//! translated in the order the regions ask for it, so a layer interns each
//! distinct set once however many regions name it.

use crate::case_shard::{Inventory, ShardModule};
use crate::journey_record::{Block, Module};

use super::case_layer_landing::Pairing;
use super::case_layer_lines::LaidLines;
use super::case_layer_sets::{Source, Translation, EMPTY};

/// One module of a layer's output, its sets named in the output pool.
pub(crate) struct Laid {
    pub module: Module,
    pub called: Vec<u32>,
    pub loaded: Vec<bool>,
    /// Empty where no region holds an overwritten case.
    pub overwritten: Vec<u32>,
}

impl Laid {
    /// Whether some case is left in it: a region a case entered, ran while it
    /// loaded, or holds as overwritten.
    pub(crate) fn entered(&self) -> bool {
        self.called.iter().any(|set| *set != EMPTY) || self.loaded.contains(&true) || !self.overwritten.is_empty()
    }
}

pub(crate) fn module_of(file: &str, blocks: Vec<Block>, owners: Option<Vec<u32>>) -> Module {
    Module { id: file.to_owned(), file: file.to_owned(), blocks, owners }
}

/// The sets, kept only where some region holds a case.
fn kept_sets(sets: Vec<u32>) -> Vec<u32> {
    if sets.iter().any(|set| *set != EMPTY) {
        sets
    } else {
        Vec::new()
    }
}

/// A module's sets carried through `from`, or `None` when no case is left in
/// it. `overwritten` is empty where the index holds no such column.
pub(crate) fn carry(sets: &mut Translation, from: &mut Source<'_>, called: &[u32], loaded: Vec<bool>, overwritten: &[u32]) -> Result<Option<(Vec<u32>, Vec<bool>, Vec<u32>)>, String> {
    let called = called.iter().map(|set| sets.translate(from, *set)).collect::<Result<Vec<_>, _>>()?;
    let overwritten = kept_sets(overwritten.iter().map(|set| sets.translate(from, *set)).collect::<Result<Vec<_>, _>>()?);
    let entered = called.iter().any(|set| *set != EMPTY) || loaded.contains(&true) || !overwritten.is_empty();
    Ok(entered.then_some((called, loaded, overwritten)))
}

/// A module cut now: its regions, and the sets its own cases name there.
pub(crate) struct Recorded<'a> {
    pub file: &'a str,
    pub blocks: &'a [Block],
    pub owners: Option<&'a [u32]>,
    pub called: &'a [u32],
    pub loaded: &'a [bool],
    /// Empty where the index it came from holds no such column.
    pub overwritten: &'a [u32],
}

/// The held module a recorded one is laid over, and where its cases land.
pub(crate) struct Over<'a> {
    pub row: u32,
    pub module: &'a ShardModule,
    pub pairing: Pairing,
}

/// What every module of one layer shares: the output pool, the held index's
/// sets translated into it, the lines, and the cases the run measured.
pub(crate) struct Layer<'a> {
    pub sets: Translation,
    pub from_held: Source<'a>,
    pub lines: Option<LaidLines>,
    pub ran: u32,
}

impl Layer<'_> {
    /// The held module at `row`, read at the regions it was stored with, or
    /// `None` when no case is left in it; `unloaded` clears its load flags.
    pub(crate) fn carried_row(&mut self, module: &ShardModule, cut: &Inventory, unloaded: bool) -> Result<Option<Laid>, String> {
        let loaded = if unloaded { vec![false; module.called.len()] } else { module.loaded.clone() };
        let Some((called, loaded, overwritten)) = carry(&mut self.sets, &mut self.from_held, &module.called, loaded, &module.overwritten)? else {
            return Ok(None);
        };
        Ok(Some(Laid { module: module_of(&module.file, cut.blocks.clone(), cut.owners.clone()), called, loaded, overwritten }))
    }

    fn held_over(&mut self, module: &ShardModule, from: usize) -> Result<u32, String> {
        match module.overwritten.get(from) {
            Some(set) => self.sets.translate(&mut self.from_held, *set),
            None => Ok(EMPTY),
        }
    }

    /// `recorded`'s regions, each with the cases its own sets name, translated
    /// by `own`, and the held cases that land on it from `held`. Each region
    /// is handed to the lines as a region of the `at`-th module written, which
    /// the run recorded as its `run_module`-th.
    ///
    /// A held case the edit overwrote — a case of the region the pairing says
    /// it overwrote, one the held index held as overwritten, or every held case
    /// of the module where the edit is unread — ran a text this one does not
    /// hold. It is written into the region's overwritten set unless the region
    /// names it or the run measured it at this text.
    pub(crate) fn laid_on(&mut self, recorded: &Recorded<'_>, mut own: Option<&mut Source<'_>>, held: Option<&Over<'_>>, at: u32, run_module: u32) -> Result<Laid, String> {
        let count = recorded.blocks.len();
        let mut unread = EMPTY;
        if let Some(over) = held.filter(|over| over.pairing.unread) {
            for (from, set) in over.module.called.iter().enumerate() {
                let carried = self.sets.translate(&mut self.from_held, *set)?;
                let was = self.held_over(over.module, from)?;
                let both = self.sets.union(carried, was);
                unread = self.sets.union(unread, both);
            }
        }
        let (mut called, mut loaded, mut overwritten) = (Vec::with_capacity(count), Vec::with_capacity(count), Vec::with_capacity(count));
        for block in 0..count {
            let mine = match own.as_deref_mut() {
                Some(source) => self.sets.translate(source, recorded.called[block])?,
                None => EMPTY,
            };
            let from = held.map_or(-1, |over| over.pairing.lands[block]);
            let other = held.map_or(-1, |over| over.pairing.overwrote[block]);
            let carried_in = match held {
                Some(over) if from >= 0 => Some(self.sets.translate(&mut self.from_held, over.module.called[from as usize])?),
                _ => None,
            };
            let here = carried_in.map_or(mine, |carried| self.sets.union(mine, carried));
            if let Some(lines) = self.lines.as_mut() {
                let landed = held.zip(carried_in).map(|(over, carried)| (over.row, from as u32, self.sets.members(carried)));
                lines.recorded(at, block as u32, run_module, self.sets.members(mine), landed)?;
            }
            loaded.push(recorded.loaded[block] || held.is_some_and(|over| from >= 0 && over.module.loaded[from as usize]));
            let landed_over = match held {
                Some(over) if from >= 0 => self.held_over(over.module, from as usize)?,
                _ => EMPTY,
            };
            let overwrote = match held {
                Some(over) if other >= 0 => {
                    let ran = self.sets.translate(&mut self.from_held, over.module.called[other as usize])?;
                    let was = self.held_over(over.module, other as usize)?;
                    self.sets.union(ran, was)
                }
                _ => EMPTY,
            };
            let either = self.sets.union(landed_over, overwrote);
            let unknown = self.sets.union(unread, either);
            let own_over = match (own.as_deref_mut(), recorded.overwritten.get(block)) {
                (Some(source), Some(set)) => self.sets.translate(source, *set)?,
                _ => EMPTY,
            };
            let unmeasured = self.sets.minus(unknown, self.ran);
            let written = self.sets.union(unmeasured, own_over);
            overwritten.push(self.sets.minus(written, here));
            called.push(here);
        }
        Ok(Laid {
            module: module_of(recorded.file, recorded.blocks.to_vec(), recorded.owners.map(<[u32]>::to_vec)),
            called,
            loaded,
            overwritten: kept_sets(overwritten),
        })
    }
}
