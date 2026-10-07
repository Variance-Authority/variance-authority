use std::collections::{HashMap, HashSet};

use napi_derive::napi;

use crate::journey_journal::ModuleId;
use crate::order;

/// One region of a module, as the transform that placed its probes cut it.
#[napi(object)]
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct Block {
    pub kind: String,
    pub name: String,
    pub path: String,
    /// Zero for a region with no line of any file.
    pub start_line: u32,
    pub end_line: u32,
    pub source: bool,
}

/// One module a run's cases named, cut again from the checkout.
#[napi(object)]
#[derive(Clone)]
pub struct Module {
    /// What its probes report.
    pub id: ModuleId,
    /// The repository-relative file its regions' lines are in.
    pub file: String,
    /// In ordinal order; empty for a module whose ordinals cannot be read.
    pub blocks: Vec<Block>,
}

/// The regions every inventory of one file holds, and where each inventory's
/// own regions land among them.
pub struct Reconciled {
    pub blocks: Vec<Block>,
    /// `lands[inventory][region]` is the reconciled block that region reads as.
    pub lands: Vec<Vec<u32>>,
}

/// Read several inventories of one source text at the regions they share.
///
/// Two transforms of one file can cut its regions apart, so an ordinal names a
/// region only against the inventory that cut it. The lines are common ground:
/// a region that only some builds hold lands on the innermost shared source
/// region that encloses it, and the whole file only when nothing does. That is
/// the region a changed line resolves to, since a shared region is in every
/// inventory and regions of one inventory nest — so every case that ran the
/// line is credited where the change will look.
// TODO: keep each build's own regions and read a case's ordinals against the build that cut them — needs the case journal to name that build.
pub fn reconcile(inventories: &[&[Block]]) -> Reconciled {
    let mut blocks: Vec<Block> = Vec::new();
    let mut at: HashMap<(&Block, u32), u32> = HashMap::new();
    let keyed: Vec<Vec<(&Block, u32)>> = inventories.iter().map(|blocks| repeats(blocks)).collect();
    // The order comes from one inventory chosen by content, so the answer is
    // the same whichever store or shard happened to be read first.
    let base = inventories.iter().copied().min_by(|left, right| inventory_order(left, right));
    if let Some(base) = base {
        let held: Vec<HashSet<&(&Block, u32)>> = keyed.iter().map(|keys| keys.iter().collect()).collect();
        for key in repeats(base) {
            if held.iter().all(|other| other.contains(&key)) {
                at.insert(key, blocks.len() as u32);
                blocks.push(key.0.clone());
            }
        }
    }
    let shared = blocks.len();
    let mut whole = None;
    let mut lands = Vec::with_capacity(inventories.len());
    for (inventory, keys) in inventories.iter().zip(&keyed) {
        let mut landed = Vec::with_capacity(inventory.len());
        for (block, key) in inventory.iter().zip(keys) {
            let target = match at.get(key).copied().or_else(|| enclosing(&blocks[..shared], block)) {
                Some(target) => target,
                None => *whole.get_or_insert_with(|| {
                    blocks.push(whole_file(inventories, base.and_then(<[Block]>::first)));
                    (blocks.len() - 1) as u32
                }),
            };
            landed.push(target);
        }
        lands.push(landed);
    }
    Reconciled { blocks, lands }
}

/// Each region with the number of regions of its shape up to it: two callbacks
/// handed to one call on one line share every field, and only their place in
/// the order the recipe cut them says which is which. Keyed by shape alone, the
/// second would land on the first. `addressKey` numbers repeats the same way.
fn repeats(blocks: &[Block]) -> Vec<(&Block, u32)> {
    let mut seen: HashMap<&Block, u32> = HashMap::new();
    blocks.iter().map(|block| (block, *seen.entry(block).and_modify(|nth| *nth += 1).or_insert(1))).collect()
}

