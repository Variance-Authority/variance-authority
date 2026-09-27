//! Three signals, each able to propose a group of packages on its own: where a
//! package sits (every directory above it), what it is called (a leading run
//! of the words in its name, or one word anywhere in it), and how it is used
//! (the communities it is taken with, the package that takes most of it, the
//! shape of what it offers, whether only tests take it, whether the manifests
//! take it for development). The fold (`orient_map_tree.rs`) scores every
//! proposal on all three, so a part says which signals agree with it.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use regex::Regex;

use crate::louvain::louvain;
use crate::orient_map_read::Read;

pub(crate) struct Signals {
    /// The packages the map folds: every one but the root's, in name order.
    /// Everything below is indexed by position in it.
    pub packages: Vec<u32>,
    /// The words of each name, less its scope and a house prefix most carry.
    pub tokens: Vec<Vec<String>>,
    /// Each signal's keys per package: where, named, used.
    pub keys: [Vec<Vec<String>>; 3],
    /// Connections weighted by how much of each end they are.
    pub wedges: Vec<(usize, usize, f64)>,
    /// What the manifests take only for development.
    pub development: HashSet<usize>,
}

/// A package's name as words: no ` (directory)`, no scope, lower case.
fn raw(name: &str) -> Vec<String> {
    let name = name.find(" (").filter(|_| name.ends_with(')')).map_or(name, |at| &name[..at]);
    let name = match name.strip_prefix('@').and_then(|rest| rest.split_once('/')) {
        Some((_, rest)) => rest,
        None => name,
    };
    name.to_lowercase().split(['-', '_', '.', '/']).filter(|word| !word.is_empty()).map(str::to_owned).collect()
}

/// A symbol's name as words: `AssigneeField` is `assignee field`.
pub(crate) struct Words(Regex, Regex, Regex);

impl Words {
    pub fn new() -> Words {
        let pattern = |text: &str| Regex::new(text).expect("the pattern is fixed");
        Words(pattern("([a-z0-9])([A-Z])"), pattern("([A-Z]+)([A-Z][a-z])"), pattern("[^a-z0-9]+"))
    }

    pub fn of(&self, name: &str) -> Vec<String> {
        let spaced = self.0.replace_all(name, "$1 $2");
        let spaced = self.1.replace_all(&spaced, "$1 $2").to_lowercase();
        self.2.split(&spaced).filter(|word| !word.is_empty()).map(str::to_owned).collect()
    }
}

