//! One case's walk over the static call graph, kept to the functions the case
//! entered. Each step says how it is known:
//!
//! - observed: the call site sits in a recorded region this case entered, and
//!   the callee ran;
//! - static: the site is in the test, in an unrecorded file, or no recorded
//!   region decides it — resolved, not seen;
//! - inferred: no static target, so a member call matched by name to the one
//!   entered function of that name, `new X` to X's constructor, a function
//!   written inside a value handed to a call, a function a factory wrote, what
//!   a caller handed a parameter, or a function no route reaches hung under the
//!   placed function it is written in;
//! - unrecorded: a function in a file the recording does not instrument, on the
//!   route to an entered one;
//! - test: a helper declared in the test file.
//!
//! A callee with several routes is placed on the one with the fewest guards,
//! then the fewest hops, then the call found first. Nothing here says which
//! route ran when the recording does not.

// compass: variance-authority.reach.relations

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

use crate::journeys_graph::{Graph, Target};
use crate::journeys_record::{Record, NONE};
use crate::journeys_roots::{find_roots, registered, Helpers, TOP};
pub(crate) use crate::journeys_steps::{Known, Step, Tag, Walked};

const BUILTIN: &[&str] = &[
    "add", "get", "set", "has", "delete", "clear", "map", "filter", "reduce", "forEach", "find", "some", "every", "sort", "join", "slice",
    "push", "pop", "shift", "includes", "indexOf", "keys", "values", "entries", "then", "catch", "finally", "call", "apply", "bind",
    "toString", "replace", "split", "trim", "startsWith", "endsWith", "test", "exec", "match", "concat", "flat", "flatMap", "fill", "from",
    "of", "assign", "resolve", "reject", "all", "write", "read", "end", "on", "once", "emit", "next", "at", "repeat", "padStart", "padEnd",
    "toFixed", "toLowerCase", "toUpperCase", "localeCompare", "charCodeAt", "codePointAt",
];

/// How many functions of unrecorded files one case may cross.
const PASSES: u32 = 600;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Test,
    Region,
    Pass,
}

struct Node {
    kind: Kind,
    file: u32,
    func: u32,
    region: Option<u32>,
    explored: bool,
}

struct Edge {
    from: u32,
    to: u32,
    guard: u32,
    tag: Tag,
    known: Known,
}

#[derive(PartialEq)]
enum Site {
    Ran,
    Not,
    Unknown,
}

fn region_key(j: u32) -> u64 {
    1 << 63 | j as u64
}

fn fn_key(file: u32, func: u32) -> u64 {
    (file as u64) << 32 | func as u64
}

struct Walk<'w, 'j> {
    graph: &'w Graph,
    record: &'w Record<'j>,
    test_file: u32,
    entered: Vec<bool>,
    by_last: HashMap<&'j str, (u32, u32)>,
    constructors: HashMap<&'j str, u32>,
    nodes: Vec<Node>,
    keys: HashMap<u64, u32>,
    edges: Vec<Edge>,
    passes: u32,
}

impl<'w, 'j> Walk<'w, 'j> {
    fn entered(&self, j: u32) -> bool {
        self.entered[j as usize]
    }

    fn node(&mut self, kind: Kind, file: u32, func: u32, region: Option<u32>) -> u32 {
        let key = region.map_or_else(|| fn_key(file, func), region_key);
        if let Some(&at) = self.keys.get(&key) {
            return at;
        }
        let at = self.nodes.len() as u32;
        self.nodes.push(Node { kind, file, func, region, explored: false });
        self.keys.insert(key, at);
        at
    }

    fn link(&mut self, from: u32, to: u32, guard: u32, tag: Tag, known: Known) {
        self.edges.push(Edge { from, to, guard, tag, known });
    }

    /// An entered region reached by inference: linked, then explored.
    fn reach(&mut self, from: u32, file: u32, func: u32, j: u32, guard: u32, known: Known) {
        let to = self.node(Kind::Region, file, func, Some(j));
        self.link(from, to, guard, Tag::Inferred, known);
        self.explore(to, false);
    }

