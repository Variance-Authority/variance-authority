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

use std::collections::HashMap;
use std::path::Path;

use rayon::prelude::*;

use crate::compact::Layer;
use crate::journeys_parse::{parse, Callee, Export, Parsed};
use crate::package_graph::{fold, join_parses, At, Crossing};
use crate::resolve::{Resolvers, Tsconfig};
use crate::resolve_export::{resolve_export, Bound, Exports, Modules, Passes};

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
/// there, as the diff names it by an object of all zeros. One diff, in a
/// partial clone one fetch of the objects the diff names ([`crate::promisor`]),
/// and one `cat-file --batch` by object name; a file not in the map is the same
/// on disk. Renames are not detected: a file moved since the commit is a path
/// the commit did not have, and the path it had is read from there under its
/// own name.
///
/// Every object the diff names exists, so one git cannot read is a fault and
/// never an absent file: the read then fails with git's own reason. That holds
/// on every git, including those before 2.44, which stop at the first object
/// `GIT_NO_LAZY_FETCH` forbids rather than answering it `missing`; so the read
/// leaves lazy fetching as the repository has it, and a fetch that failed costs
/// one request per object rather than a different answer.
///
/// A file git holds as a git-LFS pointer is read as the content the pointer
/// names ([`crate::lfs::smudge`]), and the read fails with git-lfs's reason
/// when that content cannot be had: the pointer is never parsed as source.
pub(crate) fn text_at(root: &str, commit: &str) -> Result<HashMap<String, Option<String>>, String> {
    let args = ["-c", "core.quotePath=false", "diff", "--raw", "--no-abbrev", "--no-renames", "-z", "--relative", commit];
    let listed = match crate::git::answer(root, &args, None) {
        Ok(listed) => listed,
        Err(why) => {
            let known = crate::git::git(root, &["cat-file", "-e", &format!("{commit}^{{commit}}")], None).is_some();
            return Err(if known {
                format!("git could not list what changed since commit {}: {why}", short(commit))
            } else {
                format!("commit {} is not in this checkout's object store", short(commit))
            });
        }
    };
    // `:<mode> <mode> <object> <object> <status>` and then the path, each ended
    // by a NUL. The first object is the commit's, all zeros where it had none.
    let fields: Vec<&[u8]> = listed.split(|&byte| byte == 0).collect();
    let changed: Vec<(String, Option<String>)> = fields
        .chunks_exact(2)
        .filter_map(|pair| {
            let object = pair[0].split(|&byte| byte == b' ').nth(2)?;
            let object = String::from_utf8_lossy(object).into_owned();
            // A submodule's entry names its commit, which is no file's text.
            let file = !pair[0].starts_with(b":160000") && object.bytes().any(|byte| byte != b'0');
            Some((String::from_utf8_lossy(pair[1]).into_owned(), Some(object).filter(|_| file)))
        })
        .filter(|(path, _)| code(path))
        .collect();
    let mut texts = HashMap::new();
    if changed.is_empty() {
        return Ok(texts);
    }
    let unread = |why: &str| format!("git could not read the files changed since commit {}: {why}", short(commit));
    let oids: Vec<String> = changed.iter().filter_map(|(_, oid)| oid.clone()).collect();
    let fetched = crate::promisor::fetch(root, &oids);
    let read = read_objects(root, &oids).map_err(|why| match &fetched {
        Err(fetch) if fetch != &why => unread(&format!("{why} (the fetch before it: {fetch})")),
        _ => unread(&why),
    })?;
    let mut read = read.into_iter();
    for (file, oid) in changed {
        let text = match oid.and_then(|_| read.next()) {
            Some(blob) if crate::lfs::pointer(&blob) => Some(crate::lfs::smudge(root, &file, commit, &blob).map_err(|why| unread(&why))?),
            blob => blob,
        };
        texts.insert(file, text.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()));
    }
    Ok(texts)
}

