//! A carried row cut again in the text its module has now.
//!
//! A runner's teardown reads the checkout: a module the run did not load, whose
//! text moved since the previous record cut it, has rows that are lines of text
//! nobody has any more. The caller cuts the text standing now and hands its
//! regions over as a record of their own, with no tests; each crossing is
//! carried onto the fresh region at its address (name, path and repeat) where
//! the kinds agree. A region the fresh cut gained takes the crossings of the
//! region around it, already decided, since arrival nests: every test that
//! reached the new text reached the region containing it.
//!
//! An occurrence names one region only where the two cuts hold the address as
//! many times and seated every counter it passes through alike. A fresh region
//! the row was cut without takes what the region around it took. One whose
//! address the row disputes, holding a sibling the fresh cut lacks or seating a
//! counter elsewhere, is decided by the caller ([`Disputed`]). The top level is
//! one region in every cut of a module, so it always takes the top level's
//! crossings, whatever its branches did.
//!
//! Nothing is cut again where the row was never measured, or its text did not
//! move. The crossings are mislaid, and the row is carried as it was with every
//! crosser owed a run, where the text does not cut.

use rustc_hash::FxHashMap;

use crate::record_coverage::{Coverage, Text};
use crate::record_coverage_columns::{Columns, Region};
use crate::record_coverage_address::{addressed, Standing};
use crate::record_layout::LAYOUT;

/// What each edit reached, by `path\0from\0to`.
pub(crate) type Readings = std::collections::HashMap<String, String>;

/// Whether the edit of `file` from text `from` to text `to` reached a region of
/// `kind`: it did unless the layout's `spared` names the kind under the edit's
/// reading, the rule the case index's carry (`reaches` in `edit-readings.ts`)
/// reads too.
pub(crate) fn reaches(readings: &Readings, file: &str, from: &str, to: &str, kind: u8) -> bool {
    let kind = &LAYOUT.coverage.block_kinds[usize::from(kind)];
    !readings
        .get(&format!("{file}\0{from}\0{to}"))
        .and_then(|reading| LAYOUT.coverage.spared.get(reading))
        .is_some_and(|kinds| kinds.contains(kind))
}

/// What cutting one carried row again decides, in the previous record's regions.
pub(crate) enum Recut {
    /// Carried as it is: its text did not move, or it was never measured.
    Kept,
    /// Carried as it is, every crosser owed a run: its crossings have no place in the new text.
    Mislaid,
    /// Written as the fresh row: per fresh region, the previous region whose
    /// crossings it takes, and the previous regions whose crossers are owed a
    /// run: the edit reached them, or a region inside them was withheld.
    Cut { from: Vec<Option<usize>>, owed: Vec<usize> },
}

/// What a fresh region whose address the row disputes takes.
#[derive(Clone, Copy)]
pub(crate) enum Disputed {
    /// What the region around it took: every test that reached it reached
    /// that region, so the superset is the only set that skips none of them.
    Inherit,
    /// Nothing, and nor does a region inside it: the row's crossings are not
    /// written where the row cannot say they belong, and the crossers of the
    /// region around it, any of whom may have run it, are owed a run.
    Withhold,
}

/// Row `row` of `previous`, cut again as row `module` of `fresh`. `reaches`
/// says whether the edit reached a region of a kind.
pub(crate) fn recut(
    (previous, ps): (&Coverage, Text),
    row: usize,
    (fresh, fs): (&Coverage, Text),
    module: usize,
    reaches: impl Fn(u8) -> bool,
) -> Recut {
    if previous.module_instrumented[row] != 1 || ps.at(previous.module_source[row]) == fs.at(fresh.module_source[module]) {
        return Recut::Kept;
    }
    carried((previous, ps), row, (fresh, fs), module, Disputed::Inherit, reaches)
}