    fn site(&self, file: u32, line: u32) -> Site {
        let Some(around) = self.record.around[file as usize].get(&line) else { return Site::Unknown };
        let regions = &self.record.regions;
        for &j in around.iter() {
            if self.entered(j) {
                return Site::Ran;
            }
            let block = &regions[j as usize];
            let twin_ran = around.iter().any(|&other| {
                other != j && regions[other as usize].start == block.start && regions[other as usize].end == block.end && self.entered(other)
            });
            if block.start < line && !twin_ran {
                return Site::Not;
            }
        }
        Site::Unknown
    }

    /// A value handed to a call: the outermost functions written inside it that
    /// this case entered.
    fn handed(&mut self, from: u32, file: u32, local: &str, guard: u32, known: Known) {
        let graph = self.graph;
        let Some(parsed) = graph.parsed(file) else { return };
        let Some(decl) = parsed.decls.get(local) else { return };
        if !self.record.recorded(file) {
            return;
        }
        for (at, func) in parsed.fns.iter().enumerate() {
            if func.start < decl.start || func.start > decl.end || func.parent.is_some_and(|parent| parsed.fns[parent as usize].start >= decl.start) {
                continue;
            }
            let Some(j) = self.record.region_for(file, at as u32).filter(|&j| self.entered(j)) else { continue };
            self.reach(from, file, at as u32, j, guard, known);
        }
    }

    /// A call to a value a factory made at load runs the functions that factory
    /// wrote and the ones handed to it: of those, the outermost this case entered.
    fn made(&mut self, from: u32, file: u32, local: &str, guard: u32, depth: u32) -> usize {
        let graph = self.graph;
        let Some(decl) = graph.parsed(file).and_then(|parsed| parsed.decls.get(local)) else { return 0 };
        let before = self.edges.len();
        self.handed(from, file, local, guard, Known::Made);
        let Some(made) = decl.made.as_ref().filter(|_| depth < 3) else { return self.edges.len() - before };
        match graph.target_of(file, None, made, None) {
            Target::Fn { file: maker, func: top, .. } if self.record.recorded(maker) => {
                let parsed = graph.parsed(maker).expect("a target's file is parsed");
                let top_start = parsed.fns[top as usize].start;
                for (at, func) in parsed.fns.iter().enumerate() {
                    if func.start <= top_start {
                        continue;
                    }
                    let (mut inside, mut outer) = (false, true);
                    let mut scope = func.parent;
                    while let Some(s) = scope {
                        if s == top {
                            inside = true;
                            break;
                        }
                        if self.record.region_for(maker, s).is_some_and(|j| self.entered(j)) {
                            outer = false;
                        }
                        scope = parsed.fns[s as usize].parent;
                    }
                    if !inside || !outer {
                        continue;
                    }
                    let Some(j) = self.record.region_for(maker, at as u32).filter(|&j| self.entered(j)) else { continue };
                    self.reach(from, maker, at as u32, j, guard, Known::Made);
                }
            }
            Target::NotFunction { file: at, local } => {
                self.made(from, at, &local, guard, depth + 1);
            }
            Target::Free => {
                if let Some(id) = made.id.as_deref().filter(|id| graph.parsed(file).is_some_and(|parsed| parsed.decls.contains_key(*id))) {
                    self.made(from, file, id, guard, depth + 1);
                }
            }
            _ => {}
        }
        self.edges.len() - before
    }