/// Each of `oids` from one `cat-file --batch`, in order. An object git answers
/// `missing` is an error, as is any output that does not parse: every object
/// asked for was named by the commit's tree.
fn read_objects(root: &str, oids: &[String]) -> Result<Vec<Vec<u8>>, String> {
    let asked: String = oids.iter().map(|oid| format!("{oid}\n")).collect();
    let out = crate::git::answer(root, &["cat-file", "--batch"], Some(asked.into_bytes()))?;
    let cut = || "git cat-file --batch ended its answer early".to_owned();
    let mut read = Vec::with_capacity(oids.len());
    let mut at = 0;
    for _ in oids {
        let end = at + out.get(at..).ok_or_else(cut)?.iter().position(|&byte| byte == b'\n').ok_or_else(cut)?;
        let head = String::from_utf8_lossy(&out[at..end]).into_owned();
        at = end + 1;
        let size = match head.rsplit(' ').next().map(str::parse::<usize>) {
            Some(Ok(size)) if !head.ends_with(" missing") => size,
            _ => return Err(format!("git answered `{head}`")),
        };
        read.push(out.get(at..at + size).ok_or_else(cut)?.to_vec());
        at += size + 1;
    }
    Ok(read)
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
    /// `commit` is the commit the recording ran at; a file changed since it is
    /// read from it, and one git cannot read fails the build with git's reason.
    /// `tsconfig` is the config the scan that built the index resolved under.
    pub(crate) fn build(root: &str, layers: &[Layer], commit: &str, seeds: &[String], tsconfig: Tsconfig) -> Result<Graph, String> {
        let (then, index) = rayon::join(
            || text_at(root, commit),
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
        let resolvers = Resolvers::new(tsconfig, None);
        let absolute = Path::new(root);
        let mut graph = Graph {
            files: Vec::new(),
            ids: HashMap::new(),
            parsed: Vec::new(),
            specs: Vec::new(),
            targets: Vec::new(),
            calls_from: Vec::new(),
            fell_back: 0,
        };
        let then = then?;
        let mut frontier: Vec<u32> = seeds.iter().map(|seed| graph.intern(seed)).collect();
        frontier.dedup();
        while !frontier.is_empty() {
            let read: Vec<Read> = frontier
                .par_iter()
                .map(|&id| {
                    let file = graph.files[id as usize].as_str();
                    let text = match then.get(file) {
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
        Ok(graph)
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

    /// An exported name followed to the file and local name that declare it,
    /// as ECMAScript resolves the export (`resolve_export.rs`).
    pub(crate) fn declaration_of(&self, file: u32, name: &str) -> Option<(u32, String)> {
        resolve_export(self, &file, name).declaration()
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
                    self.resolve(file, &import.spec).and_then(|to| self.declaration_of(to, &import.name));
                return declaration.map_or(Target::External, |declaration| declared(declaration, How::Import));
            }
            return Target::Free;
        }
        if let (Some(ns), Some(prop)) = (&callee.ns, &callee.prop) {
            if let Some(import) = parsed.imports.get(ns).filter(|import| import.name == "*") {
                let declaration = self.resolve(file, &import.spec).and_then(|to| self.declaration_of(to, prop));
                if let Some(declaration) = declaration {
                    return declared(declaration, How::Namespace);
                }
            }
        }
        Target::Member
    }
}

impl Modules for Graph {
    type File = u32;
    type Declaration = (u32, String);

    /// A name the file exports and neither imports nor declares as a function
    /// or a value is taken for a declaration of the file, which the journeys
    /// then read as no function.
    fn exports(&self, file: &u32, name: &str) -> Exports<u32, (u32, String)> {
        let file = *file;
        let Some(parsed) = self.parsed(file) else { return Exports::Unread };
        let stars = || parsed.star.iter().map(|spec| self.resolve(file, spec)).collect();
        match parsed.exports.get(name) {
            Some(Export::Local(local)) => Exports::Own(match parsed.imports.get(local) {
                Some(import) if import.name == "*" => Bound::Unbound,
                Some(import) => Bound::Imported(self.resolve(file, &import.spec), import.name.clone()),
                None => Bound::Declared((file, local.clone())),
            }),
            Some(Export::From { spec, name }) => Exports::Passes(Passes {
                named: Some(if name == "*" { None } else { self.resolve(file, spec).map(|to| (to, name.clone())) }),
                stars: stars(),
            }),
            None => Exports::Passes(Passes { named: None, stars: stars() }),
        }
    }
}

#[cfg(test)]
#[path = "journeys_graph_tests.rs"]
mod tests;
