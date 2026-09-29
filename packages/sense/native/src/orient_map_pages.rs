//! The fold as pages: every area gets one, listing the areas inside it one
//! row each, so a page's length is the fold's fan-out and never the package
//! count. A row says how large the area is, where it sits in the dependency
//! layers, its front — the packages imports from outside land on, as many as
//! it takes to hold half of them — and the areas it uses most.
//!
//! A dependency layer is one more than the highest layer among the packages
//! a package takes: one that takes nothing is layer 1, and a cycle is one step.

// compass: variance-authority.reach.relations

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::order::code_unit;
use crate::orient_map_read::Read;
use crate::orient_map_signals::Signals;
use crate::orient_map_tree::Node;

/// A front lists packages until they hold this share of what comes in, or three.
const FRONT_HOLDS: f64 = 0.5;
const FRONT_MOST: usize = 3;

#[derive(Serialize, Deserialize)]
pub(crate) struct Row {
    pub id: String,
    pub name: String,
    pub packages: u32,
    pub files: u32,
    pub low: u32,
    pub high: u32,
    pub median: u32,
    /// Files outside the area importing into it, and the packages they land on.
    pub incoming: u32,
    pub front: Vec<(String, u32)>,
    pub more: u32,
    /// Files of the area importing out of it, and the areas they land in.
    pub outgoing: u32,
    pub uses: Vec<(String, u32)>,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct Page {
    /// `''` for the top page.
    pub id: String,
    pub name: String,
    pub packages: u32,
    pub files: u32,
    pub low: u32,
    pub high: u32,
    pub alone: u32,
    pub rows: Vec<Row>,
    /// The packages no area inside this one took: all of them in an area with
    /// no areas inside it.
    pub list: Vec<String>,
}

/// Each package's dependency layer, and how many layers there are.
pub(crate) fn layers(read: &Read) -> (Vec<u32>, u32) {
    let n = read.packages.len();
    let mut next: Vec<Vec<usize>> = vec![Vec::new(); n];
    for &(a, b, _) in &read.edges {
        next[a as usize].push(b as usize);
    }
    // Tarjan, without recursion; a component closes after everything it takes.
    let (mut index, mut low) = (vec![usize::MAX; n], vec![0usize; n]);
    let (mut on, mut stack, mut counter) = (vec![false; n], Vec::new(), 0usize);
    let mut component = vec![usize::MAX; n];
    let mut layer_of: Vec<u32> = Vec::new();
    for start in 0..n {
        if index[start] != usize::MAX {
            continue;
        }
        let mut work: Vec<(usize, usize)> = vec![(start, 0)];
        index[start] = counter;
        low[start] = counter;
        counter += 1;
        stack.push(start);
        on[start] = true;
        while let Some(&mut (v, ref mut edge)) = work.last_mut() {
            if *edge < next[v].len() {
                let w = next[v][*edge];
                *edge += 1;
                if index[w] == usize::MAX {
                    index[w] = counter;
                    low[w] = counter;
                    counter += 1;
                    stack.push(w);
                    on[w] = true;
                    work.push((w, 0));
                } else if on[w] {
                    low[v] = low[v].min(index[w]);
                }
                continue;
            }
            work.pop();
            if let Some(&(u, _)) = work.last() {
                low[u] = low[u].min(low[v]);
            }
            if low[v] == index[v] {
                let c = layer_of.len();
                let mut members = Vec::new();
                loop {
                    let w = stack.pop().expect("the component's root is on the stack");
                    on[w] = false;
                    component[w] = c;
                    members.push(w);
                    if w == v {
                        break;
                    }
                }
                let layer = members
                    .iter()
                    .flat_map(|&i| next[i].iter())
                    .filter(|&&j| component[j] != c)
                    .map(|&j| layer_of[component[j]] + 1)
                    .max()
                    .unwrap_or(1);
                layer_of.push(layer);
            }
        }
    }
    let layers: Vec<u32> = component.iter().map(|&c| layer_of[c]).collect();
    let count = layers.iter().copied().max().unwrap_or(0);
    (layers, count)
}

/// The scope-less name a row shows: `@kbn/core` is `core`.
fn short(name: &str) -> &str {
    match name.strip_prefix('@').and_then(|rest| rest.split_once('/')) {
        Some((_, rest)) => rest,
        None => name,
    }
}

/// Every area named by the words of its packages' names that set it apart
/// from its siblings, after the deepest directory holding most of it when the
/// siblings do not share that directory; else by the two packages most others
/// import.
pub(crate) fn names(node: &Node, signals: &Signals, read: &Read, importers: &[u32], into: &mut Vec<String>) {
    let tokens = |p: usize| signals.tokens[p].iter().filter(|word| word.len() > 1).map(String::as_str).collect::<Vec<_>>();
    let directory = |p: usize| read.packages[signals.packages[p] as usize].directory.as_str();
    let distinct = |p: usize| {
        let mut seen = HashSet::new();
        tokens(p).into_iter().filter(|word| seen.insert(*word)).collect::<Vec<_>>()
    };
    let mut all: HashMap<&str, usize> = HashMap::new();
    for part in &node.parts {
        for &p in &part.members {
            for word in distinct(p) {
                *all.entry(word).or_default() += 1;
            }
        }
    }
    for part in &node.parts {
        let size = part.members.len();
        let mut count: Vec<(&str, usize)> = Vec::new();
        for &p in &part.members {
            for word in distinct(p) {
                match count.iter_mut().find(|(seen, _)| *seen == word) {
                    Some(entry) => entry.1 += 1,
                    None => count.push((word, 1)),
                }
            }
        }
        let mut words: Vec<(&str, f64)> = count
            .iter()
            .filter(|&&(word, x)| (x as f64 >= 2f64.max(size as f64 / 4.0) || size < 4) && x as f64 >= 0.5 * all[word] as f64)
            .map(|&(word, x)| (word, (x as f64 / size as f64) * (x as f64 / all[word] as f64)))
            .collect();
        words.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal).then_with(|| code_unit(a.0, b.0)));
        words.truncate(3);
        // In the order the words stand in the names.
        let position = |word: &str| {
            let (mut total, mut n) = (0f64, 0f64);
            for &p in &part.members {
                let words = tokens(p);
                if let Some(at) = words.iter().position(|w| *w == word) {
                    total += at as f64 / words.len() as f64;
                    n += 1.0;
                }
            }
            total / n
        };
        words.sort_by(|a, b| position(a.0).partial_cmp(&position(b.0)).unwrap_or(Ordering::Equal));
        let mut directories: Vec<(String, usize)> = Vec::new();
        for &p in &part.members {
            let segments: Vec<&str> = directory(p).split('/').collect();
            for d in 1..segments.len() {
                let above = segments[..d].join("/");
                match directories.iter_mut().find(|(seen, _)| *seen == above) {
                    Some(entry) => entry.1 += 1,
                    None => directories.push((above, 1)),
                }
            }
        }
        let beside = |above: &str| {
            let prefix = format!("{above}/");
            node.parts
                .iter()
                .filter(|other| !std::ptr::eq(*other, part))
                .map(|other| other.members.iter().filter(|&&p| directory(p).starts_with(&prefix)).count())
                .sum::<usize>()
        };
        let mut held: Vec<&(String, usize)> = directories
            .iter()
            .filter(|(above, x)| *x as f64 >= 0.8 * size as f64 && (beside(above) as f64) < 0.25 * *x as f64)
            .collect();
        held.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
        let mut name: Vec<String> = Vec::new();
        if let Some((above, _)) = held.first() {
            name.push(format!("{above}/"));
        }
        let words = words.iter().map(|w| w.0).collect::<Vec<_>>().join(" ");
        if !words.is_empty() {
            name.push(words);
        }
        let mut name = name.join(" ");
        if name.is_empty() {
            let mut most = part.members.clone();
            most.sort_by(|&a, &b| importers[signals.packages[b] as usize].cmp(&importers[signals.packages[a] as usize]));
            let two: Vec<&str> = most.iter().take(2).map(|&p| short(&read.packages[signals.packages[p] as usize].name)).collect();
            name = format!("around {}", two.join(", "));
        }
        if part.answered {
            name = format!("{name} — for development (the manifests)");
        }
        into.push(name);
        names(part, signals, read, importers, into);
    }
}

