//! Fold native record columns into selection's typed graph; additions remain a question overlay.
// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use napi_derive::napi;
use crate::chain_lookup::fold;
use crate::help_publish::Opened;
use crate::source_tree::{additions, Mocking};
use super::{Adjacency, State, KINDS};

#[napi(object)]
pub struct SelectionGraphOptions {
    pub root: String,
    pub raw: Option<bool>,
    pub dirs: Vec<String>,
    pub before: Vec<String>,
    pub code: Vec<String>,
    pub builtins: Vec<String>,
    pub tsconfig: Option<napi::Either<String, bool>>,
    pub taints: Vec<SelectionTaint>,
    pub depends: Vec<SelectionDepend>,
}

#[napi(object)]
pub struct SelectionTaint { pub file: String, pub plus: Vec<String>, pub minus: Vec<String> }
#[napi(object)]
pub struct SelectionDepend { pub from: String, pub to: String }

type Key = (u8, String);
type Edge = (Key, Key, u8);
fn file(path: &str) -> Key { (0, path.to_owned()) }

pub(super) fn graph(source: Arc<Opened>, options: SelectionGraphOptions) -> Result<State, String> {
    let layers = source.layers();
    let all = fold(layers);
    let paths: Vec<_> = all.keys().map(|path| (*path).to_owned()).collect();
    let mut queue = crate::seed::seed_paths(&options.root, &options.dirs, &paths);
    queue.extend(options.before);
    let mut scoped = HashMap::new();
    for head in 0.. {
        let Some(path) = queue.get(head).cloned() else { break };
        let Some((&path, &(layer, row))) = all.get_key_value(path.as_str()) else { continue };
        if scoped.insert(path, (layer, row)).is_some() { continue }
        if let Some(edges) = layers[layer].records.edges_of(&layers[layer].stored, row) {
            queue.extend(edges.map(|(to, _)| to.to_owned()));
        }
    }
    let tsconfig = crate::resolve::Tsconfig::from_js(options.tsconfig);
    let mocking = Mocking::at(&options.root, tsconfig, options.code);
    let mut changed = if options.raw == Some(true) { HashMap::new() } else { additions(layers, &scoped, &mocking, true) };
    let mut extra_packages: HashMap<&str, Vec<String>> = HashMap::new();
    let mut known: HashMap<String, u32> = scoped.keys().map(|path| ((*path).to_owned(), 0)).collect();
    for &(layer, row) in scoped.values() {
        if let Some(edges) = layers[layer].records.edges_of(&layers[layer].stored, row) {
            known.extend(edges.map(|(to, _)| (to.to_owned(), 0)));
        }
    }
    let builtins = options.builtins.into_iter().collect();
    for taint in options.taints {
        let Some((&path, _)) = scoped.get_key_value(taint.file.as_str()) else { continue };
        let row = changed.entry(path).or_insert_with(|| crate::source_tree::Added { edges: Vec::new(), shadows: Vec::new(), holes: None, missed: Vec::new() });
        let from = mocking.root.join(path);
        for value in taint.minus {
            if let Some(to) = mocking.resolvers.resolve(&mocking.root, &from, &value, Some(&known)) { row.shadows.push(to); }
        }
        for value in taint.plus {
            let Some(request) = crate::specifier::request_of(&value) else { continue };
            match mocking.resolvers.resolve(&mocking.root, &from, request, Some(&known)) {
                Some(to) => {
                    let kind = if crate::specifier::kind_for("imports", &to, &mocking.code) == "asset" { "asset" } else { "imports" };
                    row.edges.push((to, kind));
                }
                None => {
                    if !row.missed.contains(&value) { row.missed.push(value); }
                }
            }
        }
    }
    for (&path, change) in &mut changed {
        let holes: Vec<_> = change.missed.iter().filter(|value| crate::specifier::request_of(value).is_some_and(crate::specifier::is_relative)).collect();
        change.holes = (!holes.is_empty()).then(|| format!("{} tainted relative specifier(s) that resolve to nothing: {}", holes.len(), holes.into_iter().map(|value| value.as_str()).collect::<Vec<_>>().join(", ")));
        for value in &change.missed {
            if let Some(package) = crate::specifier::request_of(value).and_then(|request| crate::specifier::package_of(request, &builtins)) {
                extra_packages.entry(path).or_default().push(package.to_owned());
            }
        }
        change.shadows.sort_unstable_by(|a,b| crate::order::code_unit(a,b)); change.shadows.dedup();
    }
    let mut nodes = HashSet::new();
    let mut edges: Vec<Edge> = Vec::new();
    let mut unknown: HashMap<Key, String> = HashMap::new();
    let mut added = Vec::new();
    let mut shadows = Vec::new();
    let mut sources = HashSet::new();
    for (&path, &(layer, row)) in &scoped {
        sources.insert(path.to_owned());
        let record = layers[layer].records.indexed(&layers[layer].stored, row).record;
        let from = file(path);
        nodes.insert(from.clone());
        for edge in record.edges.into_iter().flatten() {
            let Some(kind) = KINDS.iter().position(|kind| *kind == edge.kind) else { return Err(format!("unknown source edge kind {}", edge.kind)) };
            edges.push((from.clone(), file(&edge.to), kind as u8));
        }
        for edge in record.packages.into_iter().flatten() {
            let Some(kind) = KINDS.iter().position(|kind| *kind == edge.kind) else { return Err(format!("unknown package edge kind {}", edge.kind)) };
            edges.push((from.clone(), (2, edge.to), kind as u8));
        }
        for component in record.declares.into_iter().flatten() { edges.push(((1, component), from.clone(), 5)); }
        let mut reasons: Vec<String> = record.unknown.into_iter().collect();
        if let Some(change) = changed.get(path) {
            reasons.extend(change.holes.clone());
            for (to, kind) in &change.edges {
                let to_key = file(to);
                edges.push((from.clone(), to_key.clone(), KINDS.iter().position(|known| known == kind).unwrap() as u8));
                added.push((from.clone(), to_key.clone()));
                if !scoped.contains_key(to.as_str()) {
                    unknown.insert(to_key, format!("{to} is named by a taint addition and is outside the scanned directories: nothing read it, so its own imports are unknown"));
                }
            }
            shadows.extend(change.shadows.iter().map(|to| (from.clone(), file(to))));
        }
        for package in extra_packages.remove(path).unwrap_or_default() { edges.push((from.clone(), (2, package), 0)); }
        if !reasons.is_empty() { unknown.insert(from, reasons.join("; ")); }
    }
    edges.extend(options.depends.into_iter().map(|edge| ((2, edge.from), (2, edge.to), 6)));
    for (from, to, _) in &edges { nodes.insert(from.clone()); nodes.insert(to.clone()); }
    let mut nodes: Vec<_> = nodes.into_iter().collect();
    nodes.sort_unstable_by(|left, right| left.0.cmp(&right.0).then_with(|| crate::order::code_unit(&left.1, &right.1)));
    let ids: HashMap<_, _> = nodes.iter().enumerate().map(|(id, key)| (key.clone(), id as u32)).collect();
    let mut edges: Vec<_> = edges.into_iter().map(|(from, to, kind)| (ids[&from], ids[&to], kind)).collect();
    edges.sort_unstable(); edges.dedup();
    let depends = adjacency(&edges, nodes.len(), false);
    let dependents = adjacency(&edges, nodes.len(), true);
    let unknown = unknown.into_iter().filter_map(|(key, reason)| Some((*ids.get(&key)?, reason))).collect();
    let additions = added.into_iter().filter_map(|(from, to)| Some((*ids.get(&from)?, *ids.get(&to)?))).collect();
    let mut shadow_names: HashMap<u32, Vec<String>> = HashMap::new();
    for (&path, change) in &changed {
        if let Some(&id) = ids.get(&file(path)) { shadow_names.insert(id, change.shadows.clone()); }
    }
    let mut shadow_ids: HashMap<u32, Vec<u32>> = HashMap::new();
    for (from, to) in shadows {
        if let (Some(&from), Some(&to)) = (ids.get(&from), ids.get(&to)) { shadow_ids.entry(from).or_default().push(to); }
    }
    for row in shadow_ids.values_mut() { row.sort_unstable(); row.dedup(); }
    let (kinds, names) = nodes.into_iter().unzip();
    Ok(State { source: Arc::clone(&source), names, kinds, ids, depends, dependents, sources, unknown,
        shadows: shadow_ids, shadow_names, additions, uses: Mutex::new(HashMap::new()) })
}

pub(super) fn adjacency(edges: &[(u32, u32, u8)], nodes: usize, reverse: bool) -> Adjacency {
    let mut offsets = vec![0; nodes + 1];
    for &(from, to, _) in edges { offsets[if reverse { to } else { from } as usize + 1] += 1; }
    for id in 0..nodes { offsets[id + 1] += offsets[id]; }
    let mut at = offsets[..nodes].to_vec();
    let mut targets = vec![0; edges.len()];
    let mut kinds = vec![0; edges.len()];
    for &(from, to, kind) in edges {
        let row = if reverse { to } else { from } as usize;
        targets[at[row]] = if reverse { from } else { to }; kinds[at[row]] = kind; at[row] += 1;
    }
    Adjacency { offsets, targets, kinds }
}
