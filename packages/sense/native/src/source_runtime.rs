//! Runtime file reach over the source tree, with the mock cuts named by parses.

use super::{breadth_first, SourceTree, EDGE_KINDS};
use crate::journey_graph::without_shadows;
use crate::journey_select::Importers;
use std::collections::HashSet;

pub(crate) struct RuntimeTree {
    tree: SourceTree,
    cuts: Vec<(u32, Vec<u32>)>,
}

pub(crate) struct RuntimeReach<'a> {
    tree: &'a RuntimeTree,
    reached: Vec<u8>,
    blocked: Vec<u8>,
    seed: u32,
}

impl RuntimeTree {
    pub(crate) fn new(tree: SourceTree, cuts: &[(String, Vec<String>)]) -> Self {
        let cuts = cuts
            .iter()
            .filter_map(|(file, targets)| {
                Some((tree.graph.id(file)?, targets.iter().filter_map(|target| tree.graph.id(target)).collect()))
            })
            .collect();
        Self { tree, cuts }
    }

    pub(crate) fn importers(&self, file: &str) -> Option<RuntimeReach<'_>> {
        let seed = self.tree.graph.id(file)?;
        let (reached, blocked) = self.affected(&[seed]);
        Some(RuntimeReach { tree: self, reached, blocked, seed })
    }

    /// A declaration charges its reader for a changed file anywhere in the
    /// declared target's runtime closure.
    pub(crate) fn declared_readers<'f>(&self, files: impl Iterator<Item = &'f str>) -> Vec<&str> {
        let graph = &self.tree.graph;
        let rows = &graph.backward;
        let seeds: Vec<_> = files.filter_map(|file| graph.id(file)).collect();
        if seeds.is_empty() {
            return Vec::new();
        }
        let mut seen = vec![false; graph.nodes()];
        let mut declared = HashSet::new();
        breadth_first(&rows.offset, &rows.target, &seeds, |from, next| {
            if let Some((target, edge)) = from {
                match EDGE_KINDS[rows.kind[edge] as usize] {
                    "depends" if target != next => {
                        declared.insert(next);
                    }
                    "type" => return false,
                    _ => {}
                }
            }
            !std::mem::replace(&mut seen[next as usize], true)
        });
        declared.into_iter().map(|id| graph.path(id)).collect()
    }

    /// Files that the harness entry covers by path or through runtime imports.
    pub(crate) fn before_reaches<'a>(&self, entry: &str, files: &HashSet<&'a str>) -> (bool, Vec<&'a str>) {
        let graph = &self.tree.graph;
        let rows = &graph.forward;
        let directory = entry.trim_end_matches('/');
        let within = |file: &str| {
            directory == "."
                || file == directory
                || file.strip_prefix(directory).is_some_and(|tail| tail.starts_with('/'))
        };
        let seeds = graph.id(entry).map_or_else(
            || (0..graph.nodes() as u32).filter(|&id| within(graph.path(id))).collect::<Vec<_>>(),
            |id| vec![id],
        );
        let mut seen = vec![false; graph.nodes()];
        breadth_first(&rows.offset, &rows.target, &seeds, |from, next| {
            if from.is_some_and(|(_, index)| EDGE_KINDS[rows.kind[index] as usize] == "type") {
                return false;
            }
            !std::mem::replace(&mut seen[next as usize], true)
        });
        let reached = files
            .iter()
            .copied()
            .filter(|file| within(file) || graph.id(file).is_some_and(|id| seen[id as usize]))
            .collect();
        (!seeds.is_empty(), reached)
    }

    /// The mocked files, and their dependencies that this test reaches only
    /// through a mock. A coverage crossing while the module loaded can belong
    /// to the mock's evaluation rather than to the test.
    pub(crate) fn shadowed_by(&self, test: &str) -> HashSet<&str> {
        let graph = &self.tree.graph;
        let Some(id) = graph.id(test) else { return HashSet::new() };
        let Some((_, cut)) = self.cuts.iter().find(|(file, _)| *file == id) else { return HashSet::new() };
        let rows = &graph.forward;
        let mut blocking = vec![false; graph.nodes()];
        for &node in cut {
            blocking[node as usize] = true;
        }
        let walk = |seeds: &[u32], avoid: &[bool]| {
            let mut seen = vec![false; graph.nodes()];
            breadth_first(&rows.offset, &rows.target, seeds, |from, next| {
                let at = next as usize;
                if avoid.get(at) == Some(&true)
                    || from.is_some_and(|(_, edge)| EDGE_KINDS[rows.kind[edge] as usize] == "type")
                {
                    return false;
                }
                !std::mem::replace(&mut seen[at], true)
            });
            seen
        };
        let kept = walk(&[id], &blocking);
        let mocked = walk(cut, &[]);
        (0..graph.nodes())
            .filter(|&at| blocking[at] || (mocked[at] && !kept[at]))
            .map(|at| graph.path(at as u32))
            .collect()
    }

    fn affected(&self, seeds: &[u32]) -> (Vec<u8>, Vec<u8>) {
        let graph = &self.tree.graph;
        without_shadows(graph.nodes(), &self.cuts, seeds, |backward, seeds, avoid| {
            let rows = if backward { &graph.backward } else { &graph.forward };
            let mut mask = vec![0; graph.nodes()];
            breadth_first(&rows.offset, &rows.target, seeds, |from, next| {
                let at = next as usize;
                if mask[at] != 0
                    || avoid[at] != 0
                    || from.is_some_and(|(_, edge)| EDGE_KINDS[rows.kind[edge] as usize] == "type")
                {
                    return false;
                }
                mask[at] = 1;
                true
            });
            mask
        })
    }
}

impl Importers for RuntimeTree {
    fn importers(&self, file: &str) -> Option<Vec<&str>> {
        let reach = RuntimeTree::importers(self, file)?;
        let graph = &self.tree.graph;
        Some(
            reach
                .reached
                .into_iter()
                .enumerate()
                .filter(|(_, reached)| *reached != 0)
                .map(|(id, _)| graph.path(id as u32))
                .collect(),
        )
    }
}

impl RuntimeReach<'_> {
    pub(crate) fn includes(&self, file: &str) -> bool {
        self.tree.tree.graph.id(file).is_some_and(|id| self.reached[id as usize] != 0)
    }

    /// A mock is evidence against ownership only when it accounts for the load
    /// and every other recorded case's route was read.
    pub(crate) fn owns_load<'a>(&self, files: impl Iterator<Item = &'a str>) -> bool {
        let graph = &self.tree.tree.graph;
        if !self.blocked.contains(&1) {
            return true;
        }
        let held = files.map(|file| graph.id(file)).collect::<Option<Vec<_>>>();
        let Some(held) = held else { return true };
        if held.iter().any(|&id| self.reached[id as usize] != 0)
            || !held.iter().any(|&id| self.blocked[id as usize] != 0)
        {
            return true;
        }
        let unknown: Vec<_> =
            graph.unknown.iter().enumerate().filter(|(_, unknown)| **unknown).map(|(id, _)| id as u32).collect();
        if unknown.is_empty() {
            return false;
        }
        let (unread, _) = self.tree.affected(&unknown);
        held.into_iter().any(|id| {
            unread[id as usize] != 0
                && !self.tree.cuts.iter().any(|(file, targets)| *file == id && targets.contains(&self.seed))
        })
    }
}
