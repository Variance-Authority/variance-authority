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

use rayon::prelude::*;
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
    let mut next: Vec<Vec<u32>> = vec![Vec::new(); n];
    for &(a, b, _) in &read.edges {
        next[a as usize].push(b);
    }
    // A component is numbered after every one it takes, so the lowest first
    // has each layer below it settled.
    let (component, count) = components(n, |at| next[at].as_slice());
    let mut below: Vec<Vec<u32>> = vec![Vec::new(); count as usize];
    for (at, &c) in component.iter().enumerate() {
        below[c as usize].extend(next[at].iter().map(|&to| component[to as usize]).filter(|&to| to != c));
    }
    let mut layer_of = vec![1u32; count as usize];
    for c in 0..count as usize {
        layer_of[c] = below[c].iter().map(|&to| layer_of[to as usize] + 1).max().unwrap_or(1);
    }
    let layers: Vec<u32> = component.iter().map(|&c| layer_of[c as usize]).collect();
    let count = layers.iter().copied().max().unwrap_or(0);
    (layers, count)
}

/// Each area's edges, by position in `edges`, in order: those with an end
/// the area holds.
///
/// An edge counts on a page only when the page's area holds one of its ends,
/// and the areas holding a package are its deepest one and that one's
/// ancestors, since an area's members hold its parts'. So each page reads only
/// its own edges, and the cost is the edges times the depth rather than the
/// edges times the areas. The second end's chain runs right after the first's,
/// so an area both chains share already ends with the edge.
fn held(edges: &[(u32, u32, u32)], deepest: &[Option<usize>], parent: &[Option<usize>]) -> Vec<Vec<usize>> {
    let mut held: Vec<Vec<usize>> = vec![Vec::new(); parent.len()];
    for (at, &(a, b, _)) in edges.iter().enumerate() {
        for end in [a, b] {
            let mut chain = deepest[end as usize];
            while let Some(x) = chain {
                if held[x].last() != Some(&at) {
                    held[x].push(at);
                }
                chain = parent[x];
            }
        }
    }
    held
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
        .par_iter()
        .zip(held(&read.edges, &deepest, &parent))
        .enumerate()
        .map(|(here, (focus, held))| {
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
            let kid: HashMap<usize, usize> = focus.kids.iter().enumerate().map(|(i, &x)| (x, i)).collect();
            let mut incoming = vec![0u32; focus.kids.len()];
            let mut outgoing = vec![0u32; focus.kids.len()];
            let mut landed: Vec<HashMap<usize, u32>> = vec![HashMap::new(); focus.kids.len()];
            let mut roads: Vec<HashMap<usize, u32>> = vec![HashMap::new(); focus.kids.len()];
            for &(a, b, count) in held.iter().map(|&at| &read.edges[at]) {
                let (a, b) = (a as usize, b as usize);
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

/// Each of `total` nodes' strongly connected component, by Tarjan's algorithm
/// without recursion, and how many there are, where `outgoing` gives a node's
/// successors. A component is numbered once every one it reaches is, so an
/// edge never runs to a higher number, and `layers` folds them in that order.
fn components<'a>(total: usize, outgoing: impl Fn(usize) -> &'a [u32]) -> (Vec<u32>, u32) {
    const UNSEEN: u32 = u32::MAX;
    let (mut index, mut low, mut held) = (vec![UNSEEN; total], vec![0u32; total], vec![false; total]);
    let mut component = vec![UNSEEN; total];
    let (mut stack, mut calls): (Vec<u32>, Vec<(u32, u32)>) = (Vec::new(), Vec::new());
    let (mut next, mut count) = (0u32, 0u32);
    for root in 0..total {
        if index[root] != UNSEEN {
            continue;
        }
        index[root] = next;
        low[root] = next;
        next += 1;
        stack.push(root as u32);
        held[root] = true;
        calls.push((root as u32, 0));
        while let Some(&(at, edge)) = calls.last() {
            let at = at as usize;
            if let Some(&to) = outgoing(at).get(edge as usize) {
                calls.last_mut().expect("a call is open").1 += 1;
                let to = to as usize;
                if index[to] == UNSEEN {
                    index[to] = next;
                    low[to] = next;
                    next += 1;
                    stack.push(to as u32);
                    held[to] = true;
                    calls.push((to as u32, 0));
                } else if held[to] {
                    low[at] = low[at].min(index[to]);
                }
                continue;
            }
            calls.pop();
            if let Some(&(caller, _)) = calls.last() {
                low[caller as usize] = low[caller as usize].min(low[at]);
            }
            if low[at] == index[at] {
                loop {
                    let member = stack.pop().expect("the component's root is on the stack") as usize;
                    held[member] = false;
                    component[member] = count;
                    if member == at {
                        break;
                    }
                }
                count += 1;
            }
        }
    }
    (component, count)
}

#[cfg(test)]
mod tests {
    use super::held;

    /// Whether `area` is `inner` or one of its ancestors.
    fn holds(parent: &[Option<usize>], area: usize, inner: Option<usize>) -> bool {
        let mut at = inner;
        while let Some(x) = at {
            if x == area {
                return true;
            }
            at = parent[x];
        }
        false
    }

    #[test]
    fn each_area_holds_every_edge_with_an_end_inside_it_once_even_where_the_two_chains_meet() {
        // 0 ⊃ 1 ⊃ 2 ⊃ 3 ⊃ 4, 3 ⊃ 5, 1 ⊃ 6 and 7 at the top: the ends of an edge
        // between areas 4 and 5 share three ancestors, and one between 4 and 6
        // shares two.
        let parent = vec![None, Some(0), Some(1), Some(2), Some(3), Some(3), Some(1), Some(0)];
        // Packages 0..7 sit deepest in the area of their number; package 8 in none.
        let deepest: Vec<Option<usize>> = (0..8).map(Some).chain([None]).collect();
        let edges = vec![(4, 5, 1), (4, 6, 1), (4, 4, 1), (5, 7, 1), (8, 4, 1), (8, 8, 1), (2, 3, 1)];
        let found = held(&edges, &deepest, &parent);
        let expected: Vec<Vec<usize>> = (0..parent.len())
            .map(|area| {
                (0..edges.len())
                    .filter(|&at| {
                        let (a, b, _) = edges[at];
                        holds(&parent, area, deepest[a as usize]) || holds(&parent, area, deepest[b as usize])
                    })
                    .collect()
            })
            .collect();
        assert_eq!(found, expected);
        assert_eq!(found[3], vec![0, 1, 2, 3, 4, 6]);
        assert_eq!(found[7], vec![3]);
    }
}
