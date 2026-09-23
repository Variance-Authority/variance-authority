//! The file graph `relationsFor` built, walked on this side of the boundary.
//!
//! The scan owns the graph and builds it; this module only walks what it is
//! handed, so a selection over a journey file never crosses back into
//! JavaScript per changed file. The walks are the ones `@variance-authority/core`
//! states and are ported, not reinterpreted: `affectedBy` with its shadow repeat
//! (`relate/records.ts`), the breadth-first search over one direction
//! (`relate/reach.ts`). A difference between the two is a defect in
//! one of them, and `journey-select.test.ts` holds them to the same answers.

use std::collections::{HashMap, HashSet};

use napi::bindgen_prelude::{Uint32Array, Uint8Array};
use napi_derive::napi;

/// One file's mocks: the files its run never reaches.
#[napi(object)]
pub struct JourneyShadow {
    pub file: String,
    pub shadows: Vec<String>,
}

/// `Relations`, flattened to the columns the walks read.
#[napi(object, object_to_js = false)]
pub struct JourneyGraph {
    /// Node names by id.
    pub names: Vec<String>,
    /// `NODE_KINDS` index per node; `0` is a file.
    pub kinds: Uint8Array,
    pub depends_offset: Uint32Array,
    pub depends_target: Uint32Array,
    pub depends_kind: Uint8Array,
    pub dependents_offset: Uint32Array,
    pub dependents_target: Uint32Array,
    pub dependents_kind: Uint8Array,
    /// The `EDGE_KINDS` indices a runtime walk follows (`RUNTIME_EDGES`).
    pub through: Vec<u32>,
    pub shadows: Vec<JourneyShadow>,
}

const FILE: u8 = 0;
const PACKAGE: u8 = 2;

struct Adjacency<'a> {
    offset: &'a [u32],
    target: &'a [u32],
    kind: &'a [u8],
}

pub(crate) struct Graph<'a> {
    names: &'a [String],
    kinds: &'a [u8],
    depends: Adjacency<'a>,
    dependents: Adjacency<'a>,
    allowed: [bool; 256],
    files: HashMap<&'a str, u32>,
    packages: HashMap<&'a str, u32>,
    shadows: &'a [JourneyShadow],
}

impl<'a> Graph<'a> {
    pub fn new(graph: &'a JourneyGraph) -> Result<Graph<'a>, String> {
        let nodes = graph.names.len();
        let adjacency = |offset: &'a Uint32Array, target: &'a Uint32Array, kind: &'a Uint8Array| {
            let (offset, target, kind): (&[u32], &[u32], &[u8]) = (offset, target, kind);
            let valid = offset.len() == nodes + 1
                && target.len() == kind.len()
                && offset.windows(2).all(|pair| pair[0] <= pair[1])
                && offset.last().is_some_and(|last| *last as usize == target.len())
                && target.iter().all(|next| (*next as usize) < nodes);
            valid.then_some(Adjacency { offset, target, kind })
        };
        let depends = adjacency(&graph.depends_offset, &graph.depends_target, &graph.depends_kind)
            .ok_or_else(|| "graph dependencies are invalid".to_owned())?;
        let dependents = adjacency(&graph.dependents_offset, &graph.dependents_target, &graph.dependents_kind)
            .ok_or_else(|| "graph dependents are invalid".to_owned())?;
        let kinds: &[u8] = &graph.kinds;
        if kinds.len() != nodes {
            return Err("graph kinds disagree with its names".to_owned());
        }
        let mut allowed = [false; 256];
        for kind in &graph.through {
            if let Some(slot) = allowed.get_mut(*kind as usize) {
                *slot = true;
            }
        }
        let of_kind = |kind: u8| {
            (0..nodes)
                .filter(|id| kinds[*id] == kind)
                .map(|id| (graph.names[id].as_str(), id as u32))
                .collect::<HashMap<_, _>>()
        };
        let files = of_kind(FILE);
        let packages = of_kind(PACKAGE);
        Ok(Graph {
            names: &graph.names,
            kinds,
            depends,
            dependents,
            allowed,
            files,
            packages,
            shadows: &graph.shadows,
        })
    }