    /// A call to parameter K of an enclosing function F runs what F's callers
    /// handed it there: of the functions written as F's argument K, the ones
    /// this case entered.
    fn parameter(&mut self, from: u32, file: u32, call: u32, id: &str, guard: u32) -> bool {
        let graph = self.graph;
        let parsed = graph.parsed(file).expect("an explored file is parsed");
        let mut scope = parsed.calls[call as usize].from;
        while let Some(s) = scope {
            let func = &parsed.fns[s as usize];
            scope = func.parent;
            let Some(k) = func.params.iter().position(|param| param.as_deref() == Some(id)) else { continue };
            let Some(hint) = func.hint.as_deref().filter(|hint| !crate::journeys_parse::is_argument(hint)) else { return false };
            let Some(handed) = self.record.handed.get(&format!("{hint}.arg{k}")) else { return false };
            let mut any = false;
            for &(at_file, at) in handed {
                let Some(j) = self.record.region_for(at_file, at).filter(|&j| self.entered(j)) else { continue };
                self.reach(from, at_file, at, j, guard, Known::Parameter);
                any = true;
            }
            return any;
        }
        false
    }

    fn explore(&mut self, node: u32, scope: bool) {
        let graph = self.graph;
        let (file, func) = {
            let node = &mut self.nodes[node as usize];
            if node.explored || node.func == NONE {
                return;
            }
            node.explored = true;
            (node.file, node.func)
        };
        let Some(parsed) = graph.parsed(file) else { return };
        let group = if func == TOP { 0 } else { func as usize + 1 };
        let Some(calls) = graph.calls_from[file as usize].get(group) else { return };
        let recorded = self.record.recorded(file);
        for &at in calls {
            let call = &parsed.calls[at as usize];
            if scope && call.callback.is_some_and(|callback| registered(parsed.fns[callback as usize].hint.as_deref())) {
                continue;
            }
            let site = if recorded { self.site(file, call.line) } else { Site::Unknown };
            if site == Site::Not {
                continue;
            }
            let guard = if site == Site::Ran { 0 } else { call.guard };
            let callee = &call.callee;
            match &graph.targets[file as usize][at as usize] {
                Target::Fn { file: to_file, func: to_func, how } => {
                    let known = if call.by_ref { Known::Reference } else { Known::Call(*how) };
                    let (to_file, to_func) = (*to_file, *to_func);
                    if to_file == self.test_file {
                        let to = self.node(Kind::Test, to_file, to_func, None);
                        self.link(node, to, guard, Tag::Test, known);
                        self.explore(to, false);
                    } else if !self.record.recorded(to_file) {
                        let to = self.node(Kind::Pass, to_file, to_func, None);
                        let fresh = !self.nodes[to as usize].explored;
                        if fresh && self.passes >= PASSES {
                            continue;
                        }
                        if fresh {
                            self.passes += 1;
                        }
                        self.link(node, to, guard, Tag::Unrecorded, known);
                        self.explore(to, false);
                    } else if let Some(j) = self.record.region_for(to_file, to_func).filter(|&j| self.entered(j)) {
                        let to = self.node(Kind::Region, to_file, to_func, Some(j));
                        self.link(node, to, guard, if site == Site::Ran { Tag::Observed } else { Tag::Static }, known);
                        self.explore(to, false);
                    }
                }
                unresolved => {
                    let declared = |name: &Option<String>| name.as_deref().filter(|id| parsed.decls.contains_key(*id)).map(str::to_owned);
                    if call.by_ref {
                        match unresolved {
                            Target::NotFunction { file: at_file, local } => self.handed(node, *at_file, &local.clone(), guard, Known::Handed),
                            Target::Free => {
                                if let Some(id) = declared(&callee.id) {
                                    self.handed(node, file, &id, guard, Known::Handed);
                                }
                            }
                            _ => {}
                        }
                        continue;
                    }
                    if let Target::NotFunction { file: at_file, local } = unresolved {
                        if self.made(node, *at_file, &local.clone(), guard, 0) > 0 {
                            continue;
                        }
                    }
                    let free = matches!(unresolved, Target::Free);
                    if free {
                        if let Some(id) = declared(&callee.id) {
                            if self.made(node, file, &id, guard, 0) > 0 {
                                continue;
                            }
                        }
                    }
                    let member = matches!(unresolved, Target::Member) || (matches!(unresolved, Target::NotFunction { .. }) && callee.prop.is_some());
                    if let Some(prop) = callee.prop.as_deref().filter(|prop| member && !BUILTIN.contains(prop)) {
                        if let Some(&(j, 1)) = self.by_last.get(prop) {
                            let region = &self.record.regions[j as usize];
                            self.reach(node, region.file, self.record.fn_for[j as usize], j, guard, Known::NameMatch);
                            continue;
                        }
                    }
                    let named = callee.id.as_deref().or(callee.prop.as_deref());
                    let constructor = named
                        .filter(|name| call.is_new || name.starts_with(|first: char| first.is_ascii_uppercase()))
                        .and_then(|name| self.constructors.get(name).copied());
                    if let Some(j) = constructor {
                        let region = &self.record.regions[j as usize];
                        self.reach(node, region.file, self.record.fn_for[j as usize], j, guard, Known::New);
                        continue;
                    }
                    if free {
                        if let Some(id) = callee.id.as_deref() {
                            self.parameter(node, file, at, id, guard);
                        }
                    }
                }
            }
        }
    }

