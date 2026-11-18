//! Native ownership of published path graphs and their query traversals.
// compass: variance-authority.reach.source-index

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use crate::segment::NONE;
use crate::stored::{Stored, U32s};

const KINDS: [&str; 8] = ["imports", "reexports", "dynamic", "type", "asset", "declared-in", "depends-on", "depends"];

struct Graph<'a> {
    paths: Vec<&'a str>,
    at: HashMap<&'a str, usize>,
    offsets: U32s<'a>,
    targets: U32s<'a>,
    kinds: &'a [u8],
    unknown: U32s<'a>,
    back: Vec<Vec<(usize, u8)>>,
}

impl<'a> Graph<'a> {
    fn open(bytes: &'a [u8]) -> Result<Self, String> {
        let stored = Stored::open_as(bytes, "variance-authority-source-tree", 2)?;
        let ids = stored.u32s("files.path")?;
        let unknown = stored.u32s("files.unknown")?;
        let targets = stored.u32s("edges.target")?;
        let kinds = stored.codes("edges.kind", (KINDS.len() - 1) as u8)?;
        let offsets = stored.offsets("edges.offset", ids.len(), targets.len())?;
        let strings = stored.u32s("strings.off")?.len().saturating_sub(1);
        if unknown.len() != ids.len() || kinds.len() != targets.len()
            || (0..ids.len()).any(|at| ids.at(at) as usize >= strings || (unknown.at(at) != NONE && unknown.at(at) as usize >= strings))
            || (0..targets.len()).any(|at| targets.at(at) as usize >= ids.len()) {
            return Err("source tree columns name rows outside their tables".into());
        }
        let paths: Vec<_> = (0..ids.len()).map(|at| stored.text(ids.at(at))).collect();
        if paths.windows(2).any(|pair| !crate::order::code_unit(pair[0], pair[1]).is_lt()) {
            return Err("source tree paths are not unique and ordered".into());
        }
        let at = paths.iter().enumerate().map(|(at, &path)| (path, at)).collect();
        let mut back = vec![Vec::new(); paths.len()];
        for from in 0..paths.len() {
            for edge in offsets.range(from) { back[targets.at(edge) as usize].push((from, kinds[edge])); }
        }
        Ok(Self { paths, at, offsets, targets, kinds, unknown, back })
    }

    fn edges(&self, at: usize, reverse: bool, mut visit: impl FnMut(usize, u8)) {
        if reverse { for &(to, kind) in &self.back[at] { visit(to, kind); } }
        else { for edge in self.offsets.range(at) { visit(self.targets.at(edge) as usize, self.kinds[edge]); } }
    }
}

