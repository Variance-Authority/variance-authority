//! The static call graph the journeys walk runs over: every file the recorded
//! files and the test files reach through imports and re-exports, parsed as the
//! recording saw it, with each call site's target resolved once.
//!
//! Which file a specifier names is the source index's answer. The graph
//! resolves one itself only where the index has none — a request it left
//! unresolved, or a file it holds no aligned parse for — and counts each one,
//! so the prepared file says how much of the graph is the index's.
//!
//! A recording's lines are coordinates in the tree it ran over, and git owns
//! that tree: a file changed since the recorded commit is parsed from that
//! commit, and one that did not exist there is not parsed at all.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};
use std::path::Path;

use rayon::prelude::*;

use crate::compact::Layer;
use crate::journeys_parse::{parse, Callee, Export, Parsed};
use crate::package_graph::{fold, join_parses, At, Crossing};
use crate::resolve::Resolvers;

/// How a resolved call names its target.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum How {
    Callback,
    Local,
    Import,
    Namespace,
}

/// A call site's target, or why the relations name none.
#[derive(Clone, Debug)]
pub(crate) enum Target {
    Fn { file: u32, func: u32, how: How },
    /// An import the index resolves outside the checkout, or not at all.
    External,
    /// A name no import and no local function declares.
    Free,
    /// A member of a value the relations cannot follow.
    Member,
    /// An import that lands on a declaration that is not a function.
    NotFunction { file: u32, local: String },
}

pub(crate) struct Graph {
    pub files: Vec<String>,
    pub ids: HashMap<String, u32>,
    pub parsed: Vec<Option<Parsed>>,
    /// Per file: each specifier it writes and the file it names, when that is
    /// a file of the checkout.
    specs: Vec<HashMap<String, Option<u32>>>,
    /// Per file, per call: its target.
    pub targets: Vec<Vec<Target>>,
    /// Per file: its calls grouped by the function they are written in — the
    /// top level first, then function `k` at `k + 1` — each group in the
    /// order the calls end.
    pub calls_from: Vec<Vec<Vec<u32>>>,
    /// Specifiers the index did not answer, which the graph resolved itself.
    pub fell_back: u32,
    /// Why the files were parsed as the working tree holds them rather than as
    /// the recorded commit did; absent when the commit's tree was read.
    pub tree: Option<String>,
}

pub(crate) fn code(path: &str) -> bool {
    let extension = path.rsplit('/').next().and_then(|name| name.rsplit_once('.')).map_or("", |(_, extension)| extension);
    matches!(extension, "js" | "jsx" | "ts" | "tsx" | "cjs" | "mjs" | "cts" | "mts")
}

fn bare(value: &str) -> bool {
    !value.starts_with('.') && !value.starts_with('/')
}

/// The text of every source file that differs between `commit` and the
/// working tree, as it was at `commit`: `None` for a file that did not exist
/// there. One diff and one `cat-file --batch`; a file not in the map is the
/// same on disk. Renames are not detected: a file moved since the commit is a
/// path the commit did not have, and the path it had is read from there under
/// its own name. When git cannot answer, the reason, which the prepared file
/// carries, since the graph is then the working tree's.
pub(crate) fn text_at(root: &str, commit: &str) -> Result<HashMap<String, Option<String>>, String> {
    let args = ["-c", "core.quotePath=false", "diff", "--name-only", "--no-renames", "-z", "--relative", commit];
    let Some(listed) = crate::git::git(root, &args, None) else {
        let known = crate::git::git(root, &["cat-file", "-e", &format!("{commit}^{{commit}}")], None).is_some();
        return Err(if known {
            format!("git could not list what changed since commit {}", short(commit))
        } else {
            format!("commit {} is not in this checkout's object store", short(commit))
        });
    };
    let changed: Vec<String> = listed
        .split(|&byte| byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| String::from_utf8_lossy(path).into_owned())
        .filter(|path| code(path))
        .collect();
    let mut texts = HashMap::new();
    if changed.is_empty() {
        return Ok(texts);
    }
    let unread = || format!("git could not read the files changed since commit {}", short(commit));
    let asked: String = changed.iter().map(|file| format!("{commit}:./{file}\n")).collect();
    let out = crate::git::git(root, &["cat-file", "--batch"], Some(asked.into_bytes())).ok_or_else(unread)?;
    let mut at = 0;
    for file in changed {
        let end = at + out.get(at..).and_then(|rest| rest.iter().position(|&byte| byte == b'\n')).ok_or_else(unread)?;
        let head = String::from_utf8_lossy(&out[at..end]).into_owned();
        at = end + 1;
        if head.ends_with(" missing") {
            texts.insert(file, None);
            continue;
        }
        let size: usize = head.rsplit(' ').next().and_then(|size| size.parse().ok()).ok_or_else(unread)?;
        let text = String::from_utf8_lossy(out.get(at..at + size).ok_or_else(unread)?).into_owned();
        texts.insert(file, Some(text));
        at += size + 1;
    }
    Ok(texts)
}

/// A commit as the output names one.
pub(crate) fn short(commit: &str) -> &str {
    commit.get(..12).unwrap_or(commit)
}

