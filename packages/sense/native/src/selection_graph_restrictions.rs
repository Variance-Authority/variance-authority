//! Relation rules judge native adjacency without exporting source records.
// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};
use napi_derive::napi;
use super::{SelectionGraph, State};
use super::coverage::glob;

#[derive(Clone)]
#[napi(object)]
pub struct SelectionRelationRule { pub from: Option<String>, pub to: Option<String>, pub r#type: String, pub transitive: Option<bool>, pub message: Option<String> }
#[napi(object)]
pub struct SelectionRuleFile { pub directory: String, pub rules: Vec<SelectionRelationRule> }
#[derive(Clone)]
#[napi(object)]
pub struct SelectionViolation { pub from: String, pub to: String, pub message: Option<String>, pub directory: String }
#[napi(object)]
pub struct SelectionChainViolation { pub from: String, pub to: String, pub message: Option<String>, pub directory: String, pub chain: Vec<String>, pub seeds: u32 }
#[napi(object)]
pub struct SelectionRestrictions { pub imports: Vec<SelectionViolation>, pub chains: Vec<SelectionChainViolation> }

fn inside(dir: &str, path: &str) -> bool { dir.is_empty() || dir == path || path.strip_prefix(dir).is_some_and(|tail| tail.starts_with('/')) }
fn holds(matchers: &HashMap<String, regex::Regex>, dir: &str, pattern: Option<&str>, path: &str) -> bool {
    let Some(pattern) = pattern.filter(|pattern| *pattern != "*") else { return true };
    let written = if pattern == "." { "" } else { pattern.strip_prefix("./").unwrap_or(pattern).trim_end_matches('/') };
    let resolved = if dir.is_empty() { written.to_owned() } else if written.is_empty() { dir.to_owned() } else { format!("{dir}/{written}") };
    if !resolved.chars().any(|ch| "*?[{".contains(ch)) { return inside(&resolved, path) }
    let matcher = &matchers[&resolved];
    path.match_indices('/').map(|(at, _)| &path[..at]).chain(std::iter::once(path)).any(|prefix| matcher.is_match(prefix))
}
fn decision<'a>(matchers: &HashMap<String, regex::Regex>, files: &'a [SelectionRuleFile], from: &str, to: &str, transitive: bool) -> Option<(&'a SelectionRuleFile, &'a SelectionRelationRule)> {
    let mut applying: Vec<_> = files.iter().filter(|file| inside(&file.directory, from) || inside(&file.directory, to)).collect();
    let depth = |dir: &str| if dir.is_empty() { 0 } else { dir.split('/').count() };
    applying.sort_by(|a, b| depth(&b.directory).cmp(&depth(&a.directory)).then_with(|| crate::order::code_unit(&a.directory, &b.directory)));
    for file in applying { for rule in &file.rules {
        if rule.transitive.unwrap_or(false) == transitive && holds(matchers, &file.directory, rule.from.as_deref(), from) && holds(matchers, &file.directory, rule.to.as_deref(), to) { return Some((file, rule)) }
    }} None
}
fn key(matchers: &HashMap<String, regex::Regex>, files: &[SelectionRuleFile], seed: &str) -> Option<String> {
    let mut above = Vec::new(); let mut holding = Vec::new();
    for (at, file) in files.iter().enumerate() {
        if inside(&file.directory, seed) { above.push(at.to_string()); }
        for (index, rule) in file.rules.iter().enumerate() {
            if rule.transitive.unwrap_or(false) && holds(matchers, &file.directory, rule.from.as_deref(), seed) { holding.push(format!("{at}.{index}")); }
        }
    }
    (!holding.is_empty()).then(|| format!("{}|{}", above.join(","), holding.join(",")))
}
fn seeds_behind(graph: &State, group: &[u32], restricted: &HashSet<u32>, at: u32) -> u32 {
    if restricted.contains(&at) { return u32::from(group.contains(&at)) }
    let back = graph.search(&[at], true, &[true; 8], restricted, &HashMap::new());
    group.iter().filter(|&&seed| back.mask[seed as usize] || (restricted.contains(&seed) && graph.depends.row(seed).any(|(to, _)| back.mask[to as usize]))).count() as u32
}

