//! A call the static resolution missed, placed from the recording.
//!
//! An import the walk cannot resolve still ran something: the recording holds
//! what the case entered. The call is placed on the one entered function a file
//! of the checkout exports under the name the import asks for — its default
//! export for a default import, the member for a call through a namespace — and,
//! when the import names a workspace package, only on one that package exports.
//! An import of a Node builtin, or of a package a manifest declares and no
//! workspace holds, is never placed this way: what it ran is not in the
//! checkout. Two or more candidates and the call is ambiguous: none of them is
//! chosen, and the walk's other inferences are tried. No test runner's module
//! mapping is modelled here — which file an import meant to the runner is not
//! read, only what the case ran.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use rayon::prelude::*;

use super::{fn_key, Walk};
use crate::journeys_graph::Graph;
use crate::journeys_parse::{Callee, Parsed};
use crate::journeys_record::{Record, NONE};
use crate::journeys_steps::Known;
use crate::package_owners::Owners;
use crate::specifier::package_of;

/// One function a file exports under a name.
struct Candidate {
    /// The package of the file that exports it, which may re-export it.
    package: u32,
    file: u32,
    func: u32,
    /// Its recorded regions: more than one when the recorder wrote it twice.
    regions: Box<[u32]>,
}

/// Every recorded function by each name a file exports it under, and what the
/// manifests say a bare specifier names. Built once; every case reads it.
pub(crate) struct Exported {
    by_name: HashMap<String, Vec<Candidate>>,
    /// A workspace package's name → the packages that declare it.
    members: HashMap<String, Vec<u32>>,
    /// Packages a manifest depends on that no workspace holds.
    installed: HashSet<String>,
    builtins: HashSet<String>,
}

impl Exported {
    /// `package` is each graph file's package, as an index into `owners`.
    pub(crate) fn of(graph: &Graph, record: &Record, owners: &Owners, package: &[u32], builtins: HashSet<String>) -> Exported {
        let mut regions: HashMap<(u32, u32), Vec<u32>> = HashMap::new();
        for (j, &func) in record.fn_for.iter().enumerate() {
            if func != NONE && record.regions[j].function() {
                regions.entry((record.regions[j].file, func)).or_default().push(j as u32);
            }
        }
        let found: Vec<(String, Candidate)> = (0..graph.files.len() as u32)
            .into_par_iter()
            .flat_map_iter(|file| {
                let names = graph.parsed(file).map(|parsed| parsed.exports.keys().filter(|name| *name != "*").collect::<Vec<_>>());
                let mut found = Vec::new();
                for name in names.unwrap_or_default() {
                    let Some((at, local)) = graph.declaration_of(file, name, &mut HashSet::new()) else { continue };
                    let Some(declared) = graph.parsed(at) else { continue };
                    for &func in declared.locals.get(&local).into_iter().flatten() {
                        let Some(held) = regions.get(&(at, func)).filter(|_| declared.fns[func as usize].parent.is_none()) else { continue };
                        let package = package.get(file as usize).copied().unwrap_or(NONE);
                        found.push((name.clone(), Candidate { package, file: at, func, regions: held.clone().into_boxed_slice() }));
                    }
                }
                found
            })
            .collect();
        let mut by_name: HashMap<String, Vec<Candidate>> = HashMap::new();
        for (name, candidate) in found {
            by_name.entry(name).or_default().push(candidate);
        }
        let mut members: HashMap<String, Vec<u32>> = HashMap::new();
        for (at, held) in owners.packages.iter().enumerate() {
            members.entry(held.name.clone()).or_default().push(at as u32);
        }
        let installed = owners
            .packages
            .iter()
            .flat_map(|held| held.depends.iter().chain(&held.develops))
            .filter(|name| !members.contains_key(*name))
            .cloned()
            .collect();
        Exported { by_name, members, installed, builtins }
    }

    /// The packages a specifier's candidates must be exported from: `None` for
    /// one no function of the checkout answers, an empty list for any package.
    fn scope(&self, spec: &str) -> Option<&[u32]> {
        if spec.starts_with("node:") || self.builtins.contains(spec) {
            return None;
        }
        let Some(package) = package_of(spec, &self.builtins) else { return Some(&[]) };
        if let Some(members) = self.members.get(package) {
            return Some(members);
        }
        (!self.installed.contains(package)).then_some(&[])
    }
}

/// What the recording made of a call.
#[derive(PartialEq)]
pub(super) enum Answer {
    Placed,
    Ambiguous,
    Unanswered,
}

/// The call sites the recording placed or found ambiguous in one case.
#[derive(Default)]
pub(super) struct Named {
    /// Call sites (`fn_key(file, call)`) placed on the one candidate.
    pub placed: Vec<u64>,
    /// Call sites with more than one candidate that nothing else placed.
    pub ambiguous: Vec<u64>,
}

/// The specifier an import is written with and the name it asks that module
/// for: the imported name, `default` for a default import, or for a call
/// through a namespace import, the member.
fn imported<'p>(parsed: &'p Parsed, callee: &'p Callee) -> Option<(&'p str, &'p str)> {
    if let Some(id) = callee.id.as_deref() {
        let import = parsed.imports.get(id)?;
        return (import.name != "*").then_some((import.spec.as_str(), import.name.as_str()));
    }
    let (ns, prop) = (callee.ns.as_deref()?, callee.prop.as_deref()?);
    parsed.imports.get(ns).filter(|import| import.name == "*").map(|import| (import.spec.as_str(), prop))
}

impl Walk<'_, '_> {
    /// Call `at` of `file` imports a name the static resolution did not bring
    /// to a function. Placed from the recording when exactly one entered
    /// function is exported under that name from where the import may lead.
    pub(super) fn recorded(&mut self, from: u32, file: u32, at: u32, guard: u32) -> Answer {
        let (graph, exported) = (self.graph, self.exported);
        let Some(parsed) = graph.parsed(file) else { return Answer::Unanswered };
        let Some((spec, name)) = imported(parsed, &parsed.calls[at as usize].callee) else { return Answer::Unanswered };
        let (Some(scope), Some(candidates)) = (exported.scope(spec), exported.by_name.get(name)) else { return Answer::Unanswered };
        let mut found: Option<(u32, u32, u32)> = None;
        for candidate in candidates {
            if candidate.file == self.test_file || !(scope.is_empty() || scope.contains(&candidate.package)) {
                continue;
            }
            let Some(&j) = candidate.regions.iter().find(|&&j| self.entered(j)) else { continue };
            match found {
                None => found = Some((candidate.file, candidate.func, j)),
                Some((file, func, _)) if (file, func) == (candidate.file, candidate.func) => {}
                Some(_) => return Answer::Ambiguous,
            }
        }
        let Some((to_file, to_func, j)) = found else { return Answer::Unanswered };
        // TODO: read a harness's own module mapping and apply it at question
        // time to that harness's tests, as `packages/sense/src/taint/` applies
        // a runner's mocks; the walk stays harness-agnostic, and until then
        // the recording is what places a call the static resolution missed.
        self.named.placed.push(fn_key(file, at));
        self.reach(from, to_file, to_func, j, guard, Known::Recorded);
        Answer::Placed
    }
}