pub(crate) fn signals(read: &Read) -> Signals {
    let packages: Vec<u32> =
        (0..read.packages.len() as u32).filter(|&at| !read.packages[at as usize].directory.is_empty()).collect();
    let n = packages.len();
    let at: HashMap<u32, usize> = packages.iter().enumerate().map(|(i, &p)| (p, i)).collect();
    let name = |i: usize| read.packages[packages[i] as usize].name.as_str();

    // ---------- what it is called ----------
    let raws: Vec<Vec<String>> = (0..n).map(|i| raw(name(i))).collect();
    let mut first: Vec<(&str, usize)> = Vec::new();
    for words in &raws {
        if let Some(word) = words.first() {
            match first.iter_mut().find(|(seen, _)| *seen == word) {
                Some(entry) => entry.1 += 1,
                None => first.push((word, 1)),
            }
        }
    }
    let house = first.iter().fold(None::<(&str, usize)>, |best, &(word, count)| match best {
        Some((_, most)) if most >= count => best,
        _ => Some((word, count)),
    });
    let house = house.filter(|&(_, count)| count as f64 > 0.3 * n as f64).map(|(word, _)| word.to_owned());
    let tokens: Vec<Vec<String>> = raws
        .iter()
        .map(|words| match &house {
            Some(house) if words.len() > 1 && &words[0] == house => words[1..].to_vec(),
            _ => words.clone(),
        })
        .collect();
    // A word ending names across many stems says what a package is (types,
    // mocks, server), not which part of the product it belongs to.
    let mut after: HashMap<&str, HashSet<String>> = HashMap::new();
    for words in &tokens {
        for i in 1..words.len() {
            after.entry(&words[i]).or_default().insert(words[..i].join("-"));
        }
    }
    let role: HashSet<&str> = after.iter().filter(|(_, stems)| stems.len() >= 8).map(|(word, _)| *word).collect();
    let named: Vec<Vec<String>> = tokens
        .iter()
        .map(|words| {
            let mut keys: Vec<String> = (1..=words.len()).map(|k| format!("{}-*", words[..k].join("-"))).collect();
            keys.extend(words.iter().filter(|word| !role.contains(word.as_str()) && word.len() > 1).map(|word| format!("*{word}*")));
            unique(keys)
        })
        .collect();

    // ---------- where it sits ----------
    let place: Vec<Vec<String>> = (0..n)
        .map(|i| {
            let segments: Vec<&str> = read.packages[packages[i] as usize].directory.split('/').collect();
            (1..=segments.len()).map(|k| segments[..k].join("/")).collect()
        })
        .collect();

    // ---------- how it is used ----------
    let (mut into, mut out) = (vec![0u32; n], vec![0u32; n]);
    let mut from: Vec<Vec<(usize, u32)>> = vec![Vec::new(); n];
    let mut seen_order: Vec<usize> = Vec::new();
    for &(a, b, files) in &read.edges {
        let (Some(&a), Some(&b)) = (at.get(&a), at.get(&b)) else { continue };
        into[b] += files;
        out[a] += files;
        if from[b].is_empty() {
            seen_order.push(b);
        }
        from[b].push((a, files));
    }
    // Taken mainly by one package: a registry and its entries.
    let main: Vec<Option<usize>> = (0..n)
        .map(|b| {
            let top = from[b].iter().copied().min_by(|x, y| y.1.cmp(&x.1).then_with(|| crate::order::code_unit(name(x.0), name(y.0))))?;
            (top.1 as f64 >= 0.5 * into[b] as f64).then_some(top.0)
        })
        .collect();
    let mut wedges: Vec<(usize, usize, f64)> = Vec::new();
    for &b in &seen_order {
        for &(a, files) in &from[b] {
            wedges.push((a, b, files as f64 / (out[a] as f64 * into[b] as f64).sqrt()));
        }
    }
    let passes = louvain(n, &wedges);
    let words = Words::new();
    let offers: Vec<Option<String>> = (0..n)
        .map(|i| {
            let head = &read.head[packages[i] as usize];
            if head.is_empty() {
                return None;
            }
            let own: HashSet<String> = tokens[i].iter().flat_map(|token| words.of(token)).collect();
            let shown = head.iter().map(|name| match name.as_str() {
                "*" | "default" => name.clone(),
                _ => {
                    let rest: Vec<String> = words.of(name).into_iter().filter(|word| !own.contains(word)).collect();
                    if rest.is_empty() { "(its own name)".to_owned() } else { rest.join("-") }
                }
            });
            let mut shown = unique(shown.collect());
            shown.sort_by(|a, b| crate::order::code_unit(a, b));
            Some(shown.join(" | "))
        })
        .collect();
    let development: HashSet<usize> =
        (0..n).filter(|&i| read.develops.contains(name(i)) && !read.depends.contains(name(i))).collect();
    let used: Vec<Vec<String>> = (0..n)
        .map(|i| {
            let mut keys: Vec<String> = passes.iter().enumerate().map(|(k, pass)| format!("together {k}:{}", pass[i])).collect();
            if let Some(main) = main[i] {
                keys.push(format!("taken by:{}", name(main)));
            }
            if let Some(offers) = &offers[i] {
                keys.push(format!("offers:{offers}"));
            }
            let (tests, shipped) = (read.tested[packages[i] as usize], into[i]);
            if (tests > 0 && tests >= 4 * shipped) || (read.source[packages[i] as usize] == 0 && tests + shipped == 0) {
                keys.push("only tests take it".to_owned());
            }
            if development.contains(&i) {
                keys.push("for development".to_owned());
            }
            keys
        })
        .collect();
    Signals { packages, tokens, keys: [place, named, used], wedges, development }
}

/// `values` without repeats, in the order first seen.
fn unique(values: Vec<String>) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    values.into_iter().filter(|value| seen.insert(value.clone())).collect()
}

#[cfg(test)]
mod tests {
    use super::{raw, Words};

    #[test]
    fn a_name_is_its_words() {
        assert_eq!(raw("@kbn/core-http-server (src/copy)"), ["core", "http", "server"]);
        assert_eq!(raw("docusaurus_theme.classic"), ["docusaurus", "theme", "classic"]);
    }

    #[test]
    fn a_symbol_is_its_words() {
        assert_eq!(Words::new().of("AssigneeField"), ["assignee", "field"]);
        assert_eq!(Words::new().of("HTTPServer"), ["http", "server"]);
    }
}