#[napi]
impl SelectionGraph {
    #[napi]
    pub fn restrictions(&self, files: Vec<SelectionRuleFile>, seeds: Vec<String>) -> SelectionRestrictions {
        let graph = &self.state;
        let mut matchers = HashMap::new();
        for file in &files { for rule in &file.rules { for pattern in [&rule.from, &rule.to].into_iter().flatten() {
            let written = if pattern == "." { "" } else { pattern.strip_prefix("./").unwrap_or(pattern).trim_end_matches('/') };
            let resolved = if file.directory.is_empty() { written.to_owned() } else if written.is_empty() { file.directory.clone() } else { format!("{}/{written}", file.directory) };
            matchers.entry(resolved).or_insert_with_key(|pattern| glob(pattern));
        }}}
        let mut imports = Vec::new();
        for (id, from) in graph.names.iter().enumerate() {
            if graph.kinds[id] != 0 || !graph.sources.contains(from) { continue }
            let mut seen = HashSet::new();
            for (to, _) in graph.depends.row(id as u32) {
                if graph.kinds[to as usize] != 0 || !seen.insert(to) { continue }
                let to = &graph.names[to as usize];
                let Some((file, rule)) = decision(&matchers, &files, from, to, false).filter(|(_, rule)| rule.r#type == "restricted") else { continue };
                imports.push(SelectionViolation { from: from.clone(), to: to.clone(), directory: file.directory.clone(), message: rule.message.clone() });
            }
        }
        let mut groups: Vec<Vec<u32>> = Vec::new(); let mut group_ids = HashMap::new();
        for seed in seeds {
            let Some(id) = graph.file(&seed) else { continue };
            let Some(key) = key(&matchers, &files, &seed) else { continue };
            let next = groups.len(); let at = *group_ids.entry(key).or_insert(next);
            if at == groups.len() { groups.push(Vec::new()); } groups[at].push(id);
        }
        let mut found: HashMap<(u32, u32), SelectionChainViolation> = HashMap::new();
        for group in groups {
            let judged = &graph.names[group[0] as usize];
            let restricted: HashMap<_, _> = graph.names.iter().enumerate().filter(|(id, _)| graph.kinds[*id] == 0)
                .filter_map(|(id, name)| decision(&matchers, &files, judged, name, true).filter(|(_, rule)| rule.r#type == "restricted").map(|decision| (id as u32, decision))).collect();
            let restricted_ids: HashSet<_> = restricted.keys().copied().collect();
            let walls = restricted_ids.iter().filter(|id| !group.contains(id)).copied().collect();
            let walk = graph.search(&group, false, &[true; 8], &walls, &HashMap::new());
            for at in walk.nodes {
                let mut arrived = HashSet::new(); let mut carry = None;
                for (to, _) in graph.depends.row(at) {
                    let Some((file, rule)) = restricted.get(&to) else { continue };
                    if !arrived.insert(to) { continue }
                    let (seeds, chain) = carry.get_or_insert_with(|| {
                        let seeds = seeds_behind(graph, &group, &restricted_ids, at);
                        let mut chain = Vec::new(); let mut cursor = at as i64;
                        while cursor >= 0 { chain.push(graph.names[cursor as usize].clone()); cursor = walk.parents[cursor as usize]; } chain.reverse();
                        (seeds, chain)
                    });
                    if let Some(held) = found.get_mut(&(at, to)) { held.seeds += *seeds; if chain.len() < held.chain.len() { held.chain = chain.clone(); } }
                    else { found.insert((at, to), SelectionChainViolation { from: graph.names[at as usize].clone(), to: graph.names[to as usize].clone(), directory: file.directory.clone(), message: rule.message.clone(), chain: chain.clone(), seeds: *seeds }); }
                }
            }
        }
        let mut chains: Vec<_> = found.into_values().collect();
        imports.sort_by(|a, b| crate::order::code_unit(&a.from, &b.from).then_with(|| crate::order::code_unit(&a.to, &b.to)));
        chains.sort_by(|a, b| crate::order::code_unit(&a.from, &b.from).then_with(|| crate::order::code_unit(&a.to, &b.to)));
        SelectionRestrictions { imports, chains }
    }
}