    fn file(&self, name: &str) -> Option<u32> {
        self.files.get(name).copied()
    }

    /// Breadth-first from every seed at once, never entering an avoided node.
    fn search(&self, adjacency: &Adjacency, seeds: &[u32], avoid: &[u8]) -> Vec<u8> {
        let nodes = self.names.len();
        let mut mask = vec![0u8; nodes];
        let mut queue: Vec<u32> = Vec::new();
        for &seed in seeds {
            let at = seed as usize;
            if at >= nodes || mask[at] == 1 || avoid.get(at) == Some(&1) {
                continue;
            }
            mask[at] = 1;
            queue.push(seed);
        }
        let mut head = 0;
        while head < queue.len() {
            let node = queue[head] as usize;
            head += 1;
            for at in adjacency.offset[node] as usize..adjacency.offset[node + 1] as usize {
                if !self.allowed[adjacency.kind[at] as usize] {
                    continue;
                }
                let next = adjacency.target[at] as usize;
                if mask[next] == 1 || avoid.get(next) == Some(&1) {
                    continue;
                }
                mask[next] = 1;
                queue.push(next as u32);
            }
        }
        mask
    }

    fn avoiding(&self, ids: &[u32]) -> Vec<u8> {
        let mut avoid = vec![0u8; self.names.len()];
        for id in ids {
            avoid[*id as usize] = 1;
        }
        avoid
    }

    /// `affectedBy(relations, [file]).files`, or `None` where that call reports
    /// the file `missing`.
    pub fn importers(&self, file: &str) -> Option<Vec<&'a str>> {
        Some(self.reached(self.file(file)?))
    }

    /// `affectedBy(relations, [{ kind: 'package', name }]).files`: every file
    /// whose runtime imports reach the package, or `None` when nothing here
    /// names it.
    pub fn package_importers(&self, name: &str) -> Option<Vec<&'a str>> {
        Some(self.reached(self.packages.get(name).copied()?))
    }

    fn reached(&self, seed: u32) -> Vec<&'a str> {
        let mask = self.unshadowed(&[seed]);
        (0..self.names.len())
            .filter(|id| mask[*id] == 1 && self.kinds[*id] == FILE)
            .map(|id| self.names[id].as_str())
            .collect()
    }

    /// The walk against the arrows with every file left out whose own shadows
    /// cut every trail to it, repeated until a walk finds no new such file.
    fn unshadowed(&self, seeds: &[u32]) -> Vec<u8> {
        let mut avoid = vec![0u8; self.names.len()];
        let mut mask = self.search(&self.dependents, seeds, &avoid);
        if self.shadows.is_empty() {
            return mask;
        }
        let seeded = self.avoiding(seeds);
        let mut decided: HashSet<u32> = HashSet::new();
        loop {
            let mut found = 0;
            for row in self.shadows {
                let Some(id) = self.file(&row.file) else { continue };
                let at = id as usize;
                if mask[at] != 1 || seeded[at] == 1 || decided.contains(&id) {
                    continue;
                }
                let cut: Vec<u32> = row
                    .shadows
                    .iter()
                    .filter_map(|shadow| self.file(shadow))
                    .filter(|target| mask[*target as usize] == 1)
                    .collect();
                if cut.is_empty() {
                    continue;
                }
                decided.insert(id);
                let forward = self.search(&self.depends, &[id], &self.avoiding(&cut));
                if forward.iter().zip(&seeded).any(|(reached, seed)| *reached == 1 && *seed == 1) {
                    continue;
                }
                avoid[at] = 1;
                found += 1;
            }
            if found == 0 {
                return mask;
            }
            mask = self.search(&self.dependents, seeds, &avoid);
        }
    }
}
