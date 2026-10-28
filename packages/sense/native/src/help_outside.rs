//! Who imports a name from outside the workspace: out of a package it installs
//! rather than writes, or out of a module the runtime owns.
//!
//! The declaration is not in the checkout, but every import of it is. Which
//! requests are for an installed package is `unresolved_requests`'s to say,
//! the rule the external-dependency orientation and the dependency lexicon
//! read too, so the three never disagree; this reads each of those requests per
//! binding, so a site has its own line and the name it binds. A file whose
//! imports that rule cannot read is named rather than passed over, since it
//! may import the name.
//!
//! The index never records a module the runtime owns, as a package or as a
//! file, so one is told by its specifier alone: a name in the runtime's list,
//! with or without its `node:` scheme. That needs no target, so a record whose
//! targets do not line up with its parse still answers for it; only a request
//! the scan resolved to a file is not the runtime's.
//!
//! The rule's two halves run apart here: which requests went unresolved reads
//! the index alone, and which of their packages are the workspace's own reads
//! its manifests. Most names asked of are the workspace's, bound by no
//! unresolved request, so the manifests are read only when a binding of the
//! name, or a record that does not line up with its parse, waits on them.

// compass: variance-authority.reach.relations

use std::collections::HashSet;

use napi_derive::napi;
use rayon::prelude::*;

use crate::compact::Layer;
use crate::external_dependencies::{unresolved_among, unresolved_requests};
use crate::help_usage::{bound, kind_of, taken, NameUse};
use crate::orient_map_read::beside;
use crate::package_graph::{fold, join_parses, At, Crossing};
use crate::package_owners::{owners, NO_OWNER};
use crate::specifier::{builtin_of, package_of, request_of};

/// One import of a name from outside the workspace.
#[napi(object)]
pub struct OutsideUse {
    /// The package the specifier names, or the runtime's module with its `node:` scheme.
    pub package: String,
    /// The module is the runtime's, not a package the workspace installs.
    pub runtime: bool,
    /// The request is an `export … from`, which passes the name on.
    pub passes_on: bool,
    pub site: NameUse,
}

/// Every import of a name from outside the workspace, and the files whose
/// imports were not read.
#[napi(object)]
pub struct OutsideImports {
    pub uses: Vec<OutsideUse>,
    /// Files the index holds whose imports do not read, in code-unit order:
    /// every record that did not read, and each that does not line up with a
    /// parse taking the name.
    pub unread: Vec<String>,
}

/// Every import of `name` out of a package no manifest of the workspace
/// declares, or out of a module in `builtins`, the runtime's, by any file on
/// the chain: each binding, including one an `export … from` passes on, and
/// each member read off a module held whole. An `export *` names no name, so
/// it is no import of this one. A use's `key` is the specifier as written.
/// Ordered by the importing file in code units, then by line, then by
/// specifier.
pub(crate) fn outside_importers(root: &str, layers: &[Layer], name: &str, builtins: &HashSet<String>) -> OutsideImports {
    let folded = fold(layers);
    // Any record may import a module the runtime owns, so every one is read.
    let mut crossings: Vec<Crossing> = folded.iter().map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None }).collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let read: Vec<Read> = crossings.par_iter().map(|crossing| read_crossing(layers, crossing, name, builtins)).collect();
    let waits = read.iter().any(|one| match one {
        Read::Found(found) | Read::Unknown(_, found) => !found.is_empty(),
        Read::Unaligned(..) => true,
    });
    if !waits {
        let unread = read.into_iter().filter_map(|one| if let Read::Unknown(file, _) = one { Some(file.to_owned()) } else { None }).collect();
        return OutsideImports { uses: Vec::new(), unread };
    }
    let paths = beside(root, folded.keys().copied());
    let owners = owners(root, &paths);
    let internal: HashSet<&str> = owners.packages.iter().map(|package| package.name.as_str()).collect();
    let mut uses = Vec::new();
    let mut unread = Vec::new();
    let mut keep = |found: Vec<OutsideUse>| {
        uses.extend(found.into_iter().filter(|one| one.runtime || !internal.contains(one.package.as_str())).map(|mut one| {
            one.site.by = owners.package_of(&one.site.at).to_owned();
            one
        }));
    };
    for one in read {
        match one {
            Read::Found(found) => keep(found),
            Read::Unknown(file, found) => {
                keep(found);
                unread.push(file.to_owned());
            }
            // A record that names only the workspace's own packages imports nothing from outside it.
            Read::Unaligned(file, (layer, row), found) => {
                keep(found);
                let (stored, records) = (&layers[layer].stored, &layers[layer].records);
                if records.packages_of(stored, row).any(|package| !internal.contains(package)) { unread.push(file.to_owned()); }
            }
        }
    }
    uses.sort_by(|a, b| {
        let (a, b) = (&a.site, &b.site);
        crate::order::code_unit(&a.at, &b.at)
            .then(a.line.cmp(&b.line))
            .then_with(|| crate::order::code_unit(&a.key, &b.key))
            .then_with(|| crate::order::code_unit(a.local.as_deref().unwrap_or(""), b.local.as_deref().unwrap_or("")))
    });
    OutsideImports { uses, unread }
}

