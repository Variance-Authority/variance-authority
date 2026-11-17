//! Runtime and moved-name reach, including each test's own transitive mock cut.
// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet, VecDeque};
use napi_derive::napi;
use super::{SelectionGraph, SelectionNode, SelectionNodeInfo, State, KINDS};

#[derive(Clone)]
#[napi(object)]
pub struct SelectionMoved { pub file: String, pub names: Vec<String> }
#[napi(object)]
pub struct SelectionWalkOptions {
    pub seeds: Vec<SelectionNode>,
    pub reverse: bool,
    pub through: Option<Vec<String>>,
    pub avoid: Vec<SelectionNode>,
    pub moved: Vec<SelectionMoved>,
    pub shadows: bool,
}
#[napi(object)]
pub struct SelectionParent { pub id: u32, pub parent: i64 }
#[napi(object)]
pub struct SelectionWalk {
    pub nodes: Vec<SelectionNodeInfo>, pub parents: Vec<SelectionParent>, pub missing: Vec<String>, pub shadowed: Vec<String>,
}

#[napi]
impl SelectionGraph {
    #[napi]
    pub fn walk(&self, options: SelectionWalkOptions) -> SelectionWalk { self.state.walk(options) }
}

#[derive(Clone)]
enum Carry { Whole, Names(HashSet<String>) }
pub(super) struct Walk { pub nodes: Vec<u32>, pub parents: Vec<i64>, pub mask: Vec<bool>, pub shadowed: Vec<u32> }

impl State {
    pub(super) fn search(&self, seeds: &[u32], reverse: bool, allowed: &[bool; 8], avoid: &HashSet<u32>, moved: &HashMap<u32, Vec<String>>) -> Walk {
        let mut held: Vec<Option<Carry>> = vec![None; self.names.len()];
        let mut parents = vec![-1; self.names.len()];
        let mut queue = VecDeque::new();
        for &seed in seeds {
            if avoid.contains(&seed) || seed as usize >= held.len() { continue }
            let carry = moved.get(&seed).map_or(Carry::Whole, |names| Carry::Names(names.iter().cloned().collect()));
            if merge(&mut held[seed as usize], carry) { queue.push_back(seed); }
        }
        let edges = if reverse { &self.dependents } else { &self.depends };
        while let Some(from) = queue.pop_front() {
            let carry = held[from as usize].clone().expect("queued nodes hold a carry");
            for (to, kind) in edges.row(from) {
                if !allowed[kind as usize] || avoid.contains(&to) || matches!(held[to as usize], Some(Carry::Whole)) { continue }
                let next = if reverse { self.arrive(to, from, kind, &carry) } else { Carry::Whole };
                if matches!(&next, Carry::Names(names) if names.is_empty()) { continue }
                let unseen = held[to as usize].is_none();
                if merge(&mut held[to as usize], next) {
                    if unseen { parents[to as usize] = from as i64; }
                    queue.push_back(to);
                }
            }
        }
        let mask: Vec<_> = held.iter().map(Option::is_some).collect();
        let nodes = mask.iter().enumerate().filter_map(|(id, &seen)| seen.then_some(id as u32)).collect();
        Walk { nodes, parents, mask, shadowed: Vec::new() }
    }

    fn arrive(&self, importer: u32, target: u32, kind: u8, held: &Carry) -> Carry {
        let Carry::Names(names) = held else { return Carry::Whole };
        if kind != 0 && kind != 1 { return Carry::Whole }
        let Some(used) = self.edge_use(importer, target) else { return Carry::Whole };
        if kind == 0 {
            return used.imports.map_or(Carry::Whole, |imports| {
                if imports.iter().any(|name| names.contains(name)) { Carry::Whole } else { Carry::Names(HashSet::new()) }
            });
        }
        let Some(passes) = used.reexports else { return Carry::Whole };
        let mut out = HashSet::new();
        for pair in passes {
            let (imported, exported) = (&pair[0], &pair[1]);
            if imported == "*" && exported == "*" { out.extend(names.iter().filter(|name| name.as_str() != "default").cloned()); }
            else if imported == "*" || names.contains(imported) { out.insert(exported.clone()); }
        }
        Carry::Names(out)
    }

    pub(super) fn walk(&self, options: SelectionWalkOptions) -> SelectionWalk {
        let missing: Vec<_> = options.seeds.iter().filter(|node| self.id(node).is_none()).map(|node| node.name.clone()).collect();
        let seeds: Vec<_> = options.seeds.iter().filter_map(|node| self.id(node)).collect();
        let mut avoid: HashSet<_> = options.avoid.iter().filter_map(|node| self.id(node)).collect();
        let allowed = allowed(options.through.as_deref());
        let moved: HashMap<_, _> = options.moved.into_iter().filter_map(|moved| Some((self.file(&moved.file)?, moved.names))).collect();
        let mut walk = self.search(&seeds, options.reverse, &allowed, &avoid, &moved);
        if options.shadows && options.reverse {
            let seeded: HashSet<_> = seeds.iter().copied().collect();
            let mut decided = HashSet::new();
            let mut rows: Vec<_> = self.shadows.iter().collect(); rows.sort_unstable_by_key(|(id, _)| **id);
            let mut shadowed = Vec::new();
            loop {
                let mut found = 0;
                for (&id, shadows) in &rows {
                    if !walk.mask[id as usize] || seeded.contains(&id) || decided.contains(&id) { continue }
                    let cut: HashSet<_> = shadows.iter().filter(|&&target| walk.mask[target as usize]).copied().collect();
                    if cut.is_empty() { continue }
                    decided.insert(id);
                    let forward = self.search(&[id], false, &allowed, &cut, &HashMap::new());
                    if seeded.iter().any(|&seed| forward.mask[seed as usize]) { continue }
                    avoid.insert(id); shadowed.push(id); found += 1;
                }
                if found == 0 { break }
                walk = self.search(&seeds, true, &allowed, &avoid, &moved);
            }
            shadowed.sort_unstable(); walk.shadowed = shadowed;
        }
        let nodes: Vec<_> = walk.nodes.iter().filter_map(|&id| self.info(id)).collect();
        let parents: Vec<_> = walk.nodes.iter().map(|&id| SelectionParent { id, parent: walk.parents[id as usize] }).collect();
        let mut missing = missing; missing.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
        SelectionWalk { nodes, parents, missing,
            shadowed: walk.shadowed.iter().map(|&id| self.names[id as usize].clone()).collect() }
    }
}

fn merge(held: &mut Option<Carry>, carry: Carry) -> bool {
    match (&mut *held, carry) {
        (Some(Carry::Whole), _) => false,
        (slot, Carry::Whole) => { *slot = Some(Carry::Whole); true }
        (None, Carry::Names(names)) => { *held = Some(Carry::Names(names)); true }
        (Some(Carry::Names(held)), Carry::Names(names)) => {
            let before = held.len(); held.extend(names); before != held.len()
        }
    }
}

pub(super) fn allowed(through: Option<&[String]>) -> [bool; 8] {
    std::array::from_fn(|kind| through.is_none_or(|through| through.iter().any(|name| name == KINDS[kind])))
}
