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
//! a recorded module in order, so every case's builder sees its modules rising.

use rustc_hash::FxHashMap;

use crate::case_lines::{decode, value_at, Builder, Lines};

pub(crate) struct LaidLines {
    held: Vec<Option<Lines>>,
    run: Vec<Option<Lines>>,
    held_source: Vec<bool>,
    lined: Vec<bool>,
    builders: Vec<Option<Builder>>,
    /// The held cases' segments by the held row they name, the output case beside each.
    carried: FxHashMap<u32, Vec<usize>>,
    seen: Vec<u32>,
    stamp: u32,
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
        Ok(Some(LaidLines { held, run, held_source, lined, builders: (0..count).map(|_| None).collect(), carried, seen: vec![0; count], stamp: 0 }))
    }

    /// The held module at `row`, carried as it was stored, written as the `module`-th.
    pub(crate) fn carried(&mut self, module: u32, row: u32) -> Result<(), String> {
        let Some(cases) = self.carried.get(&row) else { return Ok(()) };
        for at in cases {
            let (values, starts) = &self.held[*at].as_ref().expect("a carried case holds lines").segments[&row];
            self.builders[*at].get_or_insert_with(Builder::default).segment(module, values, starts)?;
        }
        Ok(())
    }

    /// A region of the `module`-th module written, recorded by the run as
    /// region `block` of its module `run_module`, entered by the cases
    /// `run_members`; and by the held cases of `held` at a region of a held
    /// row, where the held cut has one under it.
    pub(crate) fn recorded(&mut self, module: u32, block: u32, run_module: u32, run_members: &[u32], held: Option<(u32, u32, &[u32])>) -> Result<(), String> {
        self.stamp += 1;
        for at in run_members {
            let at = *at as usize;
            self.seen[at] = self.stamp;
            if self.lined[at] {
                let value = reached(value_at(self.run[at].as_ref().expect("a lined run case holds lines"), run_module, block))?;
                self.builders[at].get_or_insert_with(Builder::default).add(module, block, value)?;
            }
        }
        let Some((row, held_block, members)) = held else { return Ok(()) };
        for at in members {
            let at = *at as usize;
            if self.seen[at] == self.stamp || !self.lined[at] {
                continue;
            }
            let value = reached(value_at(self.held[at].as_ref().expect("a lined held case holds lines"), row, held_block))?;
            self.builders[at].get_or_insert_with(Builder::default).add(module, block, value)?;
        }
        Ok(())
    }

    /// Every output case's lines, in output order; an unlined case's are empty.
    pub(crate) fn finish(self) -> Vec<Vec<u8>> {
        let LaidLines { held, held_source, lined, builders, .. } = self;
        builders
            .into_iter()
            .enumerate()
            .map(|(at, builder)| {
                if !lined[at] {
                    return Vec::new();
                }
                // A carried module without a segment stands at the held fallback, so it stays the fallback.
                let fallback = if held_source[at] { held[at].as_ref().and_then(|lines| lines.fallback) } else { None };
                builder.unwrap_or_default().finish(fallback)
            })
            .collect()
    }
}

/// A crossed region's value; a case whose lines name no value for a region it
/// crossed was not written by a fold.
fn reached(value: Option<u64>) -> Result<u64, String> {
    value.ok_or_else(|| "not a variance-authority execution index".to_owned())
}