    /// The best route to every node: fewest guards, then fewest hops, then the
    /// edge found first. Returns each reached node's key and the edge it came by.
    fn route(&self, roots: &[u32]) -> (Vec<Option<(u32, u32, i64)>>, Vec<u32>) {
        let mut key: Vec<Option<(u32, u32, i64)>> = vec![None; self.nodes.len()];
        let mut parent = vec![NONE; self.nodes.len()];
        let mut out: Vec<Vec<u32>> = vec![Vec::new(); self.nodes.len()];
        for (rank, edge) in self.edges.iter().enumerate() {
            out[edge.from as usize].push(rank as u32);
        }
        let mut heap = BinaryHeap::new();
        let count = roots.len() as i64;
        for (at, &root) in roots.iter().enumerate() {
            if key[root as usize].is_none() {
                let k = (0, 0, -1 - count + at as i64);
                key[root as usize] = Some(k);
                heap.push(Reverse((k, root)));
            }
        }
        let mut done = vec![false; self.nodes.len()];
        while let Some(Reverse((k, node))) = heap.pop() {
            if done[node as usize] || key[node as usize] != Some(k) {
                continue;
            }
            done[node as usize] = true;
            for &rank in &out[node as usize] {
                let edge = &self.edges[rank as usize];
                let next = (k.0 + edge.guard, k.1 + 1, rank as i64);
                if key[edge.to as usize].is_none_or(|held| next < held) {
                    key[edge.to as usize] = Some(next);
                    parent[edge.to as usize] = rank;
                    heap.push(Reverse((next, edge.to)));
                }
            }
        }
        (key, parent)
    }
}

