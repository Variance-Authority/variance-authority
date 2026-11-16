//! Where a held module's regions stand among a cut of it recorded now, and
//! where their cases land over the edit between the two texts.
//!
//! A region the edit's `-U0` hunks leave whole keeps its cases at the lines
//! the hunks place it. A touched one keeps them only where the edit's reading
//! spares its kind; where it does not, they ran another text there and are
//! overwritten. A region with no seat pairs by address where both cuts
//! numbered their regions alike, and otherwise takes what the region around
//! it took.

use rustc_hash::{FxHashMap, FxHashSet};

use crate::journey_record::{Block, NO_OWNER};
use crate::record_coverage_address::{addressed_alike, same_numbering};
use crate::record_coverage_recut::spares;

/// A region with no line of any file.
const NO_LINE: u32 = 0;

/// One `-U0` hunk: the old lines it replaced and the new lines it wrote.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Hunk {
    pub old_start: i64,
    pub old_count: i64,
    pub new_start: i64,
    pub new_count: i64,
}

/// What an edit did to a module: its hunks, and the selector's reading of the
/// two texts, absent where no module reader claims the file.
#[derive(Clone, Debug, Default)]
pub(crate) struct Edit {
    pub hunks: Vec<Hunk>,
    pub reading: Option<String>,
}

/// Where the hunks place `start..=end`, and whether they touched it; `None`
/// where they removed every line of it and wrote nothing in its place.
// FIXME: `placeThrough` in `placed.ts` and `regionTouched` in `region-edit.ts`
// run this step again in JavaScript for selection over an edit; selection
// should ask the addon instead.
pub(crate) fn place_through(hunks: &[Hunk], start_line: i64, end_line: i64) -> Option<(i64, i64, bool)> {
    let (mut shift, mut moved, mut start, mut end, mut removed) = (0, false, None, None, 0);
    for hunk in hunks {
        let old_end = hunk.old_start + hunk.old_count - 1;
        if hunk.old_count == 0 {
            if hunk.old_start < start_line {
                shift += hunk.new_count;
            } else if hunk.old_start < end_line {
                moved = true;
            }
            continue;
        }
        if old_end < start_line {
            shift += hunk.new_count - hunk.old_count;
            continue;
        }
        if hunk.old_start > end_line {
            break;
        }
        moved = true;
        let new_end = hunk.new_start + hunk.new_count.max(1) - 1;
        if hunk.old_start <= start_line {
            start = Some(if hunk.new_count == 0 { hunk.new_start + 1 } else { hunk.new_start });
        }
        if old_end >= end_line {
            end = Some(if hunk.new_count == 0 { hunk.new_start } else { new_end });
        }
        removed += old_end.min(end_line) - hunk.old_start.max(start_line) + 1;
    }
    let rewritten = hunks.iter().any(|hunk| hunk.new_count > 0 && hunk.old_start <= end_line && hunk.old_start + hunk.old_count - 1 >= start_line);
    if removed == end_line - start_line + 1 && !rewritten {
        return None;
    }
    if !moved {
        return Some((start_line + shift, end_line + shift, false));
    }
    let placed_start = start.unwrap_or(start_line + shift);
    let placed_end = end.unwrap_or(end_line + shift_before(hunks, end_line));
    Some((placed_start, placed_end.max(placed_start), true))
}

/// How far the edit moved an old line nothing touched.
fn shift_before(hunks: &[Hunk], line: i64) -> i64 {
    hunks
        .iter()
        .filter(|hunk| if hunk.old_count == 0 { hunk.old_start < line } else { hunk.old_start + hunk.old_count - 1 < line })
        .map(|hunk| hunk.new_count - hunk.old_count)
        .sum()
}

/// Whether `edit` reaches a region of `kind` it did not leave whole; a text
/// the edit left whole runs as it did.
fn edit_reaches(edit: &Edit, kind: &str) -> bool {
    !spares(if edit.hunks.is_empty() { Some("none") } else { edit.reading.as_deref() }, kind)
}

/// The lines `edit` leaves a region at when it stays whole there, or `None`
/// when the edit touched it.
fn stays(edit: &Edit, block: &Block) -> Option<(i64, i64)> {
    let (start, end) = (i64::from(block.start_line), i64::from(block.end_line));
    if block.start_line == NO_LINE {
        return Some((start, end));
    }
    match place_through(&edit.hunks, start, end) {
        Some((start, end, false)) => Some((start, end)),
        _ => None,
    }
}

