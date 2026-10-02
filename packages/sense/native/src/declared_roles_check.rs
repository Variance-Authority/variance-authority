//! Whether the roles docs declare hold over the graph the index records.
//!
//! A role is derived first: a shipped file is one the code map read as
//! reachable from what a package publishes, and the rest is the tests' side.
//! `@testOnly` and `@production` settle a name the derivation leaves mixed, and
//! each is checked against reachability alone — never against how test-heavy
//! the name's use is, since that share moves with every change.
//!
//! - A shipped file that runs a `@testOnly` name is a defect, unless every name
//!   the file exports at runtime is itself test-only: a testing entry a package
//!   ships may build on other test-only code.
//! - A `@production` name in a file on the tests' side — a test reaches it and
//!   nothing shipped does — is a declaration the graph contradicts.
//! - One doc declaring both is a contradiction in the doc.
//!
//! A tag travels with the name through re-exports, so importing a test-only
//! name from a barrel is the same use as importing it from where it is declared.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use napi::bindgen_prelude::AsyncTask;
use napi_derive::napi;
use rayon::prelude::*;

use crate::compact::Layer;
use crate::declared_role::{PRODUCTION, TEST_ONLY};
use crate::index_chain::read_chain;
use crate::off_thread::{off_thread, OffThread};
use crate::package_graph::{fold, join_parses, Crossing};
use crate::package_owners::NO_OWNER;

#[napi(object)]
pub struct DeclaredRoleFinding {
    /// `contradiction`, `test-only-shipped` or `production-unshipped`.
    pub kind: String,
    /// The file the finding is in: the declaring file, or the shipped file using a test-only name.
    pub file: String,
    pub line: u32,
    pub name: String,
    /// Where a used test-only name is declared.
    pub declared: Option<String>,
    pub declared_line: u32,
}

#[napi(object)]
pub struct DeclaredRoleCheck {
    /// How many exports a doc declares a role for.
    pub declared: u32,
    /// Whether a shipped list is kept beside the index and was read from it as
    /// it stands now; without one, nothing was checked against reachability.
    pub current: bool,
    pub findings: Vec<DeclaredRoleFinding>,
}

/// The declared roles in the index at `index`, checked against the shipped
/// list kept beside it; `None` when there is no index.
#[napi(ts_return_type = "Promise<DeclaredRoleCheck | null>")]
pub fn check_declared_roles(index: String) -> AsyncTask<OffThread<Option<DeclaredRoleCheck>>> {
    off_thread(move || checking(&index))
}

fn checking(index: &str) -> napi::Result<Option<DeclaredRoleCheck>> {
    let shipped = crate::orient_map_shipped::orient_shipped(index.to_owned())?;
    let fail = |error: String| napi::Error::from_reason(format!("the source index at {index} did not read: {error}"));
    let Some(chain) = read_chain(index).map_err(fail)? else { return Ok(None) };
    let layers = chain.segments.par_iter().enumerate()
        .map(|(at, bytes)| Layer::open(bytes).map_err(|error| format!("segment {at}: {error}")))
        .collect::<Result<Vec<_>, _>>()
        .map_err(fail)?;
    let current = shipped.as_ref().is_some_and(|shipped| shipped.current);
    let files: HashSet<&str> = shipped.iter().flat_map(|shipped| shipped.files.iter().map(String::as_str)).collect();
    let (declared, findings) = check(&layers, current.then_some(&files));
    Ok(Some(DeclaredRoleCheck { declared, current, findings }))
}

/// One name a file publishes at runtime or in types.
struct Published<'a> {
    name: &'a str,
    type_only: bool,
    tags: u8,
    line: u32,
}

/// A name of `target` this file republishes: `imported` as `exported`, or with
/// both absent every name `target` publishes but its default.
struct Passes<'a> {
    target: &'a str,
    imported: Option<&'a str>,
    exported: Option<&'a str>,
}

/// A name of `target` this file runs, or with `name` absent every name a star
/// re-export passes on; `local` is what the file calls it.
struct Use<'a> {
    target: &'a str,
    name: Option<&'a str>,
    local: Option<&'a str>,
    line: u32,
}

#[derive(Default)]
struct Facts<'a> {
    published: Vec<Published<'a>>,
    passes: Vec<Passes<'a>>,
    uses: Vec<Use<'a>>,
}

