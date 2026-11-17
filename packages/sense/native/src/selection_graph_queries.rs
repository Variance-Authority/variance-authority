//! Batched selection questions over one native graph; raw columns never leave it.
// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};
use napi_derive::napi;
use super::{within, SelectionGraph, SelectionNode, SelectionNodeInfo, State, KINDS, NODE_KINDS};
use super::walk::allowed;
use super::uses::SelectionEdgeUse;

#[napi(object)]
pub struct SelectionEdge { pub to: SelectionNodeInfo, pub kind: String }
#[napi(object)]
pub struct SelectionRow { pub id: u32, pub edges: Vec<SelectionEdge> }
#[napi(object)]
pub struct SelectionUseQuestion { pub importer: u32, pub target: u32 }
#[napi(object)]
pub struct SelectionBefore { pub entries: Vec<String>, pub files: Vec<String>, pub unread: Vec<String> }
#[napi(object)]
pub struct SelectionChain { pub file: String, pub trail: Vec<String> }
#[napi(object)]
pub struct SelectionBeyond { pub files: Vec<String>, pub chains: Vec<SelectionChain>, pub traced: Vec<String>, pub unplaced: Vec<String> }

#[napi]
impl SelectionGraph {
    #[napi]
    pub fn has_shadows(&self) -> bool { !self.state.shadow_names.is_empty() }
    #[napi]
    pub fn shadows(&self, tests: Vec<String>) -> Vec<Vec<String>> {
        tests.iter().map(|test| self.state.file(test).and_then(|id| self.state.shadow_names.get(&id).cloned()).unwrap_or_default()).collect()
    }
    #[napi]
    pub fn unknown(&self) -> Vec<SelectionNodeInfo> {
        let mut ids: Vec<_> = self.state.unknown.keys().copied().collect(); ids.sort_unstable();
        ids.into_iter().filter_map(|id| self.state.info(id)).collect()
    }
    #[napi]
    pub fn lookup(&self, nodes: Vec<SelectionNode>) -> Vec<Option<SelectionNodeInfo>> {
        nodes.iter().map(|node| self.state.id(node).and_then(|id| self.state.info(id))).collect()
    }
    #[napi]
    pub fn nodes(&self, ids: Vec<u32>) -> Vec<Option<SelectionNodeInfo>> { ids.into_iter().map(|id| self.state.info(id)).collect() }
    #[napi(catch_unwind)]
    pub fn list(&self, kind: Option<String>, dirs: Option<Vec<String>>, pattern: Option<String>) -> napi::Result<Vec<SelectionNodeInfo>> {
        let graph = &self.state;
        let kind = kind.as_deref().and_then(|kind| NODE_KINDS.iter().position(|known| *known == kind));
        let pattern = pattern.as_deref().map(regex::Regex::new).transpose().map_err(|error| napi::Error::from_reason(error.to_string()))?;
        Ok((0..graph.names.len()).filter(|&id|
            kind.is_none_or(|kind| graph.kinds[id] as usize == kind)
            && dirs.as_ref().is_none_or(|dirs| within(&graph.names[id], dirs))
            && pattern.as_ref().is_none_or(|pattern| pattern.is_match(&graph.names[id])))
            .filter_map(|id| graph.info(id as u32)).collect())
    }
    #[napi]
    pub fn sources(&self, files: Vec<String>) -> Vec<bool> { files.iter().map(|file| self.state.sources.contains(file)).collect() }
    #[napi]
    pub fn names(&self, files: Vec<String>) -> Vec<Option<String>> {
        let layers = self.state.source.layers();
        files.iter().map(|file| crate::chain_lookup::record(layers, file).and_then(|(_, (layer, row))|
            layers[layer].stored.optional(layers[layer].records.digest.at(row))).map(str::to_owned)).collect()
    }
    #[napi]
    pub fn rows(&self, ids: Vec<u32>, reverse: bool) -> Vec<SelectionRow> {
        let graph = &self.state;
        let adjacency = if reverse { &graph.dependents } else { &graph.depends };
        ids.into_iter().map(|id| SelectionRow { id, edges: adjacency.row(id)
            .filter_map(|(to, kind)| graph.info(to).map(|to| SelectionEdge { to, kind: KINDS[kind as usize].to_owned() })).collect() }).collect()
    }
    #[napi]
    pub fn uses(&self, edges: Vec<SelectionUseQuestion>) -> Vec<Option<SelectionEdgeUse>> {
        edges.into_iter().map(|edge| self.state.edge_use(edge.importer, edge.target)).collect()
    }
    #[napi]
    pub fn before(&self, entries: Vec<String>, sensed: Vec<String>) -> SelectionBefore { before(&self.state, entries, sensed) }
    #[napi]
    pub fn shadowed(&self, tests: Vec<String>) -> Vec<Vec<String>> { shadowed(&self.state, tests) }
    #[napi]
    pub fn declared_behind(&self, files: Vec<String>) -> Vec<SelectionNodeInfo> { declared_behind(&self.state, files) }
    #[napi]
    pub fn beyond(&self, packages: Vec<String>, moved: Vec<String>) -> SelectionBeyond { beyond(&self.state, packages, moved) }
}

