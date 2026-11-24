//! Charge the coverage's crossings for the regions a change reaches.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::crossing_sets::{decode_set, set_slice};
use crate::journey_read::{charged_line, holds_any, pairs, Region};
use crate::record_coverage::{Coverage, Text};
use crate::record_layout::LAYOUT;
use crate::source_query::RuntimeTree;

use super::super::{patch, Read};

#[derive(Clone, Copy, Eq, Hash, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(super) enum Reason<'a> {
    #[serde(rename_all = "camelCase")]
    Region {
        file: &'a str,
        name: &'a str,
        path: &'a str,
        start_line: u32,
        end_line: u32,
    },
    Precondition {
        name: &'a str,
    },
}

pub(super) struct Selection<'a, 'record> {
    coverage: &'record Coverage,
    text: &'a Text<'record>,
    selected: HashMap<u32, Vec<Reason<'record>>>,
    sets: HashMap<u32, Vec<u32>>,
    shadows: HashMap<u32, HashSet<String>>,
}

impl<'a, 'record> Selection<'a, 'record> {
    pub(super) fn new(coverage: &'record Coverage, text: &'a Text<'record>) -> Self {
        Self { coverage, text, selected: HashMap::new(), sets: HashMap::new(), shadows: HashMap::new() }
    }

    pub(super) fn charge(
        &mut self,
        tree: &RuntimeTree,
        file: &patch::File<'_>,
        rows: &[usize],
        read: &Read,
    ) -> Option<()> {
        let compared = match read {
            Read::Compared { verdict, .. } => verdict.as_str(),
            _ => "",
        };
        if compared == "none" {
            return Some(());
        }
        let body = compared == "bodies";
        let ranges = pairs(&file.change.ranges);
        // The raw line reader ignores insertion-only bindings. Read those
        // through the binding reader until it can distinguish them here.
        if !body && ranges.iter().any(|&range| file.insertion(range)) {
            return None;
        }
        let coverage = self.coverage;
        let layout = &LAYOUT.coverage;
        for &row in rows {
            let all: Vec<_> = coverage
                .blocks(row)
                .map(|at| Region {
                    at,
                    kind: coverage.block_kind[at].into(),
                    name: coverage.block_name[at],
                    path: coverage.block_path[at],
                    start: coverage.block_start[at],
                    end: coverage.block_end[at],
                    source: coverage.block_source[at] == 1,
                    loaded: false,
                    called: coverage.block_set[at],
                    overwritten: None,
                    owner: None,
                })
                .collect();
            let candidates: Vec<_> = all.iter().copied().filter(|region| holds_any(region, &ranges)).collect();
            let kind = |region: &Region| layout.block_kinds[region.kind as usize].as_str();
            let kinds: Vec<_> = candidates.iter().map(kind).collect();
            let mut gathered = Vec::new();
            let mut seen = HashSet::new();
            let mut charged = Vec::new();
            for range @ (start, end) in ranges.iter().copied() {
                if body
                    && file.insertion(range)
                    && end == start + 1
                    && !candidates
                        .iter()
                        .any(|region| kind(region) != "module" && region.start <= start && region.end >= end)
                {
                    continue;
                }
                if body && !candidates.iter().any(|region| holds_any(region, &[range])) {
                    continue;
                }
                for line in start..=end {
                    let held = charged_line(&candidates, &kinds, line, &mut charged);
                    gathered.extend(charged.iter().filter(|region| seen.insert(region.at)).copied());
                    if !held {
                        gathered.extend(
                            all.iter()
                                .filter(|region| region.start != layout.no_line && seen.insert(region.at))
                                .copied(),
                        );
                        break;
                    }
                }
            }
            let name = self.text.at(coverage.module_path[row]);
            for region in gathered.into_iter().filter(|region| !body || kind(region) != "module") {
                self.charge_block(tree, name, region.at)?;
            }
        }
        Some(())
    }

    pub(super) fn charge_whole(&mut self, tree: &RuntimeTree, file: &str, rows: &[usize]) -> Option<()> {
        for &row in rows {
            let name = self.text.at(self.coverage.module_path[row]);
            if name != file {
                return None;
            }
            for block in self.coverage.blocks(row) {
                self.charge_block(tree, name, block)?;
            }
        }
        Some(())
    }

    fn charge_block(&mut self, tree: &RuntimeTree, file: &'record str, block: usize) -> Option<()> {
        let coverage = self.coverage;
        let reason = Reason::Region {
            file,
            name: self.text.at(coverage.block_name[block]),
            path: self.text.at(coverage.block_path[block]),
            start_line: coverage.block_start[block],
            end_line: coverage.block_end[block],
        };
        let set = coverage.block_set[block];
        let loading = coverage.block_loaded_set[block];
        for id in [set, loading] {
            if let std::collections::hash_map::Entry::Vacant(entry) = self.sets.entry(id) {
                let bytes = set_slice(&coverage.set_bytes, &coverage.set_offsets, id).ok()?;
                entry.insert(decode_set(bytes, coverage.tests()).ok()?);
            }
        }
        let loaded = &self.sets[&loading];
        for &test in &self.sets[&set] {
            let file_loaded = loaded.binary_search(&test).is_ok();
            if file_loaded
                && self
                    .shadows
                    .entry(test)
                    .or_insert_with(|| {
                        let test = self.text.at(coverage.test_path[test as usize]);
                        tree.shadowed_by(test).into_iter().map(str::to_owned).collect()
                    })
                    .contains(file)
            {
                continue;
            }
            self.selected.entry(test).or_default().push(reason);
        }
        Some(())
    }

    pub(super) fn preconditions(&mut self, paths: &HashSet<&str>) {
        let coverage = self.coverage;
        let text = self.text;
        let wanted: HashSet<_> = (0..text.len() as u32).filter(|&id| paths.contains(text.at(id))).collect();
        if wanted.is_empty() {
            return;
        }
        for (test, offsets) in coverage.test_preconditions.windows(2).enumerate() {
            let own = coverage.test_path[test];
            let mut own_held = false;
            for &id in &coverage.precondition_name[offsets[0] as usize..offsets[1] as usize] {
                if wanted.contains(&id) {
                    self.selected.entry(test as u32).or_default().push(Reason::Precondition { name: text.at(id) });
                    own_held |= id == own;
                }
            }
            if !own_held && wanted.contains(&own) {
                self.selected.entry(test as u32).or_default().push(Reason::Precondition { name: text.at(own) });
            }
        }
    }

    pub(super) fn finish(self) -> (Vec<&'record str>, Vec<&'record str>, Vec<Selected<'record>>) {
        let sort = |tests: &mut Vec<&str>| tests.sort_unstable_by(|left, right| crate::order::code_unit(left, right));
        let mut whole = Vec::new();
        let mut incomplete = Vec::new();
        for (test, &id) in self.coverage.test_path.iter().enumerate() {
            let name = self.text.at(id);
            if self.coverage.test_complete[test] == 1 {
                whole.push(name)
            } else {
                incomplete.push(name)
            }
        }
        sort(&mut whole);
        sort(&mut incomplete);
        let mut entered: Vec<_> = self
            .selected
            .into_iter()
            .map(|(test, via)| Selected { test: self.text.at(self.coverage.test_path[test as usize]), via })
            .collect();
        entered.sort_by(|left, right| crate::order::code_unit(left.test, right.test));
        (whole, incomplete, entered)
    }
}

pub(super) struct Selected<'a> {
    pub(super) test: &'a str,
    pub(super) via: Vec<Reason<'a>>,
}