/// What one indexed file publishes, passes on and runs, read off its parse
/// and the targets its record resolved.
fn facts<'a>(layers: &'a [Layer], crossing: &Crossing<'a>) -> Facts<'a> {
    let mut facts = Facts::default();
    let Some((layer, row)) = crossing.parse else { return facts };
    let (stored, records) = (&layers[crossing.at.0].stored, &layers[crossing.at.0].records);
    let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
    // The index resolved each request when it wrote the record; a record whose
    // targets do not line up with the parse's requests answers none of them.
    let targets: Vec<Option<&str>> = if records.targets_present[crossing.at.1] == 1 {
        records.targets.range(crossing.at.1).map(|target| stored.optional(records.target_path.at(target))).collect()
    } else {
        Vec::new()
    };
    if targets.len() != parses.requests.range(row).len() {
        return facts;
    }
    let first = parses.requests.at(row) as usize;
    let mut imported_as: HashMap<&str, (&str, &str)> = HashMap::new();
    let mut reexported_from: HashMap<&str, &str> = HashMap::new();
    for request in parses.requests.range(row) {
        let Some(target) = targets[request - first] else { continue };
        let kind = text.text(parses.request_kind.at(request));
        if kind == "type" || kind == "depends" {
            continue;
        }
        if kind == "reexports" {
            reexported_from.insert(text.text(parses.request_value.at(request)), target);
        }
        let line = parses.request_line.at(request);
        for binding in parses.request_bindings.range(request) {
            if parses.binding_type[binding] == 1 {
                continue;
            }
            let imported = text.text(parses.binding_imported.at(binding));
            let local = text.text(parses.binding_local.at(binding));
            if kind == "imports" {
                imported_as.insert(local, (target, imported));
            }
            if imported != "*" {
                facts.uses.push(Use { target, name: Some(imported), local: Some(local), line: parses.binding_line.at(binding) });
            } else if kind == "reexports" {
                // `export * as ns from` runs every name of the target, like `export *`.
                facts.uses.push(Use { target, name: None, local: None, line });
            }
        }
        for member in parses.members.range(row) {
            if parses.member_request.at(member) as usize == request - first {
                let name = text.text(parses.member_name.at(member));
                facts.uses.push(Use { target, name: Some(name), local: Some(name), line: parses.member_line.at(member) });
            }
        }
        if kind == "reexports" && parses.request_bindings.range(request).is_empty() {
            facts.uses.push(Use { target, name: None, local: None, line });
        }
    }
    if parses.exports_present[row] != 1 {
        return facts;
    }
    for export in parses.exports.range(row) {
        let exported = text.optional(parses.export_exported.at(export));
        let type_only = parses.export_type[export] == 1;
        let line = parses.export_line.at(export);
        if let Some(name) = exported {
            facts.published.push(Published { name, type_only, tags: parses.export_tags[export], line });
        }
        if type_only {
            continue;
        }
        let imported = text.optional(parses.export_imported.at(export));
        if let Some(from) = text.optional(parses.export_from.at(export)) {
            // `export * as ns from` publishes a namespace, not the names in it.
            if exported.is_some() && imported.is_none() {
                continue;
            }
            if let Some(&target) = reexported_from.get(from) {
                facts.passes.push(Passes { target, imported, exported });
            }
        } else if let (Some(exported), Some(local)) = (exported, text.optional(parses.export_local.at(export))) {
            if let Some(&(target, imported)) = imported_as.get(local) {
                facts.passes.push(Passes { target, imported: Some(imported), exported: Some(exported) });
            }
        }
    }
    facts
}

/// A name's role, and where the doc declaring it is.
#[derive(Clone, Copy)]
struct Declared<'a> {
    tags: u8,
    file: &'a str,
    line: u32,
}