/// Row `row` of `previous` carried onto row `module` of `fresh`, whatever text
/// each was cut from: [`Recut::Mislaid`] or [`Recut::Cut`], never kept.
pub(crate) fn carried(
    (previous, ps): (&Coverage, Text),
    row: usize,
    (fresh, fs): (&Coverage, Text),
    module: usize,
    disputed: Disputed,
    reaches: impl Fn(u8) -> bool,
) -> Recut {
    let address = |coverage: &Coverage, strings: Text, block: usize| (strings.at(coverage.block_name[block]).to_owned(), strings.at(coverage.block_path[block]).to_owned());
    if fresh.module_instrumented[module] != 1 {
        return Recut::Mislaid;
    }
    let standing = addressed(previous.blocks(row).map(|block| address(previous, ps, block)), fresh.blocks(module).map(|block| address(fresh, fs, block)));
    let top = previous.blocks(row).find(|block| is_top(previous.block_kind[*block]));
    let mut seen: FxHashMap<(&str, &str), u32> = FxHashMap::default();
    let mut held: FxHashMap<(&str, &str, u32), usize> = FxHashMap::default();
    for block in previous.blocks(row) {
        let at = (ps.at(previous.block_name[block]), ps.at(previous.block_path[block]));
        let nth = *seen.entry(at).and_modify(|nth| *nth += 1).or_insert(1);
        held.insert((at.0, at.1, nth), block);
    }
    let mut seen: FxHashMap<(&str, &str), u32> = FxHashMap::default();
    // By ordinal, the previous region each fresh region took; `owner` names
    // one the walk that numbered them opened first.
    let mut decided: FxHashMap<u32, Option<usize>> = FxHashMap::default();
    let (mut from, mut owed) = (Vec::with_capacity(fresh.blocks(module).len()), Vec::new());
    for block in fresh.blocks(module) {
        let at = (fs.at(fresh.block_name[block]), fs.at(fresh.block_path[block]));
        let nth = *seen.entry(at).and_modify(|nth| *nth += 1).or_insert(1);
        let (was, withheld) = if is_top(fresh.block_kind[block]) {
            (top, false)
        } else {
            match standing(at.0, at.1) {
                Standing::Alike => (held.get(&(at.0, at.1, nth)).copied(), false),
                Standing::Lacked => (None, false),
                Standing::Disputed => (None, matches!(disputed, Disputed::Withhold)),
            }
        };
        let was = was.filter(|was| previous.block_kind[*was] == fresh.block_kind[block]);
        let owner = fresh.block_owner[block];
        let around = if owner == LAYOUT.coverage.no_owner { None } else { decided.get(&owner).copied().flatten() };
        if let Some(around) = around.filter(|_| withheld) {
            // Its writer may have run it from the region around it, uncut.
            owed.push(around);
        }
        let taken = was.or(around.filter(|_| !withheld));
        decided.insert(fresh.block_ordinal[block], taken);
        let unmoved = was.is_some_and(|was| ps.at(previous.block_digest[was]) == fs.at(fresh.block_digest[block]));
        if let Some(taken) = taken.filter(|_| !unmoved && reaches(fresh.block_kind[block])) {
            owed.push(taken);
        }
        from.push(taken);
    }
    Recut::Cut { from, owed }
}

/// Whether a region of `kind` is a module's top level.
pub(crate) fn is_top(kind: u8) -> bool {
    LAYOUT.coverage.block_kinds[usize::from(kind)] == "module"
}

/// Row `module` of `fresh` written at `path`, its strings ranked by `ranks`:
/// each region's crossings and loaders are `sets` of the previous region it
/// took them from (`false` for crossings, `true` for loaders), or of none.
pub(crate) fn write_cut(
    out: &mut Columns,
    path: u32,
    (fresh, ranks): (&Coverage, &[u32]),
    module: usize,
    from: Vec<Option<usize>>,
    mut sets: impl FnMut(Option<usize>, bool) -> Result<u32, String>,
) -> Result<(), String> {
    out.module(path, ranks[fresh.module_source[module] as usize], fresh.blob_in(module, |id| ranks[id as usize]), true);
    for (block, held) in fresh.blocks(module).zip(from) {
        let start = fresh.block_start[block];
        out.region(Region {
            ordinal: fresh.block_ordinal[block],
            kind: fresh.block_kind[block],
            source: u8::from(fresh.block_source[block] == 1),
            owner: fresh.block_owner[block],
            digest: ranks[fresh.block_digest[block] as usize],
            name: ranks[fresh.block_name[block] as usize],
            path: ranks[fresh.block_path[block] as usize],
            start,
            end: if start == LAYOUT.coverage.no_line { LAYOUT.coverage.no_line } else { fresh.block_end[block] },
            called: sets(held, false)?,
            loaded: sets(held, true)?,
        });
    }
    Ok(())
}