/// Where the cases a held cut held land in a recorded cut of it.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Pairing {
    /// Per recorded region, the held region its cases carry from, or -1.
    pub lands: Vec<i32>,
    /// Per recorded region the edit reached, the held region whose cases would
    /// have landed there, or -1.
    pub overwrote: Vec<i32>,
    /// The edit could not be read: every held case ran another text everywhere.
    pub unread: bool,
}

fn address(block: &Block) -> (String, String) {
    (block.name.clone(), block.path.clone())
}

/// The n-th occurrence of `address` among those `seen` counted.
fn address_key<K: std::hash::Hash + Eq + Clone>(address: K, seen: &mut FxHashMap<K, u32>) -> (K, u32) {
    let nth = seen.entry(address.clone()).or_default();
    *nth += 1;
    (address, *nth)
}

/// Where each recorded region takes its cases from among `held`: the held
/// region the edit left alone at its lines, else the one at its address or
/// what the region around it took, landing where the edit's reading spares
/// its kind and overwritten where it does not. Without `change`, nothing lands.
// FIXME: the snapshot's `carried` in `record_coverage_recut.rs` pairs rows
// across an edit by the same rule, except that it seats by address first and
// withholds a disputed one; the two should share one pairing.
pub(crate) fn landed_through(held: &[Block], recorded: &[Block], owners: Option<&[u32]>, change: Option<&Edit>) -> Pairing {
    let mut lands = vec![-1; recorded.len()];
    let mut overwrote = vec![-1; recorded.len()];
    let Some(change) = change else { return Pairing { lands, overwrote, unread: true } };
    let mut seats: FxHashMap<(&str, i64, i64), Vec<i32>> = FxHashMap::default();
    for (at, block) in held.iter().enumerate() {
        if let Some((start, end)) = stays(change, block) {
            seats.entry((block.kind.as_str(), start, end)).or_default().push(at as i32);
        }
    }
    let mut taken: FxHashMap<(&str, i64, i64), usize> = FxHashMap::default();
    let seated: Vec<i32> = recorded
        .iter()
        .map(|block| {
            let key = (block.kind.as_str(), i64::from(block.start_line), i64::from(block.end_line));
            let nth = taken.entry(key).or_default();
            let found = seats.get(&key).and_then(|at| at.get(*nth)).copied().unwrap_or(-1);
            *nth += 1;
            found
        })
        .collect();
    let occupied: FxHashSet<i32> = seated.iter().copied().filter(|from| *from >= 0).collect();
    let top = held.iter().position(|block| block.kind == "module");
    let alike = addressed_alike(held.iter().map(address), recorded.iter().map(address));
    let mut held_seen = FxHashMap::default();
    let mut addressed = FxHashMap::default();
    for (at, block) in held.iter().enumerate() {
        addressed.insert(address_key(address(block), &mut held_seen), at);
    }
    let mut seen = FxHashMap::default();
    let mut decided = vec![-1_i32; recorded.len()];
    for (at, block) in recorded.iter().enumerate() {
        let key = address_key(address(block), &mut seen);
        if seated[at] >= 0 {
            (decided[at], lands[at]) = (seated[at], seated[at]);
            continue;
        }
        let was = match top {
            Some(top) if block.kind == "module" => Some(top),
            _ if alike(&block.name, &block.path) => addressed.get(&key).copied(),
            _ => None,
        };
        let owner = owners.and_then(|owners| owners.get(at)).copied().unwrap_or(NO_OWNER);
        decided[at] = match was {
            Some(was) if !occupied.contains(&(was as i32)) && held[was].kind == block.kind => was as i32,
            _ if owner == NO_OWNER => -1,
            _ => decided.get(owner as usize).copied().unwrap_or(-1),
        };
        if edit_reaches(change, &block.kind) {
            overwrote[at] = decided[at];
        } else {
            lands[at] = decided[at];
        }
    }
    Pairing { lands, overwrote, unread: false }
}

