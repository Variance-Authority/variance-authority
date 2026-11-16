//! The regions a case index holds of some of its cases, laid out in one walk
//! over its modules: for `combine`, which reads a shard and the cuts its
//! modules name, and for the readings lay, which reads a case index's columns.

use std::collections::HashMap;
use std::sync::Arc;

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
    fn module(&self, place: usize) -> Result<Arc<str>, String>;
    /// The set of the cases that crossed each region of the module at `place`, in region order.
    fn called(&self, place: usize) -> &[u32];
    /// The name, path and lines of region `block` of the module at `place`.
    fn region(&self, place: usize, block: usize) -> Result<(Arc<str>, Arc<str>, u64, u64), String>;
    fn sets(&self) -> (&[u8], &[u32]);
    fn lines(&self, row: u32) -> Result<Option<case_lines::Lines>, String>;
}

/// The regions each case at `rows` crossed in `index`, as `readingsOf` reads
/// them: in module and region order, each with the value the case's lines
/// give it. Each set is decoded once, and only these cases' regions are laid
/// out. A row named twice is laid out for its last place in `rows`.
pub(crate) fn regions_of(index: &impl Walked, rows: &[u32]) -> Result<Vec<Vec<Region>>, String> {
    #[cfg(test)]
    crate::case_readings::EXPANDED.with(|expanded| expanded.set(expanded.get() + rows.len()));
    let mut read = vec![Vec::new(); rows.len()];
    if rows.is_empty() {
        return Ok(read);
    }
    let mut slots: Vec<Option<usize>> = vec![None; index.cases()];
    for (slot, row) in rows.iter().enumerate() {
        *slots.get_mut(*row as usize).ok_or_else(|| format!("the case index holds no case at row {row}"))? = Some(slot);
    }
    let lines = rows.iter().map(|row| index.lines(*row)).collect::<Result<Vec<_>, String>>()?;
    let (set_bytes, set_offsets) = index.sets();
    let mut members: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    // Each case's lines of the module last read for it.
    let mut module_lines: Vec<(usize, Option<case_lines::ModuleLines>)> = vec![(usize::MAX, None); rows.len()];
    for place in 0..index.modules() {
        let file = index.module(place)?;
        for (block, set) in index.called(place).iter().enumerate() {
            if !members.contains_key(set) {
                members.insert(*set, decode_set(set_slice(set_bytes, set_offsets, *set)?, index.cases())?);
            }
            for row in &members[set] {
                let Some(slot) = slots.get(*row as usize).copied().flatten() else { continue };
                let (at_place, own) = &mut module_lines[slot];
                if *at_place != place {
                    *at_place = place;
                    *own = lines[slot].as_ref().map(|lines| case_lines::module_lines(lines, place as u32));
                }
                let (name, path, start, end) = index.region(place, block)?;
                read[slot].push(Region { module: file.clone(), name, path, start, end, value: own.and_then(|own| own.value(block as u32)) });
            }
        }
    }
    Ok(read)
}

/// A shard read with the cuts its modules name in `inventories`, as `regions_of` walks it.
pub(crate) struct Cuts<'a> {
    shard: &'a Shard,
    cuts: Vec<&'a Inventory>,
    files: Vec<Arc<str>>,
}

impl<'a> Cuts<'a> {
    pub(crate) fn new(shard: &'a Shard, inventories: &'a HashMap<String, Vec<Inventory>>) -> Result<Self, String> {
        let cuts = shard.modules.iter().map(|module| cut_of(inventories, &module.file, module.inventory)).collect::<Result<_, String>>()?;
        Ok(Cuts { shard, cuts, files: shard.modules.iter().map(|module| Arc::from(module.file.as_str())).collect() })
    }
}

impl Walked for Cuts<'_> {
    fn cases(&self) -> usize {
        self.shard.tests.len()
    }

    fn modules(&self) -> usize {
        self.shard.modules.len()
    }

    fn module(&self, place: usize) -> Result<Arc<str>, String> {
        Ok(self.files[place].clone())
    }

    fn called(&self, place: usize) -> &[u32] {
        &self.shard.modules[place].called
    }

    fn region(&self, place: usize, block: usize) -> Result<(Arc<str>, Arc<str>, u64, u64), String> {
        let region = self.cuts[place].blocks.get(block).ok_or_else(|| format!("the case index names a region of `{}` its cut does not hold", self.files[place]))?;
        Ok((Arc::from(region.name.as_str()), Arc::from(region.path.as_str()), u64::from(region.start_line), u64::from(region.end_line)))
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