/// The index's answer per file and specifier: `Some(target)` for a file of
/// the checkout, `None` for a bare specifier it resolved to no path. A file
/// whose parse does not line up with its record's targets has no answers.
fn answers<'a>(layers: &'a [Layer<'a>], crossing: &Crossing<'a>) -> Option<HashMap<&'a str, Option<&'a str>>> {
    let (record_layer, record_row) = crossing.at;
    let (stored, records) = (&layers[record_layer].stored, &layers[record_layer].records);
    if records.targets_present[record_row] != 1 {
        return None;
    }
    let targets: Vec<Option<&str>> =
        records.targets.range(record_row).map(|target| stored.optional(records.target_path.at(target))).collect();
    let (parse_layer, parse_row) = crossing.parse?;
    let (text, parses) = (&layers[parse_layer].stored, &layers[parse_layer].parses);
    let range = parses.requests.range(parse_row);
    if range.len() != targets.len() {
        return None;
    }
    let mut answered = HashMap::new();
    for (request, to) in range.zip(targets) {
        let value = text.text(parses.request_value.at(request));
        match to {
            Some(to) => {
                answered.insert(value, Some(to));
            }
            None if bare(value) => {
                answered.entry(value).or_insert(None);
            }
            None => {}
        }
    }
    Some(answered)
}

/// One file read and parsed, with the files its specifiers name.
struct Read {
    parsed: Option<Parsed>,
    specs: Vec<(String, Option<String>)>,
    fell_back: u32,
}

impl Graph {
    /// The graph over everything `seeds` reach, read from the index's layers.
    /// `seeds` are interned first and in order, so their ids are their places.
    /// `commit` is the commit the recording ran at, or why there is none.
    pub(crate) fn build(root: &str, layers: &[Layer], commit: Result<&str, &str>, seeds: &[String]) -> Graph {
        let (then, index) = rayon::join(
            || commit.map_err(str::to_owned).and_then(|commit| text_at(root, commit)),
            || {
                let folded = fold(layers);
                let mut crossings: Vec<Crossing> = folded
                    .into_iter()
                    .filter(|(path, _)| code(path))
                    .map(|(file, at): (&str, At)| Crossing { file, owner: 0, others: Vec::new(), at, parse: None })
                    .collect();
                join_parses(layers, &mut crossings);
                crossings
            },
        );
        let by_file: HashMap<&str, usize> = index.iter().enumerate().map(|(at, crossing)| (crossing.file, at)).collect();
        let resolvers = Resolvers::new(None, None);
        let absolute = Path::new(root);
        let mut graph = Graph {
            files: Vec::new(),
            ids: HashMap::new(),
            parsed: Vec::new(),
            specs: Vec::new(),
            targets: Vec::new(),
            calls_from: Vec::new(),
            fell_back: 0,
            tree: None,
        };
        let then = then.map_err(|why| graph.tree = Some(why)).ok();
        let mut frontier: Vec<u32> = seeds.iter().map(|seed| graph.intern(seed)).collect();
        frontier.dedup();
        while !frontier.is_empty() {
            let read: Vec<Read> = frontier
                .par_iter()
                .map(|&id| {
                    let file = graph.files[id as usize].as_str();
                    let text = match then.as_ref().and_then(|then| then.get(file)) {
                        Some(then) => then.clone(),
                        None if code(file) => std::fs::read_to_string(absolute.join(file)).ok(),
                        None => None,
                    };
                    let Some(parsed) = text.filter(|_| code(file)).and_then(|text| parse(file, &text)) else {
                        return Read { parsed: None, specs: Vec::new(), fell_back: 0 };
                    };
                    let answered = by_file.get(file).and_then(|&at| answers(layers, &index[at]));
                    let mut written: Vec<&str> = parsed.imports.values().map(|import| import.spec.as_str()).collect();
                    written.extend(parsed.star.iter().map(String::as_str));
                    written.extend(parsed.exports.values().filter_map(|export| match export {
                        Export::From { spec, .. } => Some(spec.as_str()),
                        Export::Local(_) => None,
                    }));
                    written.sort_unstable();
                    written.dedup();
                    let mut fell_back = 0;
                    let specs = written
                        .into_iter()
                        .map(|spec| {
                            if let Some(&to) = answered.as_ref().and_then(|answered| answered.get(spec)) {
                                return (spec.to_owned(), to.map(str::to_owned));
                            }
                            fell_back += 1;
                            let to = resolvers
                                .resolve(absolute, &absolute.join(file), spec, None)
                                .filter(|to| !to.starts_with("..") && !to.split('/').any(|part| part == "node_modules"));
                            (spec.to_owned(), to)
                        })
                        .collect();
                    Read { parsed: Some(parsed), specs, fell_back }
                })
                .collect();
            let mut next = Vec::new();
            for (&id, read) in frontier.iter().zip(read) {
                graph.fell_back += read.fell_back;
                let mut specs = HashMap::new();
                for (spec, to) in read.specs {
                    let to = to.map(|to| {
                        let known = graph.ids.contains_key(&to);
                        let to = graph.intern(&to);
                        if !known {
                            next.push(to);
                        }
                        to
                    });
                    specs.insert(spec, to);
                }
                graph.specs[id as usize] = specs;
                graph.parsed[id as usize] = read.parsed;
            }
            frontier = next;
        }
        let targets: Vec<Vec<Target>> = (0..graph.files.len() as u32)
            .into_par_iter()
            .map(|file| match &graph.parsed[file as usize] {
                Some(parsed) => {
                    parsed.calls.iter().map(|call| graph.target_of(file, call.from, &call.callee, call.callback)).collect()
                }
                None => Vec::new(),
            })
            .collect();
        let calls_from: Vec<Vec<Vec<u32>>> = graph
            .parsed
            .par_iter()
            .map(|parsed| {
                let Some(parsed) = parsed else { return Vec::new() };
                let mut groups: Vec<Vec<u32>> = vec![Vec::new(); parsed.fns.len() + 1];
                for (at, call) in parsed.calls.iter().enumerate() {
                    groups[call.from.map_or(0, |from| from as usize + 1)].push(at as u32);
                }
                for group in &mut groups {
                    group.sort_by_key(|&at| parsed.calls[at as usize].col);
                }
                groups
            })
            .collect();
        graph.targets = targets;
        graph.calls_from = calls_from;
        graph
    }