fn enclosing(shared: &[Block], block: &Block) -> Option<u32> {
    shared
        .iter()
        .enumerate()
        .filter(|(_, outer)| {
            outer.source && outer.start_line <= block.start_line && block.end_line <= outer.end_line
        })
        .min_by_key(|(at, outer)| (outer.end_line.saturating_sub(outer.start_line), *at))
        .map(|(at, _)| at as u32)
}

fn inventory_order(left: &[Block], right: &[Block]) -> std::cmp::Ordering {
    left.len().cmp(&right.len()).then_with(|| {
        left.iter()
            .zip(right)
            .map(|(left, right)| {
                left.start_line
                    .cmp(&right.start_line)
                    .then(left.end_line.cmp(&right.end_line))
                    .then(left.source.cmp(&right.source))
                    .then_with(|| order::code_unit(&left.kind, &right.kind))
                    .then_with(|| order::code_unit(&left.name, &right.name))
                    .then_with(|| order::code_unit(&left.path, &right.path))
            })
            .find(|ordering| ordering.is_ne())
            .unwrap_or(std::cmp::Ordering::Equal)
    })
}

fn whole_file(inventories: &[&[Block]], first: Option<&Block>) -> Block {
    let (start_line, end_line) = inventories
        .iter()
        .flat_map(|blocks| blocks.iter())
        .filter(|block| block.source)
        .fold((u32::MAX, 0), |(start, end), block| {
            (start.min(block.start_line), end.max(block.end_line))
        });
    let source = start_line <= end_line;
    Block {
        kind: "module".to_owned(),
        name: first.map_or_else(String::new, |block| block.name.clone()),
        path: first.map_or_else(String::new, |block| block.path.clone()),
        start_line: if source { start_line } else { first.map_or(0, |block| block.start_line) },
        end_line: if source { end_line } else { first.map_or(0, |block| block.end_line) },
        source,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(kind: &str, name: &str, start_line: u32, end_line: u32) -> Block {
        Block {
            kind: kind.to_owned(),
            name: name.to_owned(),
            path: String::new(),
            start_line,
            end_line,
            source: true,
        }
    }

    #[test]
    fn a_region_one_build_cut_lands_on_the_innermost_region_both_hold() {
        let module = block("module", "", 1, 20);
        let outer = block("function", "outer", 2, 10);
        let inner = block("function", "inner", 12, 15);
        let branch = block("branch", "", 4, 6);
        let one = [module.clone(), outer.clone(), inner.clone()];
        let two = [module.clone(), outer.clone(), branch, inner.clone()];
        let reconciled = reconcile(&[&one, &two]);
        assert!(reconciled.blocks == [module, outer, inner]);
        assert_eq!(reconciled.lands, [vec![0, 1, 2], vec![0, 1, 1, 2]]);
    }

    #[test]
    fn two_regions_of_one_shape_stay_two() {
        let (module, callback) = (block("module", "", 1, 5), block("function", "pick/find.arg0", 2, 2));
        let one = [module.clone(), callback.clone(), callback.clone()];
        let two = [module.clone(), callback.clone(), callback.clone(), block("branch", "", 4, 4)];
        let reconciled = reconcile(&[&one, &two]);
        assert!(reconciled.blocks == [module, callback.clone(), callback]);
        assert_eq!(reconciled.lands, [vec![0, 1, 2], vec![0, 1, 2, 0]]);
    }

    #[test]
    fn a_region_nothing_shared_encloses_lands_on_the_whole_file() {
        let shared = block("function", "shared", 2, 4);
        let one = [block("module", "a", 1, 10), shared.clone()];
        let two = [block("module", "b", 1, 12), shared.clone()];
        let reconciled = reconcile(&[&one, &two]);
        assert_eq!(reconciled.blocks.len(), 2);
        let whole = &reconciled.blocks[1];
        assert_eq!((whole.start_line, whole.end_line, whole.source), (1, 12, true));
        assert_eq!(reconciled.lands, [vec![1, 0], vec![1, 0]]);
    }
}
