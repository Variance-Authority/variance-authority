//! A resumable native worklist; readers receive one independent frontier at a time.
// compass: variance-authority.reach.relations
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use napi_derive::napi;
use super::{SelectionGraph, SelectionNodeInfo, State};

#[derive(Clone)]
#[napi(object)]
pub struct SelectionName { pub name: String, pub origin: String }
#[derive(Clone)]
#[napi(object)]
pub struct SelectionCarry { pub whole: bool, pub names: Vec<SelectionName> }
#[napi(object)]
pub struct SelectionFront { pub node: SelectionNodeInfo, pub carry: SelectionCarry, pub trail: Vec<SelectionNodeInfo> }
#[napi(object)]
pub struct SelectionReply { pub id: u32, pub carry: SelectionCarry }

/// Only the currently asked frontier crosses the boundary; held names and parents stay here.
#[napi]
pub struct SelectionFrontier {
    graph: Arc<State>, held: HashMap<u32, Option<HashSet<String>>>,
    parents: HashMap<u32, u32>, pending: Vec<(u32, SelectionCarry)>,
    files_only: bool, depends_whole: bool,
}

#[napi]
impl SelectionGraph {
    #[napi]
    pub fn importer_frontier(&self, seed: u32, carry: SelectionCarry, seeds_hold: bool, files_only: bool, depends_whole: bool) -> SelectionFrontier {
        let mut walk = SelectionFrontier { graph: Arc::clone(&self.state), held: HashMap::new(), parents: HashMap::new(),
            pending: Vec::new(), files_only, depends_whole };
        if (seed as usize) < walk.graph.names.len() {
            walk.held.insert(seed, if seeds_hold && carry.whole { None } else { Some(if seeds_hold { carry.names.iter().map(|name| name.name.clone()).collect() } else { HashSet::new() }) });
            walk.spread(seed, carry);
        }
        walk
    }
}

impl SelectionFrontier {
    fn spread(&mut self, from: u32, carry: SelectionCarry) {
        if !carry.whole && carry.names.is_empty() { return }
        for (to, kind) in self.graph.dependents.row(from) {
            if kind == 3 || (self.files_only && self.graph.kinds[to as usize] != 0) { continue }
            if self.held.get(&to).is_some_and(Option::is_none) { continue }
            let mut next = if self.depends_whole && kind == 7 { SelectionCarry { whole: true, names: Vec::new() } } else { carry.clone() };
            let unseen = !self.held.contains_key(&to);
            if next.whole { self.held.insert(to, None); }
            else {
                let held = self.held.entry(to).or_insert_with(|| Some(HashSet::new())).as_mut().expect("whole entries stop before this point");
                next.names.retain(|name| held.insert(name.name.clone()));
                if next.names.is_empty() { continue }
            }
            if unseen { self.parents.insert(to, from); }
            self.pending.push((to, next));
        }
    }
}

#[napi]
impl SelectionFrontier {
    #[napi]
    pub fn frontier(&self) -> Vec<SelectionFront> {
        self.pending.iter().filter_map(|(id, carry)| {
            let mut trail = Vec::new(); let mut at = *id;
            let mut seen = HashSet::new();
            loop {
                if !seen.insert(at) { break }
                trail.extend(self.graph.info(at));
                let Some(&parent) = self.parents.get(&at) else { break }; at = parent;
            }
            trail.reverse();
            Some(SelectionFront { node: self.graph.info(*id)?, carry: carry.clone(), trail })
        }).collect()
    }
    #[napi]
    pub fn advance(&mut self, replies: Vec<SelectionReply>) -> napi::Result<()> {
        if replies.len() != self.pending.len() || replies.iter().zip(&self.pending).any(|(reply, (id, _))| reply.id != *id) {
            return Err(napi::Error::from_reason("the replies must answer the current importer frontier in order"));
        }
        self.pending.clear();
        for reply in replies { self.spread(reply.id, reply.carry); }
        Ok(())
    }
}