/// One area as a page is built from: its node, its id and its name.
pub(crate) struct Area<'a> {
    pub node: &'a Node,
    pub id: String,
    pub name: String,
    /// Positions in the area list of its parts, largest first.
    pub kids: Vec<usize>,
}

/// Areas in walk order, the top first, each numbered by its place among its
/// siblings, largest first: `1`, `1.2`, `1.2.3`.
pub(crate) fn number<'a>(root: &'a Node, names: &[String]) -> Vec<Area<'a>> {
    // `names()` walks depth first over `parts`, a part's name before its
    // descendants', so this walk takes them in the same order.
    fn visit<'a>(node: &'a Node, id: String, name: String, names: &mut std::slice::Iter<String>, areas: &mut Vec<Area<'a>>) -> usize {
        let at = areas.len();
        areas.push(Area { node, id: id.clone(), name, kids: Vec::new() });
        let mut order: Vec<usize> = (0..node.parts.len()).collect();
        order.sort_by(|&a, &b| node.parts[b].members.len().cmp(&node.parts[a].members.len()));
        let mut place = vec![0usize; node.parts.len()];
        for (rank, &part) in order.iter().enumerate() {
            place[part] = rank + 1;
        }
        let mut kids = vec![0usize; node.parts.len()];
        for (i, part) in node.parts.iter().enumerate() {
            let name = names.next().cloned().unwrap_or_default();
            let child = if id.is_empty() { place[i].to_string() } else { format!("{id}.{}", place[i]) };
            kids[i] = visit(part, child, name, names, areas);
        }
        areas[at].kids = order.iter().map(|&part| kids[part]).collect();
        at
    }
    let mut areas = Vec::new();
    visit(root, String::new(), String::new(), &mut names.iter(), &mut areas);
    areas
}