/// For each recorded region, the held region of the same cut it stands for,
/// or -1: by address, and by lines among siblings the cuts hold a different
/// number of times.
pub(crate) fn landing_of(recorded: &[Block], before: &[Block]) -> Vec<i32> {
    let counts = |blocks: &[Block]| {
        let mut counts: FxHashMap<(String, String), u32> = FxHashMap::default();
        for block in blocks {
            *counts.entry(address(block)).or_default() += 1;
        }
        counts
    };
    let (held_count, recorded_count) = (counts(before), counts(recorded));
    let key_of = |block: &Block, seen: &mut FxHashMap<(String, String, Option<(u32, u32)>), u32>| {
        let address = address(block);
        let lines = (held_count.get(&address) != recorded_count.get(&address)).then_some((block.start_line, block.end_line));
        address_key((address.0, address.1, lines), seen)
    };
    let mut seen = FxHashMap::default();
    let mut held_at = FxHashMap::default();
    for (at, block) in before.iter().enumerate() {
        held_at.insert(key_of(block, &mut seen), at);
    }
    seen.clear();
    recorded
        .iter()
        .map(|block| match held_at.get(&key_of(block, &mut seen)) {
            Some(at) if before[*at].kind == block.kind => *at as i32,
            _ => -1,
        })
        .collect()
}

/// Each held region a recorded one lands on, and the recorded one, ascending by held region.
fn landed_on(held: &[Block], recorded: &[Block]) -> Vec<(usize, usize)> {
    let mut to = FxHashMap::default();
    for (block, from) in landing_of(recorded, held).into_iter().enumerate() {
        if from >= 0 {
            to.insert(from as usize, block);
        }
    }
    let mut pairs: Vec<(usize, usize)> = to.into_iter().collect();
    pairs.sort_unstable();
    pairs
}

/// Whether `held` was cut at the text `recorded` was: every region both hold
/// an address for stands at the same lines in each.
pub(crate) fn cut_alike(held: &[Block], recorded: &[Block]) -> bool {
    landed_on(held, recorded)
        .into_iter()
        .all(|(from, block)| held[from].start_line == recorded[block].start_line && held[from].end_line == recorded[block].end_line)
}

/// Whether a case index's cut of a module stands at other text than a
/// snapshot's: not one cut of one text, and either a region both hold stands
/// at other lines, or both hold regions and share no address, since one text
/// cuts one set of addresses.
pub(crate) fn cut_apart(index: &[Block], snapshot: &[Block]) -> bool {
    let same = index.len() == snapshot.len()
        && index.iter().zip(snapshot).all(|(one, other)| {
            one.start_line == other.start_line && one.end_line == other.end_line && one.kind == other.kind && one.name == other.name && one.path == other.path
        });
    !same && (!cut_alike(index, snapshot) || (!index.is_empty() && !snapshot.is_empty() && landed_on(index, snapshot).is_empty()))
}

/// How `held` reads at the lines `recorded` stands its regions on.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Relined {
    /// Cut at the same text: `held` as it is.
    Same,
    /// Each kept held region, ascending, with the recorded region whose lines it takes.
    Kept(Vec<(usize, usize)>),
}

/// `held` at the lines `recorded` stands on, or `None` where `held` was cut at
/// another text whose numbering differs and cannot be carried onto this one.
pub(crate) fn relined(held: &[Block], recorded: &[Block]) -> Option<Relined> {
    if cut_alike(held, recorded) {
        return Some(Relined::Same);
    }
    if !same_numbering(held.iter().map(address), recorded.iter().map(address)) {
        return None;
    }
    Some(Relined::Kept(landed_on(held, recorded)))
}

/// Whether a held region went unmatched among siblings the two cuts hold a
/// different number of times.
pub(crate) fn strayed(held: &[Block], recorded: &[Block]) -> bool {
    let matched: FxHashSet<i32> = landing_of(recorded, held).into_iter().collect();
    let counts = |blocks: &[Block]| {
        let mut counts: FxHashMap<(String, String), u32> = FxHashMap::default();
        for block in blocks {
            *counts.entry(address(block)).or_default() += 1;
        }
        counts
    };
    let (held_count, recorded_count) = (counts(held), counts(recorded));
    held.iter().enumerate().any(|(at, block)| {
        let address = address(block);
        !matched.contains(&(at as i32)) && recorded_count.contains_key(&address) && held_count.get(&address) != recorded_count.get(&address)
    })
}

#[cfg(test)]
#[path = "case_layer_landing_tests.rs"]
mod tests;