/// How many exports declare a role, and what contradicts them. Without a
/// current `shipped` list only a doc contradicting itself is found.
pub(crate) fn check(layers: &[Layer], shipped: Option<&HashSet<&str>>) -> (u32, Vec<DeclaredRoleFinding>) {
    let folded = fold(layers);
    let mut crossings: Vec<Crossing> = folded
        .into_iter()
        .map(|(path, at)| Crossing { file: path, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let read: Vec<Facts> = crossings.par_iter().map(|crossing| facts(layers, crossing)).collect();
    let files: Vec<&str> = crossings.iter().map(|crossing| crossing.file).collect();

    let mut findings = Vec::new();
    let mut declared: HashMap<(&str, &str), Declared> = HashMap::new();
    for (file, facts) in files.iter().zip(&read) {
        for published in facts.published.iter().filter(|published| published.tags != 0) {
            if published.tags == TEST_ONLY | PRODUCTION {
                findings.push(finding("contradiction", file, published.line, published.name, None));
            } else if published.tags == PRODUCTION && shipped.is_some_and(|shipped| !shipped.contains(file)) {
                findings.push(finding("production-unshipped", file, published.line, published.name, None));
            }
            declared.insert((file, published.name), Declared { tags: published.tags, file, line: published.line });
        }
    }
    let count = declared.len() as u32;
    let Some(shipped) = shipped.filter(|_| count > 0) else { return (count, findings) };
    propagate(&files, &read, &mut declared);

    for (file, facts) in files.iter().zip(&read) {
        if !shipped.contains(file) || only_tests_run_it(file, facts, &declared) {
            continue;
        }
        for used in &facts.uses {
            let names: Vec<(&str, &str)> = match (used.name, used.local) {
                (Some(name), local) => vec![(name, local.unwrap_or(name))],
                (None, _) => names_of(&declared, used.target).into_iter().map(|name| (name, name)).collect(),
            };
            for (name, local) in names {
                let Some(role) = declared.get(&(used.target, name)) else { continue };
                if role.tags & TEST_ONLY != 0 {
                    findings.push(finding("test-only-shipped", file, used.line, local, Some(*role)));
                }
            }
        }
    }
    findings.sort_by(|a, b| crate::order::code_unit(&a.file, &b.file).then(a.line.cmp(&b.line)).then(a.name.cmp(&b.name)));
    (count, findings)
}

/// Carry each declared role to every name that republishes it, until nothing moves.
fn propagate<'a>(files: &[&'a str], read: &[Facts<'a>], declared: &mut HashMap<(&'a str, &'a str), Declared<'a>>) {
    // Who republishes a target's names: by name, and wholesale.
    let mut named: HashMap<(&str, &str), Vec<(&str, &str)>> = HashMap::new();
    let mut starred: HashMap<&str, Vec<&str>> = HashMap::new();
    for (file, facts) in files.iter().zip(read) {
        for passes in &facts.passes {
            match (passes.imported, passes.exported) {
                (Some(imported), Some(exported)) => named.entry((passes.target, imported)).or_default().push((file, exported)),
                (None, None) => starred.entry(passes.target).or_default().push(file),
                _ => {}
            }
        }
    }
    let mut work: Vec<(&str, &str)> = declared.keys().copied().collect();
    while let Some(key @ (target, name)) = work.pop() {
        let role = declared[&key];
        let wholesale = if name == "default" { None } else { starred.get(target) };
        let onward = named.get(&key).into_iter().flatten().copied()
            .chain(wholesale.into_iter().flatten().map(|&file| (file, name)));
        for next in onward {
            // A name's own doc outranks what it republishes.
            if declared.contains_key(&next) {
                continue;
            }
            declared.insert(next, role);
            work.push(next);
        }
    }
}

/// Whether a file publishes something at runtime and every runtime name it
/// publishes is test-only: a testing entry, which may build on test-only code.
fn only_tests_run_it(file: &str, facts: &Facts, declared: &HashMap<(&str, &str), Declared>) -> bool {
    let mut runtime = facts.published.iter().filter(|published| !published.type_only).peekable();
    runtime.peek().is_some()
        && runtime.all(|published| declared.get(&(file, published.name)).is_some_and(|role| role.tags & TEST_ONLY != 0))
}

/// Every declared name `target` publishes but its default, which a star does not pass on.
fn names_of<'a>(declared: &HashMap<(&'a str, &'a str), Declared<'a>>, target: &str) -> Vec<&'a str> {
    let mut names: Vec<&str> = declared.keys().filter(|(file, name)| *file == target && *name != "default").map(|&(_, name)| name).collect();
    names.sort_unstable();
    names
}

fn finding(kind: &str, file: &str, line: u32, name: &str, role: Option<Declared>) -> DeclaredRoleFinding {
    DeclaredRoleFinding {
        kind: kind.to_owned(),
        file: file.to_owned(),
        line,
        name: name.to_owned(),
        declared: role.map(|role| role.file.to_owned()),
        declared_line: role.map_or(0, |role| role.line),
    }
}
