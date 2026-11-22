//! The before layer: an index cut to the cases of the files a run announced.
//!
//! Regions keep the shape they were recorded with, and no region says it ran
//! while its module loaded: that flag belongs to every file that imported the
//! module, not to these cases, and a comparison of what these cases entered
//! must not read it as theirs. A module the run recorded from the text the
//! index names it at is read at the lines that run recorded.

use rustc_hash::{FxHashMap, FxHashSet};

use crate::case_shard::{Inventory, Shard};
use crate::journey_record::{kept_owners, Block};
use crate::order::code_unit;

use super::case_layer::{placed, pool_of, write, Case};
use super::case_layer_landing::{relined, strayed, Relined};
use super::case_layer_modules::{carry, module_of, Laid, Layer};
use super::case_layer_sets::{Translation, EMPTY};

/// `cut` held to the cases of `ran_files`. `recorded_of` names, for a module
/// row, the cut a run recorded it at, when that cut is of the text the row is
/// named at; a module whose lines cannot be carried onto it is named in `unlined`.
pub(crate) fn before_run<'a>(
    cut: &Shard,
    cuts: &[Inventory],
    ran_files: &FxHashSet<&str>,
    recorded_of: impl Fn(usize) -> Option<(&'a str, &'a [Block])>,
    unlined: &mut Vec<String>,
) -> Result<(Vec<u8>, Vec<String>), String> {
    let kept_rows: Vec<bool> = cut.tests.iter().map(|test| ran_files.contains(test.file.as_str())).collect();
    let order: Vec<Case> = (0..cut.tests.len()).filter(|row| kept_rows[*row]).map(Case::Held).collect();
    let at: FxHashMap<&str, usize> = order
        .iter()
        .enumerate()
        .map(|(at, case)| match case {
            Case::Held(row) => (cut.tests[*row].id.as_str(), at),
            Case::Run(_) => unreachable!("a before layer holds held cases only"),
        })
        .collect();
    let place = placed(cut, &at, |row| !kept_rows[row])?;
    let mut layer = Layer { sets: Translation::new(order.len()), from_held: Translation::from(pool_of(cut), place), lines: None, ran: EMPTY };
    let mut laid: Vec<(&str, Laid)> = Vec::new();
    for (row, module) in cut.modules.iter().enumerate() {
        let held = &cuts[row];
        let kept = match recorded_of(row) {
            None => layer.carried_row(module, held, true)?,
            Some((file, recorded)) => match relined(&held.blocks, recorded) {
                None => {
                    unlined.push(file.to_owned());
                    layer.carried_row(module, held, true)?
                }
                Some(Relined::Same) => {
                    if strayed(&held.blocks, recorded) {
                        unlined.push(file.to_owned());
                    }
                    layer.carried_row(module, held, true)?
                }
                Some(Relined::Kept(pairs)) => relaid(&mut layer, module, held, recorded, &pairs)?,
            },
        };
        if let Some(kept) = kept {
            laid.push((&module.file, kept));
        }
    }
    laid.sort_by(|left, right| code_unit(left.0, right.0));
    let (modules, laid): (Vec<String>, Vec<Laid>) = laid.into_iter().map(|(file, laid)| (file.to_owned(), laid)).unzip();
    Ok((write(cut, None, &order, &laid, layer.sets, None, cuts.iter().any(|cut| cut.owners.is_some()))?, modules))
}

/// The held module at the lines `recorded` stands its regions on: each kept
/// held region, ascending, at the lines of the recorded region it pairs with.
fn relaid(layer: &mut Layer<'_>, module: &crate::case_shard::ShardModule, held: &Inventory, recorded: &[Block], pairs: &[(usize, usize)]) -> Result<Option<Laid>, String> {
    let blocks: Vec<Block> = pairs
        .iter()
        .map(|(from, to)| Block { start_line: recorded[*to].start_line, end_line: recorded[*to].end_line, ..held.blocks[*from].clone() })
        .collect();
    let called: Vec<u32> = pairs.iter().map(|(from, _)| module.called[*from]).collect();
    let overwritten: Vec<u32> = if module.overwritten.is_empty() { Vec::new() } else { pairs.iter().map(|(from, _)| module.overwritten[*from]).collect() };
    let mut positions = vec![None; held.blocks.len()];
    for (kept, (from, _)) in pairs.iter().enumerate() {
        positions[*from] = Some(kept as u32);
    }
    let owners = held.owners.as_deref().map(|owners| kept_owners(owners, &positions));
    let Some((called, loaded, overwritten)) = carry(&mut layer.sets, &mut layer.from_held, &called, vec![false; pairs.len()], &overwritten)? else {
        return Ok(None);
    };
    Ok(Some(Laid { module: module_of(&module.file, blocks, owners), called, loaded, overwritten }))
}