fn runtime() -> [bool; 8] { std::array::from_fn(|kind| kind != 3) }

fn before(graph: &State, entries: Vec<String>, sensed: Vec<String>) -> SelectionBefore {
    let mut seeds = HashSet::new();
    let mut unread = Vec::new();
    for entry in &entries {
        if let Some(id) = graph.file(entry) { seeds.insert(id); continue }
        let mut found = false;
        for (id, name) in graph.names.iter().enumerate() {
            if graph.kinds[id] == 0 && within(name, std::slice::from_ref(entry)) { seeds.insert(id as u32); found = true; }
        }
        if !found { unread.push(entry.clone()); }
    }
    let avoid = graph.names.iter().enumerate().filter_map(|(id, name)|
        (graph.kinds[id] == 0 && !seeds.contains(&(id as u32)) && within(name, &sensed)).then_some(id as u32)).collect();
    let mut seeds: Vec<_> = seeds.into_iter().collect(); seeds.sort_unstable();
    let walk = graph.search(&seeds, false, &runtime(), &avoid, &HashMap::new());
    let files: Vec<_> = walk.nodes.into_iter().filter(|&id| graph.kinds[id as usize] == 0).map(|id| graph.names[id as usize].clone()).collect();
    SelectionBefore { entries, files, unread }
}

fn shadowed(graph: &State, tests: Vec<String>) -> Vec<Vec<String>> {
    let rows: Vec<_> = tests.iter().map(|test| {
        let Some(seed) = graph.file(test) else { return Vec::new() };
        let direct = graph.shadows.get(&seed).cloned().unwrap_or_default();
        let kept = graph.search(&[seed], false, &runtime(), &direct.iter().copied().collect(), &HashMap::new());
        let cut = graph.search(&direct, false, &runtime(), &HashSet::new(), &HashMap::new());
        let mut found: HashSet<String> = graph.shadow_names.get(&seed).cloned().unwrap_or_default().into_iter().collect();
        found.extend(cut.nodes.into_iter().filter(|&id| !kept.mask[id as usize] && graph.kinds[id as usize] == 0)
            .map(|id| graph.names[id as usize].clone()));
        let mut found: Vec<_> = found.into_iter().collect(); found.sort_unstable_by(|a,b| crate::order::code_unit(a,b)); found
    }).collect();
    rows
}

fn declared_behind(graph: &State, files: Vec<String>) -> Vec<SelectionNodeInfo> {
    let asked: HashSet<_> = files.iter().filter_map(|file| graph.file(file)).collect();
    let mut found = Vec::new();
    for id in 0..graph.names.len() as u32 {
        if !graph.dependents.row(id).any(|(_, kind)| kind == 7) { continue }
        let walk = graph.search(&[id], false, &runtime(), &HashSet::new(), &HashMap::new());
        if asked.iter().any(|&id| walk.mask[id as usize]) { found.extend(graph.info(id)); }
    }
    found
}

fn beyond(graph: &State, packages: Vec<String>, moved: Vec<String>) -> SelectionBeyond {
    let only_packages = allowed(Some(&["depends-on".to_owned()]));
    let mut files = HashSet::new();
    let mut chains = HashMap::new();
    let mut traced = Vec::new();
    for package in packages {
        let Some(seed) = graph.id(&SelectionNode { kind: "package".to_owned(), name: package.clone() }) else { continue };
        let walk = graph.search(&[seed], true, &only_packages, &HashSet::new(), &HashMap::new());
        let mut reached = false;
        for id in walk.nodes {
            for (from, kind) in graph.dependents.row(id) {
                if kind == 3 || kind == 6 || graph.kinds[from as usize] != 0 { continue }
                let file = &graph.names[from as usize]; files.insert(file.clone()); reached = true;
                chains.entry(file.clone()).or_insert_with(|| {
                    let mut trail = Vec::new(); let mut at = id as i64;
                    while at != -1 { trail.push(graph.names[at as usize].clone()); at = walk.parents[at as usize]; }
                    trail.reverse(); trail
                });
            }
        }
        if reached { traced.push(package); }
    }
    let mut unplaced = Vec::new();
    for manifest in moved {
        let dir = manifest.rsplit_once('/').map_or(".", |(dir, _)| dir).to_owned();
        let beside: Vec<_> = graph.names.iter().enumerate().filter(|(id, file)| graph.kinds[*id] == 0 && within(file, std::slice::from_ref(&dir)))
            .map(|(_, file)| file.clone()).collect();
        if beside.is_empty() { unplaced.push(manifest); } files.extend(beside);
    }
    let mut files: Vec<_> = files.into_iter().collect(); files.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    let mut chains: Vec<_> = chains.into_iter().map(|(file, trail)| SelectionChain { file, trail }).collect();
    chains.sort_unstable_by(|left, right| crate::order::code_unit(&left.file, &right.file));
    SelectionBeyond { files, chains, traced, unplaced }
}
