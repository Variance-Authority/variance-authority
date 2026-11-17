//! A merge-base edge overlay stays beside native adjacency, including every test's mock cut.
// compass: variance-authority.reach.relations
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use napi_derive::napi;
use super::{SelectionGraph, State};
use super::walk::SelectionWalk;

#[napi(object)]
pub struct SelectionOverlayRow { pub id: u32, pub targets: Vec<u32> }
#[napi(object)]
pub struct SelectionLoaded { pub file: String, pub source: String, pub tests: Vec<String> }
#[napi(object)]
pub struct SelectionDriftRow { pub file: String, pub test: String }
#[napi(object)]
pub struct SelectionDrift { pub rows: Vec<SelectionDriftRow>, pub unread: Vec<SelectionDriftRow> }

#[napi]
impl SelectionGraph {
    #[napi]
    pub fn overlay(&self, added: Vec<SelectionOverlayRow>, removed: Vec<SelectionOverlayRow>, created: Vec<u32>) -> SelectionGraph {
        let source = &self.state;
        let added: HashMap<_, HashSet<_>> = added.into_iter().map(|row| (row.id, row.targets.into_iter().collect())).collect();
        let removed: HashMap<_, _> = removed.into_iter().map(|row| (row.id, row.targets)).collect();
        let created: HashSet<_> = created.into_iter().collect();
        let mut edges = Vec::new();
        for from in 0..source.names.len() as u32 {
            for (to, kind) in source.depends.row(from) {
                if !created.contains(&to) && !added.get(&from).is_some_and(|targets| targets.contains(&to)) { edges.push((from, to, kind)); }
            }
            for &to in removed.get(&from).into_iter().flatten() {
                if !created.contains(&to) { edges.push((from, to, 0)); }
            }
        }
        edges.sort_unstable(); edges.dedup();
        SelectionGraph { state: Arc::new(State {
            source: Arc::clone(&source.source), names: source.names.clone(), kinds: source.kinds.clone(), ids: source.ids.clone(),
            depends: super::build::adjacency(&edges, source.names.len(), false), dependents: super::build::adjacency(&edges, source.names.len(), true),
            sources: source.sources.clone(), unknown: source.unknown.clone(), shadows: source.shadows.clone(), shadow_names: source.shadow_names.clone(),
            additions: source.additions.clone(), uses: Mutex::new(HashMap::new()),
        }) }
    }

    #[napi]
    pub fn walk_within(&self, seeds: Vec<u32>, open: Vec<u32>) -> SelectionWalk {
        let open: HashSet<_> = open.into_iter().collect();
        let avoid = (0..self.state.names.len() as u32).filter(|id| !open.contains(id)).collect();
        let runtime = std::array::from_fn(|kind| kind != 3);
        let walk = self.state.search(&seeds, false, &runtime, &avoid, &HashMap::new());
        self.state.answer(walk, Vec::new())
    }

    #[napi]
    pub fn entries(&self, starts: Vec<u32>, open: Vec<u32>, alike: Vec<Vec<u32>>) -> Vec<u32> {
        let open: HashSet<_> = open.into_iter().collect();
        let mut aliases = HashMap::new();
        for group in alike { for &id in &group { aliases.insert(id, group.clone()); } }
        let canonical = |id: u32| aliases.get(&id).and_then(|group| group.iter().copied().min()).map_or(id, |other| id.min(other));
        let ran = |from: u32, republished: bool| self.state.depends.row(from)
            .filter(|(to, kind)| *kind != 3 && open.contains(to) && (republished || *kind != 1)).map(|(to, _)| to).collect::<Vec<_>>();
        let starts: HashSet<_> = starts.into_iter().collect();
        let mut direct: HashSet<_> = starts.iter().flat_map(|&id| ran(id, true)).filter(|id| !starts.contains(id)).collect();
        let mut below = HashSet::new();
        for &id in &direct {
            for from in aliases.get(&id).cloned().unwrap_or_else(|| vec![id]) {
                for to in ran(from, false) { if canonical(to) != canonical(id) { below.insert(canonical(to)); } }
            }
        }
        direct.retain(|&id| !below.contains(&canonical(id)));
        let mut direct: Vec<_> = direct.into_iter().collect(); direct.sort_unstable(); direct
    }

    #[napi]
    pub fn drift(&self, modules: Vec<SelectionLoaded>, before: Vec<String>, created: Vec<u32>, unknown: Vec<String>) -> SelectionDrift {
        let graph = &self.state;
        let mut loaded: HashMap<String, Vec<(String, String)>> = HashMap::new();
        let mut tests = Vec::new();
        for module in modules {
            for test in module.tests {
                if !loaded.contains_key(&test) { tests.push(test.clone()); }
                loaded.entry(test).or_default().push((module.file.clone(), module.source.clone()));
            }
        }
        let created: HashSet<_> = created.into_iter().collect();
        let unknown_names: HashSet<_> = unknown.iter().collect();
        let mut unknown_ids: Vec<_> = unknown.iter().filter_map(|name| graph.file(name)).collect(); unknown_ids.sort_unstable();
        let cut = |names: &[String]| names.iter().filter_map(|name| graph.file(name)).flat_map(|id| graph.shadows.get(&id).into_iter().flatten().copied()).collect();
        let runtime = std::array::from_fn(|kind| kind != 3);
        let before_walk = graph.search(&before.iter().filter_map(|name| graph.file(name)).collect::<Vec<_>>(), false, &runtime, &cut(&before), &HashMap::new());
        let before_stopped = unknown_ids.iter().find(|&&id| before_walk.mask[id as usize]);
        let mut rows = Vec::new(); let mut unread = Vec::new();
        for test in tests {
            let seeds: Vec<_> = graph.file(&test).filter(|id| !created.contains(id)).into_iter().collect();
            let walk = graph.search(&seeds, false, &runtime, &cut(std::slice::from_ref(&test)), &HashMap::new());
            let files = &loaded[&test];
            let at = unknown_ids.iter().find(|&&id| walk.mask[id as usize]).or(before_stopped);
            let stopped = at.map(|&id| graph.names[id as usize].clone()).or_else(|| files.iter().find(|(_, source)| unknown_names.contains(source)).map(|(file, _)| file.clone()));
            if let Some(file) = stopped { unread.push(SelectionDriftRow { file, test }); continue }
            for (file, source) in files {
                if graph.file(source).is_some_and(|id| walk.mask[id as usize] || before_walk.mask[id as usize]) { continue }
                rows.push(SelectionDriftRow { file: file.clone(), test: test.clone() });
            }
        }
        rows.sort_unstable_by(|a,b| crate::order::code_unit(&a.file,&b.file).then_with(|| crate::order::code_unit(&a.test,&b.test)));
        unread.sort_unstable_by(|a,b| crate::order::code_unit(&a.test,&b.test));
        SelectionDrift { rows, unread }
    }
}