self_cell::self_cell!(struct GraphStore { owner: Vec<u8>, #[covariant] dependent: Graph, });

#[napi]
pub struct SourceTreeReader {
    graph: Arc<GraphStore>,
    source: Option<Arc<crate::help_publish::Opened>>,
}

impl SourceTreeReader {
    pub(crate) fn open(bytes: Vec<u8>) -> Result<Self, String> {
        Ok(Self { graph: Arc::new(GraphStore::try_new(bytes, |bytes| Graph::open(bytes))?), source: None })
    }
    pub(crate) fn with_source(mut self, source: Option<Arc<crate::help_publish::Opened>>) -> Self { self.source = source; self }
}

#[napi(catch_unwind)]
pub fn open_source_tree(bytes: Buffer) -> napi::Result<SourceTreeReader> {
    SourceTreeReader::open(bytes.to_vec()).map_err(napi::Error::from_reason)
}

#[napi]
impl SourceTreeReader {
    #[napi]
    pub fn files(&self) -> Vec<String> { self.graph.borrow_dependent().paths.iter().map(|path| (*path).to_owned()).collect() }

    #[napi]
    pub fn unknown_among(&self, files: Vec<String>) -> Vec<String> {
        let graph = self.graph.borrow_dependent();
        let mut found: Vec<_> = files.into_iter().filter(|file| graph.at.get(file.as_str()).is_some_and(|&at| graph.unknown.at(at) != NONE)).collect();
        found.sort_by(|a, b| crate::order::code_unit(a, b));
        found.dedup(); found
    }

    #[napi(catch_unwind)]
    pub fn query_names(&self, operands: Vec<crate::source_names::NamesOperand>) -> napi::Result<crate::source_names::NamesAnswer> {
        let source = self.source.as_ref().ok_or_else(|| napi::Error::from_reason("source names were not retained with this tree"))?;
        crate::source_names::query(source.layers(), operands, &self.graph.borrow_dependent().paths).map_err(napi::Error::from_reason)
    }

    #[napi]
    pub fn walk(&self, seeds: Vec<String>, reverse: bool, weighted: bool) -> SourceTreeWalk {
        let graph = self.graph.borrow_dependent();
        let mut distance = vec![NONE; graph.paths.len()];
        let mut parents = vec![NONE; graph.paths.len()];
        let mut kinds = vec![0; graph.paths.len()];
        let seeds: Vec<_> = seeds.iter().filter_map(|seed| graph.at.get(seed.as_str()).copied()).collect();
        let mut found = Vec::new();
        if weighted {
            let mut queue = Costs::default();
            for seed in seeds { if distance[seed] == NONE { distance[seed] = 0; queue.push(seed, 0u32); } }
            while let Some((at, paid)) = queue.pop() {
                if distance[at] != paid { continue; }
                found.push(at);
                graph.edges(at, reverse, |to, kind| {
                    let (from_path, to_path) = if reverse { (graph.paths[to], graph.paths[at]) } else { (graph.paths[at], graph.paths[to]) };
                    let next = paid.saturating_add(cost(from_path, to_path));
                    if next < distance[to] { distance[to] = next; parents[to] = at as u32; kinds[to] = kind; queue.push(to, next); }
                    else if next == distance[to] && parents[to] == at as u32 && kinds[to] == 3 && kind != 3 { kinds[to] = kind; }
                });
            }
        } else {
            let mut queue = VecDeque::new();
            for seed in seeds { if distance[seed] == NONE { distance[seed] = 0; queue.push_back(seed); } }
            while let Some(at) = queue.pop_front() {
                graph.edges(at, reverse, |to, kind| {
                    if distance[to] == NONE { distance[to] = distance[at] + 1; parents[to] = at as u32; kinds[to] = kind; queue.push_back(to); }
                    else if parents[to] == at as u32 && kinds[to] == 3 && kind != 3 { kinds[to] = kind; }
                });
            }
        }
        if !weighted { found = (0..distance.len()).filter(|&at| distance[at] != NONE).collect(); }
        SourceTreeWalk { graph: Arc::clone(&self.graph), distance, parents, kinds, found }
    }
}

/// Cost-only heap: equal priorities keep the same finalization order as the explicit-record Tree.
#[derive(Default)]
struct Costs(Vec<(usize, u32)>);

impl Costs {
    fn push(&mut self, node: usize, cost: u32) {
        self.0.push((node, cost));
        let mut at = self.0.len() - 1;
        while at > 0 {
            let parent = (at - 1) / 2;
            if self.0[parent].1 <= self.0[at].1 { break; }
            self.0.swap(parent, at); at = parent;
        }
    }

    fn pop(&mut self) -> Option<(usize, u32)> {
        if self.0.is_empty() { return None; }
        let first = self.0.swap_remove(0);
        let mut at = 0;
        loop {
            let (left, right) = (at * 2 + 1, at * 2 + 2);
            let mut least = at;
            if left < self.0.len() && self.0[left].1 < self.0[least].1 { least = left; }
            if right < self.0.len() && self.0[right].1 < self.0[least].1 { least = right; }
            if least == at { break; }
            self.0.swap(at, least); at = least;
        }
        Some(first)
    }
}

fn installed(path: &str) -> &str {
    let Some(at) = path.rfind("node_modules/") else { return "" };
    let start = at + "node_modules/".len();
    let mut parts = path[start..].split('/');
    let first = parts.next().unwrap_or("");
    let end = start + first.len() + if first.starts_with('@') { 1 + parts.next().unwrap_or("").len() } else { 0 };
    &path[..end.min(path.len())]
}

fn cost(from: &str, to: &str) -> u32 {
    if installed(from) != installed(to) { return 8; }
    let from = from.rsplit_once('/').map_or("", |(dir, _)| dir);
    let to = to.rsplit_once('/').map_or("", |(dir, _)| dir);
    let above = |higher: &str, lower: &str| higher.is_empty() || higher == lower || lower.strip_prefix(higher).is_some_and(|tail| tail.starts_with('/'));
    if above(from, to) { 2 } else if above(to, from) { 4 } else { 3 }
}

#[napi]
pub struct SourceTreeWalk { graph: Arc<GraphStore>, distance: Vec<u32>, parents: Vec<u32>, kinds: Vec<u8>, found: Vec<usize> }

#[napi(object)]
pub struct TreeLink { pub file: String, pub kind: Option<String> }

#[napi]
impl SourceTreeWalk {
    #[napi]
    pub fn files(&self) -> Vec<String> { let graph = self.graph.borrow_dependent(); self.found.iter().map(|&at| graph.paths[at].to_owned()).collect() }
    #[napi]
    pub fn distances(&self) -> Vec<u32> { self.found.iter().map(|&at| self.distance[at]).collect() }
    #[napi]
    pub fn chain(&self, file: String) -> Vec<TreeLink> {
        let graph = self.graph.borrow_dependent();
        let Some(&start) = graph.at.get(file.as_str()).filter(|&&at| self.distance[at] != NONE) else { return Vec::new() };
        let mut at = start;
        let mut links = Vec::new();
        loop {
            let parent = self.parents[at];
            links.push(TreeLink { file: graph.paths[at].to_owned(), kind: (parent != NONE).then(|| KINDS[self.kinds[at] as usize].to_owned()) });
            if parent == NONE { break; }
            at = parent as usize;
        }
        links
    }
}

#[cfg(test)]
#[path = "source_tree_read_tests.rs"]
mod tests;