    fn intern(&mut self, file: &str) -> u32 {
        if let Some(&id) = self.ids.get(file) {
            return id;
        }
        let id = self.files.len() as u32;
        self.files.push(file.to_owned());
        self.ids.insert(file.to_owned(), id);
        self.parsed.push(None);
        self.specs.push(HashMap::new());
        id
    }

    pub(crate) fn parsed(&self, file: u32) -> Option<&Parsed> {
        self.parsed.get(file as usize).and_then(Option::as_ref)
    }

    /// The file a specifier written in `file` names.
    pub(crate) fn resolve(&self, file: u32, spec: &str) -> Option<u32> {
        self.specs.get(file as usize).and_then(|specs| specs.get(spec)).copied().flatten()
    }

    /// An exported name followed to the file and local name that declare it.
    pub(crate) fn declaration_of(&self, file: u32, name: &str, seen: &mut HashSet<(u32, String)>) -> Option<(u32, String)> {
        if !seen.insert((file, name.to_owned())) {
            return None;
        }
        let parsed = self.parsed(file)?;
        match parsed.exports.get(name) {
            Some(Export::Local(local)) => match parsed.imports.get(local) {
                Some(import) => {
                    let to = self.resolve(file, &import.spec)?;
                    self.declaration_of(to, &import.name, seen)
                }
                None => Some((file, local.clone())),
            },
            Some(Export::From { spec, name }) => {
                let to = self.resolve(file, spec)?;
                self.declaration_of(to, name, seen)
            }
            None => parsed.star.iter().find_map(|spec| {
                let to = self.resolve(file, spec)?;
                self.declaration_of(to, name, seen)
            }),
        }
    }

    /// What a call written in function `from` of `file` calls.
    pub(crate) fn target_of(&self, file: u32, from: Option<u32>, callee: &Callee, callback: Option<u32>) -> Target {
        let Some(parsed) = self.parsed(file) else { return Target::Free };
        if let Some(callback) = callback {
            return Target::Fn { file, func: callback, how: How::Callback };
        }
        let declared = |(at, local): (u32, String), how: How| match self.parsed(at).and_then(|q| q.locals.get(&local)) {
            Some(fns) if !fns.is_empty() => Target::Fn { file: at, func: fns[0], how },
            _ => Target::NotFunction { file: at, local },
        };
        if let Some(id) = &callee.id {
            if let Some(candidates) = parsed.locals.get(id) {
                // The last candidate whose scope holds the call, else the first.
                let mut best = None;
                for &candidate in candidates {
                    let parent = parsed.fns[candidate as usize].parent;
                    let mut scope = from;
                    let mut holds = parent.is_none();
                    while !holds {
                        let Some(at) = scope else { break };
                        holds = Some(at) == parent;
                        scope = parsed.fns[at as usize].parent;
                    }
                    if holds {
                        best = Some(candidate);
                    }
                }
                if let Some(func) = best.or_else(|| candidates.first().copied()) {
                    return Target::Fn { file, func, how: How::Local };
                }
            }
            if let Some(import) = parsed.imports.get(id) {
                let declaration =
                    self.resolve(file, &import.spec).and_then(|to| self.declaration_of(to, &import.name, &mut HashSet::new()));
                return declaration.map_or(Target::External, |declaration| declared(declaration, How::Import));
            }
            return Target::Free;
        }
        if let (Some(ns), Some(prop)) = (&callee.ns, &callee.prop) {
            if let Some(import) = parsed.imports.get(ns).filter(|import| import.name == "*") {
                let declaration = self.resolve(file, &import.spec).and_then(|to| self.declaration_of(to, prop, &mut HashSet::new()));
                if let Some(declaration) = declaration {
                    return declared(declaration, How::Namespace);
                }
            }
        }
        Target::Member
    }
}

#[cfg(test)]
#[path = "journeys_graph_tests.rs"]
mod tests;
