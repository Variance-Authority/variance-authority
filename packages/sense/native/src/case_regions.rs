//! The regions a case index holds of some of its cases, laid out in one walk
//! over its modules: for `combine`, which reads a shard and the cuts its
//! modules name, and for the readings lay, which reads a case index's columns.

use std::collections::HashMap;

use rayon::prelude::*;
use rustc_hash::FxHashMap;

use crate::case_lines;
use crate::case_readings::Region;
use crate::case_shard::{Inventory, Shard};
use crate::crossing_sets::{decode_set, set_slice};

/// A case index as `regions_of` walks it: its modules in order, each region's
/// set of the cases that crossed it, and each case's lines.
pub(crate) trait Walked {
    fn cases(&self) -> usize;
    fn modules(&self) -> usize;
    fn module(&self, place: usize) -> Result<&str, String>;
    /// The set of the cases that crossed each region of the module at `place`, in region order.
    fn called(&self, place: usize) -> &[u32];
    /// The name, path and lines of region `block` of the module at `place`.
    fn region(&self, place: usize, block: usize) -> Result<(&str, &str, u64, u64), String>;
    fn sets(&self) -> (&[u8], &[u32]);
    fn lines(&self, row: u32) -> Result<Option<case_lines::Lines>, String>;
}

/// The regions each case at `rows` crossed in `index`, as `readingsOf` reads
/// them: in module and region order, each with the value the case's lines
/// give it. Each set is decoded once, and only these cases' regions are laid
/// out. A row named twice is laid out for its last place in `rows`.
pub(crate) fn regions_of<'a>(index: &'a (impl Walked + Sync), rows: &[u32]) -> Result<Vec<Vec<Region<'a>>>, String> {
    #[cfg(test)]
    crate::case_readings::EXPANDED.with(|expanded| expanded.set(expanded.get() + rows.len()));
    let mut read = vec![Vec::new(); rows.len()];
    if rows.is_empty() {
        return Ok(read);
    }
    let cases = index.cases();
    let mut slots: Vec<Option<usize>> = vec![None; cases];
    for (slot, row) in rows.iter().enumerate() {
        *slots.get_mut(*row as usize).ok_or_else(|| format!("the case index holds no case at row {row}"))? = Some(slot);
    }
    let lines = rows.par_iter().map(|row| index.lines(*row)).collect::<Result<Vec<_>, String>>()?;
    // Each set once, its members ascending: a member is one case, so a case's
    // regions come out in module and region order whatever order its sets
    // name it in, and a range of rows finds its members by bisection.
    let (set_bytes, set_offsets) = index.sets();
    let mut named: Vec<u32> = (0..index.modules()).flat_map(|place| index.called(place).iter().copied()).collect();
    named.sort_unstable();
    named.dedup();
    let decoded = named
        .par_iter()
        .map(|set| {
            let mut members = decode_set(set_slice(set_bytes, set_offsets, *set)?, cases)?;
            members.sort_unstable();
            Ok((*set, members))
        })
        .collect::<Result<FxHashMap<u32, Vec<u32>>, String>>()?;
    // Every module's regions are walked once, in contiguous runs of modules on
    // their own threads; each run names the case, module and region of every
    // crossing by a wanted case, in module and region order.
    let places = index.modules();
    let files = (0..places).map(|place| index.module(place)).collect::<Result<Vec<_>, String>>()?;
    let width = places.div_ceil((rayon::current_num_threads() * 4).max(1)).max(1);
    let hits: Vec<Vec<(u32, u32, u32)>> = (0..places)
        .step_by(width)
        .collect::<Vec<_>>()
        .into_par_iter()
        .map(|from| {
            let mut hits = Vec::new();
            for place in from..(from + width).min(places) {
                for (block, set) in index.called(place).iter().enumerate() {
                    for row in &decoded[set] {
                        if let Some(slot) = slots[*row as usize] {
                            hits.push((slot as u32, place as u32, block as u32));
                        }
                    }
                }
            }
            hits
        })
        .collect();
    // Grouped by case, the runs taken in module order: a case's crossings stay
    // in module and region order.
    let mut starts = vec![0usize; rows.len() + 1];
    for (slot, _, _) in hits.iter().flatten() {
        starts[*slot as usize + 1] += 1;
    }
    for at in 1..starts.len() {
        starts[at] += starts[at - 1];
    }
    let mut crossed = vec![(0u32, 0u32); starts[rows.len()]];
    let mut next = starts.clone();
    for (slot, place, block) in hits.into_iter().flatten() {
        crossed[next[slot as usize]] = (place, block);
        next[slot as usize] += 1;
    }
    let laid = (0..rows.len())
        .into_par_iter()
        .map(|slot| -> Result<Vec<Region<'a>>, String> {
            let crossings = &crossed[starts[slot]..starts[slot + 1]];
            let mut regions = Vec::with_capacity(crossings.len());
            // The case's lines of the module last read for it.
            let mut module_lines: (u32, Option<case_lines::ModuleLines>) = (u32::MAX, None);
            for (place, block) in crossings {
                if module_lines.0 != *place {
                    module_lines = (*place, lines[slot].as_ref().map(|lines| case_lines::module_lines(lines, *place)));
                }
                let (name, path, start, end) = index.region(*place as usize, *block as usize)?;
                regions.push(Region { module: files[*place as usize], name, path, start, end, value: module_lines.1.and_then(|own| own.value(*block)) });
            }
            Ok(regions)
        })
        .collect::<Result<Vec<_>, String>>()?;
    for (slot, regions) in laid.into_iter().enumerate() {
        read[slot] = regions;
    }
    Ok(read)
}

/// A shard read with the cuts its modules name in `inventories`, as `regions_of` walks it.
pub(crate) struct Cuts<'a> {
    shard: &'a Shard,
    cuts: Vec<&'a Inventory>,
}

impl<'a> Cuts<'a> {
    pub(crate) fn new(shard: &'a Shard, inventories: &'a HashMap<String, Vec<Inventory>>) -> Result<Self, String> {
        let cuts = shard.modules.iter().map(|module| cut_of(inventories, &module.file, module.inventory)).collect::<Result<_, String>>()?;
        Ok(Cuts { shard, cuts })
    }
}

impl Walked for Cuts<'_> {
    fn cases(&self) -> usize {
        self.shard.tests.len()
    }

    fn modules(&self) -> usize {
        self.shard.modules.len()
    }

    fn module(&self, place: usize) -> Result<&str, String> {
        Ok(&self.shard.modules[place].file)
    }

    fn called(&self, place: usize) -> &[u32] {
        &self.shard.modules[place].called
    }

    fn region(&self, place: usize, block: usize) -> Result<(&str, &str, u64, u64), String> {
        let region = self.cuts[place].blocks.get(block).ok_or_else(|| format!("the case index names a region of `{}` its cut does not hold", self.shard.modules[place].file))?;
        Ok((region.name.as_str(), region.path.as_str(), u64::from(region.start_line), u64::from(region.end_line)))
    }

    fn sets(&self) -> (&[u8], &[u32]) {
        (&self.shard.set_bytes, &self.shard.set_offsets)
    }

    fn lines(&self, row: u32) -> Result<Option<case_lines::Lines>, String> {
        case_lines::decode(&self.shard.lines[row as usize])
    }
}

fn cut_of<'a>(inventories: &'a HashMap<String, Vec<Inventory>>, file: &str, at: usize) -> Result<&'a Inventory, String> {
    inventories.get(file).and_then(|cuts| cuts.get(at)).ok_or_else(|| format!("the case index names a cut of `{file}` it does not hold"))
}