/// Every page of the map, the top first: each area's rows are its own areas,
/// with what comes into each and where each goes, counted in files.
pub(crate) fn pages(read: &Read, signals: &Signals, areas: &[Area], layer: &[u32]) -> Vec<Page> {
    let n = read.packages.len();
    // Each package's deepest area, and each area's parent.
    let mut deepest: Vec<Option<usize>> = vec![None; n];
    let mut parent: Vec<Option<usize>> = vec![None; areas.len()];
    for (at, area) in areas.iter().enumerate() {
        for &kid in &area.kids {
            parent[kid] = Some(at);
        }
        for &p in &area.node.members {
            deepest[signals.packages[p] as usize] = Some(at);
        }
    }
    let package = |p: usize| signals.packages[p] as usize;
    let files = |node: &Node| node.members.iter().map(|&p| read.source[package(p)]).sum::<u32>();
    let span = |node: &Node| {
        let mut ls: Vec<u32> = node.members.iter().map(|&p| layer[package(p)]).collect();
        ls.sort_unstable();
        (ls[0], ls[ls.len() - 1], ls[ls.len() >> 1])
    };
    areas
        .iter()
        .enumerate()
        .map(|(here, focus)| {
            // The other end of a connection as this page sees it: one of the
            // focus's areas, the focus itself for a package no area of it
            // took, else the top-level area holding it.
            let view: HashSet<usize> = focus.kids.iter().chain(&areas[0].kids).copied().collect();
            let area_at = |package: usize| {
                let mut at = deepest[package];
                while let Some(x) = at {
                    if x == here || view.contains(&x) {
                        return Some(x);
                    }
                    at = parent[x];
                }
                None
            };
            let inner: HashSet<usize> = focus.node.members.iter().map(|&p| package(p)).collect();
            let kid: HashMap<usize, usize> = focus.kids.iter().enumerate().map(|(i, &x)| (x, i)).collect();
            let mut incoming = vec![0u32; focus.kids.len()];
            let mut outgoing = vec![0u32; focus.kids.len()];
            let mut landed: Vec<HashMap<usize, u32>> = vec![HashMap::new(); focus.kids.len()];
            let mut roads: Vec<HashMap<usize, u32>> = vec![HashMap::new(); focus.kids.len()];
            for &(a, b, count) in &read.edges {
                let (a, b) = (a as usize, b as usize);
                if !inner.contains(&a) && !inner.contains(&b) {
                    continue;
                }
                let (sa, sb) = (area_at(a), area_at(b));
                if sa == sb {
                    continue;
                }
                if let Some(&i) = sb.and_then(|x| kid.get(&x)) {
                    incoming[i] += count;
                    *landed[i].entry(b).or_default() += count;
                }
                if let (Some(&i), Some(sb)) = (sa.and_then(|x| kid.get(&x)), sb) {
                    outgoing[i] += count;
                    // The page's own area holds the row; it is not a road.
                    if sb != here {
                        *roads[i].entry(sb).or_default() += count;
                    }
                }
            }
            let rows = focus
                .kids
                .iter()
                .enumerate()
                .map(|(i, &x)| {
                    let area = &areas[x];
                    let mut front: Vec<(&str, u32)> = landed[i].iter().map(|(&b, &count)| (read.packages[b].name.as_str(), count)).collect();
                    front.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| code_unit(a.0, b.0)));
                    let mut lead: Vec<(String, u32)> = Vec::new();
                    let mut held = 0u32;
                    for &(name, count) in &front {
                        if held as f64 >= FRONT_HOLDS * incoming[i] as f64 && !lead.is_empty() {
                            break;
                        }
                        lead.push((name.to_owned(), count));
                        held += count;
                        if lead.len() == FRONT_MOST {
                            break;
                        }
                    }
                    let mut uses: Vec<(&str, u32)> = roads[i].iter().map(|(&to, &count)| (areas[to].id.as_str(), count)).collect();
                    uses.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| code_unit(a.0, b.0)));
                    let (low, high, median) = span(area.node);
                    Row {
                        id: area.id.clone(),
                        name: area.name.clone(),
                        packages: area.node.members.len() as u32,
                        files: files(area.node),
                        low,
                        high,
                        median,
                        incoming: incoming[i],
                        more: (front.len() - lead.len()) as u32,
                        front: lead,
                        outgoing: outgoing[i],
                        uses: uses.into_iter().take(2).map(|(id, count)| (id.to_owned(), count)).collect(),
                    }
                })
                .collect();
            let (low, high, _) = span(focus.node);
            // Packages no area of the page took are listed after its rows, so
            // every package is on some page.
            let list = focus.node.alone.iter().map(|&p| read.packages[package(p)].name.clone()).collect();
            Page {
                id: focus.id.clone(),
                name: focus.name.clone(),
                packages: focus.node.members.len() as u32,
                files: files(focus.node),
                low,
                high,
                alone: focus.node.alone.len() as u32,
                rows,
                list,
            }
        })
        .collect()
}
