use std::collections::{HashMap, HashSet};

use napi_derive::napi;

use crate::journey_journal::ModuleId;
use crate::order;

/// The owner of a region that has none: the module root's, as `blocks.owner` spells it.
pub const NO_OWNER: u32 = u32::MAX;

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
    /// Each region's owner, as its position among `blocks`, always before it,
    /// or [`NO_OWNER`]; absent where the cut that made the module named none.
    pub owners: Option<Vec<u32>>,
}

/// The regions every inventory of one file holds, and where each inventory's
/// own regions land among them.
pub struct Reconciled {
    pub blocks: Vec<Block>,
    /// `lands[inventory][region]` is the reconciled block that region reads as.
    pub lands: Vec<Vec<u32>>,
    /// Each reconciled block's owner among them, from the inventory the order
    /// came from; absent when that inventory names none.
    pub owners: Option<Vec<u32>>,
}

/// Each kept region's owner, as its position among the kept regions: the
/// nearest region up its owners that was kept, or [`NO_OWNER`] where none up
/// to the module root was. `kept[at]` is the region's position when kept.
pub fn kept_owners(owners: &[u32], kept: &[Option<u32>]) -> Vec<u32> {
    let mut answer = Vec::with_capacity(kept.len());
    for (at, place) in kept.iter().enumerate() {
        if place.is_none() {
            continue;
        }
        let mut owner = owners.get(at).copied().unwrap_or(NO_OWNER);
        let mut below = at;
        // An owner is always before its region, so the walk ends.
        let held = loop {
            if owner == NO_OWNER || owner as usize >= below {
                break NO_OWNER;
            }
            if let Some(Some(position)) = kept.get(owner as usize) {
                break *position;
            }
            below = owner as usize;
            owner = owners.get(below).copied().unwrap_or(NO_OWNER);
        };
        answer.push(held);
    }
    answer
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
///
/// `owners[inventory]` are that inventory's owners, by position, where known;
/// the reconciled owners are the base inventory's, read at the regions kept.
pub fn reconcile(inventories: &[&[Block]], owners: &[Option<&[u32]>]) -> Reconciled {
    let mut blocks: Vec<Block> = Vec::new();
    let mut at: HashMap<(&Block, u32), u32> = HashMap::new();
    let keyed: Vec<Vec<(&Block, u32)>> = inventories.iter().map(|blocks| repeats(blocks)).collect();
    // The order comes from one inventory chosen by content, so the answer is
    // the same whichever store or shard happened to be read first.
    let base_at = (0..inventories.len()).min_by(|left, right| inventory_order(inventories[*left], inventories[*right]));
    let base = base_at.map(|chosen| inventories[chosen]);
    let mut reconciled_owners = None;
    if let Some(base) = base {
        let held: Vec<HashSet<&(&Block, u32)>> = keyed.iter().map(|keys| keys.iter().collect()).collect();
        let mut kept = Vec::with_capacity(base.len());
        for key in repeats(base) {
            if held.iter().all(|other| other.contains(&key)) {
                at.insert(key, blocks.len() as u32);
                kept.push(Some(blocks.len() as u32));
                blocks.push(key.0.clone());
            } else {
                kept.push(None);
            }
        }
        let base_owners = base_at.and_then(|chosen| owners.get(chosen).copied().flatten());
        reconciled_owners = base_owners.map(|known| kept_owners(known, &kept));
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
    if let Some(known) = reconciled_owners.as_mut() {
        // The whole file, where one was added, encloses every region and has no owner.
        known.resize(blocks.len(), NO_OWNER);
    }
    Reconciled { blocks, lands, owners: reconciled_owners }
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
        let reconciled = reconcile(&[&one, &two], &[None, None]);
        assert!(reconciled.blocks == [module, outer, inner]);
        assert_eq!(reconciled.lands, [vec![0, 1, 2], vec![0, 1, 1, 2]]);
    }

    #[test]
    fn two_regions_of_one_shape_stay_two() {
        let (module, callback) = (block("module", "", 1, 5), block("function", "pick/find.arg0", 2, 2));
        let one = [module.clone(), callback.clone(), callback.clone()];
        let two = [module.clone(), callback.clone(), callback.clone(), block("branch", "", 4, 4)];
        let reconciled = reconcile(&[&one, &two], &[None, None]);
        assert!(reconciled.blocks == [module, callback.clone(), callback]);
        assert_eq!(reconciled.lands, [vec![0, 1, 2], vec![0, 1, 2, 0]]);
    }

    #[test]
    fn a_region_nothing_shared_encloses_lands_on_the_whole_file() {
        let shared = block("function", "shared", 2, 4);
        let one = [block("module", "a", 1, 10), shared.clone()];
        let two = [block("module", "b", 1, 12), shared.clone()];
        let reconciled = reconcile(&[&one, &two], &[None, None]);
        assert_eq!(reconciled.blocks.len(), 2);
        let whole = &reconciled.blocks[1];
        assert_eq!((whole.start_line, whole.end_line, whole.source), (1, 12, true));
        assert_eq!(reconciled.lands, [vec![1, 0], vec![1, 0]]);
    }

    #[test]
    fn a_kept_region_takes_its_nearest_kept_owner() {
        // 0 holds 1, 1 holds 2, 2 holds 3; 2 is not kept, so 3 is held by 1.
        let kept = [Some(0), Some(1), None, Some(2)];
        assert_eq!(kept_owners(&[NO_OWNER, 0, 1, 2], &kept), [NO_OWNER, 0, 1]);
        assert_eq!(kept_owners(&[NO_OWNER, 0, 1, 2], &[None, Some(0), None, Some(1)]), [NO_OWNER, 0]);
    }

    #[test]
    fn a_reconciled_region_takes_the_nearest_owner_both_hold() {
        let module = block("module", "", 1, 20);
        let outer = block("function", "outer", 2, 10);
        let branch = block("branch", "", 4, 6);
        let inner = block("function", "inner", 5, 5);
        let one = [module.clone(), outer.clone(), inner.clone()];
        let two = [module.clone(), outer.clone(), branch, inner.clone()];
        let (one_owners, two_owners) = ([NO_OWNER, 0, 1], [NO_OWNER, 0, 1, 2]);
        let reconciled = reconcile(&[&two, &one], &[Some(&two_owners), Some(&one_owners)]);
        assert!(reconciled.blocks == [module, outer, inner]);
        assert_eq!(reconciled.owners, Some(vec![NO_OWNER, 0, 1]));
        assert_eq!(reconcile(&[&two, &one], &[Some(&two_owners), None]).owners, None);
    }
}