pub(crate) fn walk(graph: &Graph, record: &Record, helpers: &Helpers, case: usize) -> Walked {
    let (test_file, name) = record.tests[case];
    let mut entered = vec![false; record.regions.len()];
    let mut by_last: HashMap<&str, (u32, u32)> = HashMap::new();
    let mut constructors: HashMap<&str, u32> = HashMap::new();
    let mut functions = 0;
    for &j in &record.entered[case] {
        entered[j as usize] = true;
        let region = &record.regions[j as usize];
        if !region.function() {
            continue;
        }
        if region.file != test_file {
            functions += 1;
        }
        by_last.entry(region.last).and_modify(|(_, count)| *count += 1).or_insert((j, 1));
        if let Some(class) = region.name.strip_suffix("/constructor") {
            constructors.entry(class).or_insert(j);
        }
    }
    let mut walk = Walk {
        graph,
        record,
        test_file,
        entered,
        by_last,
        constructors,
        nodes: Vec::new(),
        keys: HashMap::new(),
        edges: Vec::new(),
        passes: 0,
    };
    let roots = find_roots(graph, helpers, test_file, name);
    let mut starts = Vec::new();
    if let Some(roots) = &roots {
        for &(file, func) in &roots.scopes {
            let at = walk.node(Kind::Test, file, func, None);
            starts.push(at);
            walk.explore(at, true);
        }
        for &(file, func) in roots.hooks.iter().chain(roots.body.as_ref()) {
            let at = walk.node(Kind::Test, file, func, None);
            starts.push(at);
            walk.explore(at, false);
        }
    }
    let (mut key, mut parent) = walk.route(&starts);
    // An entered function no route reaches hangs under the nearest function it
    // is written in that one does: that function made it, and who called it is
    // not in the relations, so the step is inferred.
    for _ in 0..4 {
        let mut added = 0;
        for &j in &record.entered[case] {
            let region = &record.regions[j as usize];
            if !region.function() || walk.keys.get(&region_key(j)).is_some_and(|&at| key.get(at as usize).is_some_and(Option::is_some)) {
                continue;
            }
            let func = record.fn_for[j as usize];
            let Some(parsed) = graph.parsed(region.file).filter(|_| func != NONE) else { continue };
            let mut scope = parsed.fns[func as usize].parent;
            while let Some(s) = scope {
                scope = parsed.fns[s as usize].parent;
                let placed = record.region_for(region.file, s).and_then(|pj| walk.keys.get(&region_key(pj)).copied());
                let Some(from) = placed.or_else(|| walk.keys.get(&fn_key(region.file, s)).copied()) else { continue };
                if key.get(from as usize).is_none_or(Option::is_none) {
                    continue;
                }
                let to = walk.node(Kind::Region, region.file, func, Some(j));
                walk.link(from, to, 0, Tag::Inferred, Known::Enclosed);
                walk.explore(to, false);
                added += 1;
                break;
            }
        }
        if added == 0 {
            break;
        }
        (key, parent) = walk.route(&starts);
    }
    let steps = emit(&walk, &starts, &parent);
    let mut placed: Vec<u32> = steps.iter().filter_map(|step| step.region).collect();
    placed.sort_unstable();
    placed.dedup();
    Walked { start: roots.map(|roots| roots.start), steps, entered: functions, placed: placed.len() as u32 }
}

/// The tree: region nodes, and the test helpers and unrecorded functions on a
/// route to one, each placed once, depth first in call order.
fn emit(walk: &Walk, starts: &[u32], parent: &[u32]) -> Vec<Step> {
    let mut kids: Vec<Vec<u32>> = vec![Vec::new(); walk.nodes.len()];
    for &rank in parent.iter().filter(|&&rank| rank != NONE) {
        kids[walk.edges[rank as usize].from as usize].push(rank);
    }
    for list in &mut kids {
        list.sort_unstable();
    }
    let mut useful: Vec<Option<bool>> = vec![None; walk.nodes.len()];
    fn is_useful(node: u32, walk: &Walk, kids: &[Vec<u32>], useful: &mut [Option<bool>]) -> bool {
        if let Some(known) = useful[node as usize] {
            return known;
        }
        useful[node as usize] = Some(false);
        let value = walk.nodes[node as usize].kind == Kind::Region
            || kids[node as usize].iter().any(|&rank| is_useful(walk.edges[rank as usize].to, walk, kids, useful));
        useful[node as usize] = Some(value);
        value
    }
    let mut placed = vec![false; walk.nodes.len()];
    let mut steps = Vec::new();
    // Depth first, iteratively: (node, depth, next kid).
    for &start in starts {
        let mut stack: Vec<(u32, u32, usize)> = vec![(start, 0, 0)];
        while let Some(top) = stack.last_mut() {
            let (node, depth, next) = *top;
            let Some(&rank) = kids[node as usize].get(next) else {
                stack.pop();
                continue;
            };
            top.2 += 1;
            let edge = &walk.edges[rank as usize];
            if !is_useful(edge.to, walk, &kids, &mut useful) || placed[edge.to as usize] {
                continue;
            }
            placed[edge.to as usize] = true;
            let to = &walk.nodes[edge.to as usize];
            steps.push(Step { depth, region: to.region, file: to.file, tag: edge.tag, known: edge.known });
            stack.push((edge.to, depth + 1, 0));
        }
    }
    steps
}
