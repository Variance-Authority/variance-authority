//! Batched selection questions over one native graph; raw columns never leave it.
// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};
use serde_json::{json, Value};
use super::{parsed, within, Node, State, KINDS, NODE_KINDS};
use super::walk::{allowed, Options};

pub(super) fn query(graph: &State, request: Value) -> Result<Value, String> {
    match request.get("op").and_then(Value::as_str).ok_or("selection query needs an op")? {
        "lookup" => {
            let nodes: Vec<Node> = parsed(&request, "nodes")?;
            Ok(json!(nodes.iter().map(|node| graph.id(node).and_then(|id| graph.info(id))).collect::<Vec<_>>()))
        }
        "nodes" => {
            let ids: Vec<u32> = parsed(&request, "ids")?;
            Ok(json!(ids.into_iter().map(|id| graph.info(id)).collect::<Vec<_>>()))
        }
        "list" => {
            let kind = request.get("kind").and_then(Value::as_str).and_then(|kind| NODE_KINDS.iter().position(|known| *known == kind));
            let dirs: Option<Vec<String>> = request.get("dirs").cloned().map(serde_json::from_value).transpose().map_err(|error| error.to_string())?;
            let pattern = request.get("pattern").and_then(Value::as_str).map(regex::Regex::new).transpose().map_err(|error| error.to_string())?;
            Ok(json!((0..graph.names.len()).filter(|&id|
                kind.is_none_or(|kind| graph.kinds[id] as usize == kind)
                && dirs.as_ref().is_none_or(|dirs| within(&graph.names[id], dirs))
                && pattern.as_ref().is_none_or(|pattern| pattern.is_match(&graph.names[id])))
                .filter_map(|id| graph.info(id as u32)).collect::<Vec<_>>()))
        }
        "sources" => {
            let files: Vec<String> = parsed(&request, "files")?;
            Ok(json!(files.iter().map(|file| graph.sources.contains(file)).collect::<Vec<_>>()))
        }
        "names" => {
            let files: Vec<String> = parsed(&request, "files")?;
            let layers = graph.source.layers();
            Ok(json!(files.iter().map(|file| crate::chain_lookup::record(layers, file).and_then(|(_, (layer, row))|
                layers[layer].stored.optional(layers[layer].records.digest.at(row)))).collect::<Vec<_>>()))
        }
        "rows" => {
            let ids: Vec<u32> = parsed(&request, "ids")?;
            let reverse = request.get("reverse").and_then(Value::as_bool) == Some(true);
            let adjacency = if reverse { &graph.dependents } else { &graph.depends };
            Ok(json!(ids.into_iter().map(|id| json!({ "id": id, "edges": adjacency.row(id)
                .filter_map(|(to, kind)| graph.info(to).map(|to| json!({ "to": to, "kind": KINDS[kind as usize] })))
                .collect::<Vec<_>>() })).collect::<Vec<_>>()))
        }
        "uses" => {
            let edges: Vec<(u32, u32)> = parsed(&request, "edges")?;
            Ok(json!(edges.into_iter().map(|(from, to)| graph.edge_use(from, to)).collect::<Vec<_>>()))
        }
        "walk" => Ok(graph.walk(serde_json::from_value::<Options>(request).map_err(|error| error.to_string())?)),
        "before" => before(graph, &request),
        "shadowed" => shadowed(graph, &request),
        "declaredBehind" => declared_behind(graph, &request),
        "beyond" => beyond(graph, &request),
        other => Err(format!("unknown selection graph question {other}")),
    }
}

fn runtime() -> [bool; 8] { std::array::from_fn(|kind| kind != 3) }

fn before(graph: &State, request: &Value) -> Result<Value, String> {
    let entries: Vec<String> = parsed(request, "entries")?;
    let sensed: Vec<String> = request.get("sensed").cloned().map(serde_json::from_value).transpose().map_err(|error| error.to_string())?.unwrap_or_default();
    let mut seeds = HashSet::new();
    let mut unread = Vec::new();
    for entry in &entries {
        if let Some(id) = graph.file(entry) { seeds.insert(id); continue }
        let mut found = false;
        for (id, name) in graph.names.iter().enumerate() {
            if graph.kinds[id] == 0 && within(name, std::slice::from_ref(entry)) { seeds.insert(id as u32); found = true; }
        }
        if !found { unread.push(entry); }
    }
    let avoid = graph.names.iter().enumerate().filter_map(|(id, name)|
        (graph.kinds[id] == 0 && !seeds.contains(&(id as u32)) && within(name, &sensed)).then_some(id as u32)).collect();
    let mut seeds: Vec<_> = seeds.into_iter().collect(); seeds.sort_unstable();
    let walk = graph.search(&seeds, false, &runtime(), &avoid, &HashMap::new());
    let files: Vec<_> = walk.nodes.into_iter().filter(|&id| graph.kinds[id as usize] == 0).map(|id| &graph.names[id as usize]).collect();
    Ok(json!({ "entries": entries, "files": files, "unread": unread }))
}

fn shadowed(graph: &State, request: &Value) -> Result<Value, String> {
    let tests: Vec<String> = parsed(request, "tests")?;
    let rows: Vec<_> = tests.iter().map(|test| {
        let Some(seed) = graph.file(test) else { return Vec::new() };
        let direct = graph.shadows.get(&seed).cloned().unwrap_or_default();
        let kept = graph.search(&[seed], false, &runtime(), &direct.iter().copied().collect(), &HashMap::new());
        let cut = graph.search(&direct, false, &runtime(), &HashSet::new(), &HashMap::new());
        cut.nodes.into_iter().filter(|&id| !kept.mask[id as usize] && graph.kinds[id as usize] == 0)
            .map(|id| graph.names[id as usize].clone()).collect::<Vec<_>>()
    }).collect();
    Ok(json!(rows))
}

fn declared_behind(graph: &State, request: &Value) -> Result<Value, String> {
    let files: Vec<String> = parsed(request, "files")?;
    let asked: HashSet<_> = files.iter().filter_map(|file| graph.file(file)).collect();
    let mut found = Vec::new();
    for id in 0..graph.names.len() as u32 {
        if !graph.dependents.row(id).any(|(_, kind)| kind == 7) { continue }
        let walk = graph.search(&[id], false, &runtime(), &HashSet::new(), &HashMap::new());
        if asked.iter().any(|&id| walk.mask[id as usize]) { found.push(graph.info(id)); }
    }
    Ok(json!(found))
}

fn beyond(graph: &State, request: &Value) -> Result<Value, String> {
    let packages: Vec<String> = parsed(request, "packages")?;
    let moved: Vec<String> = parsed(request, "moved")?;
    let only_packages = allowed(Some(&["depends-on".to_owned()]));
    let mut files = HashSet::new();
    let mut chains = HashMap::new();
    let mut traced = Vec::new();
    for package in packages {
        let Some(seed) = graph.id(&Node { kind: "package".to_owned(), name: package.clone() }) else { continue };
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
    Ok(json!({ "files": files, "chains": chains, "traced": traced, "unplaced": unplaced }))
}