/// What one crossing answers before the workspace's own packages are known;
/// each carries its imports of the name out of the runtime's modules, which
/// wait on no manifest.
enum Read<'l> {
    /// Every binding of the name off a request the scan did not resolve, the importing package not yet filled in.
    Found(Vec<OutsideUse>),
    /// A record that did not read: unread whatever the manifests say.
    Unknown(&'l str, Vec<OutsideUse>),
    /// A record that names packages and that its parse does not line up with: unread when one of them is outside.
    Unaligned(&'l str, At, Vec<OutsideUse>),
}

fn read_crossing<'l>(layers: &[Layer], crossing: &Crossing<'l>, name: &str, builtins: &HashSet<String>) -> Read<'l> {
    let unresolved = unresolved_requests(layers, crossing);
    let installed = unresolved.as_deref().unwrap_or_default().iter().map(|&(request, package)| (request, package.to_owned(), false));
    let runtime = runtime_requests(layers, crossing, builtins).into_iter().map(|(request, module)| (request, module, true));
    let mut found = Vec::new();
    if let Some((layer, row)) = crossing.parse {
        let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
        let kind = kind_of(crossing.file);
        for (request, package, runtime) in runtime.chain(installed) {
            let written = text.text(parses.request_value.at(request));
            let passes_on = parses.request_republishes[request] == 1;
            for (site, local) in taken(&layers[layer], row, request, written, "", crossing.file, kind) {
                if site.name == name { found.push(OutsideUse { package: package.clone(), runtime, passes_on, site: bound(&layers[layer], row, site, if passes_on { "" } else { local }) }); }
            }
        }
    }
    if unresolved.is_ok() { return Read::Found(found); }
    let (layer, row) = crossing.at;
    // A record that did not read may hold a request no parse names, `import(at)`, and whatever it takes off it.
    if layers[layer].records.unknown_of(&layers[layer].stored, row).is_some() { return Read::Unknown(crossing.file, found); }
    // The parse names every request of a record that only fails to line up with it, so one that takes the name through none imports none of it.
    if !takes(layers, crossing, name) { return Read::Found(found); }
    Read::Unaligned(crossing.file, crossing.at, found)
}

/// Whether any request of the crossing's parse takes `name`, as a binding or a
/// member read; a file with no parse may take any.
fn takes(layers: &[Layer], crossing: &Crossing, name: &str) -> bool {
    let Some((layer, row)) = crossing.parse else { return true };
    let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
    let kind = kind_of(crossing.file);
    parses.requests.range(row).any(|request| {
        let written = text.text(parses.request_value.at(request));
        taken(&layers[layer], row, request, written, "", crossing.file, kind).iter().any(|(site, _)| site.name == name)
    })
}

/// Which of one crossing's requests are for a module of the runtime's, each as
/// its index among the parse's requests and the module with its `node:`
/// scheme, in source order, as [`runtime_among`] reads them.
pub(crate) fn runtime_requests(layers: &[Layer], crossing: &Crossing, builtins: &HashSet<String>) -> Vec<(usize, String)> {
    let Some((layer, row)) = crossing.parse else { return Vec::new() };
    let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
    let (record_layer, record_row) = crossing.at;
    let (stored, records) = (&layers[record_layer].stored, &layers[record_layer].records);
    let requests = parses.requests.range(row);
    let first = requests.start;
    let resolved = (records.targets_present[record_row] == 1)
        .then(|| records.targets.range(record_row).map(|target| stored.optional(records.target_path.at(target)).is_some()));
    let found = runtime_among(requests.map(|request| text.text(parses.request_value.at(request))), resolved, builtins);
    found.into_iter().map(|(index, module)| (first + index, module)).collect()
}

/// Which of one file's requests are for a module of the runtime's, each as its
/// index among `specifiers` and the module with its `node:` scheme, in source
/// order: a specifier [`builtin_of`] names, unless the scan resolved the
/// request to a file. A record whose targets are absent or do not line up with
/// its requests cannot say which did, so each such request is counted.
pub(crate) fn runtime_among<'s>(
    specifiers: impl ExactSizeIterator<Item = &'s str>,
    resolved: Option<impl ExactSizeIterator<Item = bool>>,
    builtins: &HashSet<String>,
) -> Vec<(usize, String)> {
    let mut resolved = resolved.filter(|resolved| resolved.len() == specifiers.len());
    specifiers
        .enumerate()
        .filter_map(|(index, specifier)| {
            let done = resolved.as_mut().is_some_and(|resolved| resolved.next() == Some(true));
            let module = builtin_of(specifier, builtins)?;
            (!done).then_some((index, module))
        })
        .collect()
}

/// Which of one file's requests are out of a module outside the workspace,
/// each as its index among `specifiers`, in source order: out of a package it
/// installs, as [`unresolved_among`] reads them less the packages `internal`
/// names, the workspace's own, or out of a module of the runtime's, as
/// [`runtime_among`] reads them. `Err` when the file's imports do not read and
/// one may be out of an installed package: the record is `unknown`, or its
/// targets do not line up and it names a package `internal` does not. It then
/// holds every request that may be outside — the runtime's, and each that
/// names a package — since which went unresolved is what did not read.
pub(crate) fn outside_among<'s, S, R>(specifiers: S, resolved: Option<R>, packages: &HashSet<&str>, unknown: bool, internal: &HashSet<&str>, builtins: &HashSet<String>) -> Result<Vec<usize>, Vec<usize>>
where
    S: ExactSizeIterator<Item = &'s str> + Clone,
    R: ExactSizeIterator<Item = bool> + Clone,
{
    let mut found: Vec<usize> = runtime_among(specifiers.clone(), resolved.clone(), builtins).into_iter().map(|(index, _)| index).collect();
    let decided = match unresolved_among(specifiers.clone(), resolved, packages, unknown) {
        Ok(installed) => {
            found.extend(installed.into_iter().filter(|(_, package)| !internal.contains(package)).map(|(index, _)| index));
            true
        }
        Err(()) if unknown || packages.iter().any(|package| !internal.contains(package)) => {
            found.extend(specifiers.enumerate().filter(|(_, specifier)| request_of(specifier).and_then(|name| package_of(name, &HashSet::new())).is_some()).map(|(index, _)| index));
            false
        }
        Err(()) => true,
    };
    found.sort_unstable();
    found.dedup();
    if decided { Ok(found) } else { Err(found) }
}

/// One file's requests as the scan left them, before any index is written.
#[napi(object)]
pub struct ScannedRequests {
    /// The specifiers as the file wrote them, in source order.
    pub specifiers: Vec<String>,
    /// Request by request, whether the scan resolved it to a file; absent when the record holds no targets.
    pub resolved: Option<Vec<bool>>,
    /// The packages the record says the file imports.
    pub packages: Vec<String>,
    /// The record did not read.
    pub unknown: bool,
}

impl ScannedRequests {
    fn specifiers(&self) -> impl ExactSizeIterator<Item = &str> + Clone {
        self.specifiers.iter().map(String::as_str)
    }

    fn resolved(&self) -> Option<impl ExactSizeIterator<Item = bool> + Clone + '_> {
        self.resolved.as_ref().map(|resolved| resolved.iter().copied())
    }
}

/// What [`outside_among`] decides of one file.
#[napi(object)]
pub struct OutsideRequests {
    /// The indices among its specifiers of the requests out of a module outside the workspace, or that may be.
    pub outside: Vec<u32>,
    /// `false` when the file's imports do not read and some of `outside` only may be.
    pub decided: bool,
}

/// [`outside_among`] for each of `files`, read by the scan before it writes
/// an index; `indexed` is every file the scan holds, beside which the
/// workspace's manifests are read, and only when a request may name one.
#[napi]
pub fn outside_requests_of(root: String, indexed: Vec<String>, files: Vec<ScannedRequests>, builtins: Vec<String>) -> Vec<OutsideRequests> {
    let builtins: HashSet<String> = builtins.into_iter().collect();
    let packages: Vec<HashSet<&str>> = files.iter().map(|file| file.packages.iter().map(String::as_str).collect()).collect();
    let waits = files.iter().zip(&packages).any(|(file, packages)| unresolved_among(file.specifiers(), file.resolved(), packages, file.unknown).map_or(true, |found| !found.is_empty()));
    let paths = if waits { beside(&root, indexed.iter().map(String::as_str)) } else { Vec::new() };
    let owners = owners(&root, &paths);
    let internal: HashSet<&str> = owners.packages.iter().map(|package| package.name.as_str()).collect();
    files
        .iter()
        .zip(&packages)
        .map(|(file, packages)| {
            let (outside, decided) = match outside_among(file.specifiers(), file.resolved(), packages, file.unknown, &internal, &builtins) {
                Ok(outside) => (outside, true),
                Err(outside) => (outside, false),
            };
            OutsideRequests { outside: outside.into_iter().map(|index| index as u32).collect(), decided }
        })
        .collect()
}

#[cfg(test)]
#[path = "help_outside_tests.rs"]
mod tests;
