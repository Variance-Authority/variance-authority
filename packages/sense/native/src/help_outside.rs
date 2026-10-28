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
use crate::external_dependencies::unresolved_requests;
use crate::help_usage::{bound, kind_of, taken, NameUse};
use crate::orient_map_read::beside;
use crate::package_graph::{fold, join_parses, At, Crossing};
use crate::package_owners::{owners, NO_OWNER};
use crate::specifier::builtin_of;

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
    /// Files the index holds whose imports do not read, in code-unit order.
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
    let mut found = runtime_uses(layers, crossing, name, builtins);
    let Ok(requests) = unresolved_requests(layers, crossing) else {
        let (layer, row) = crossing.at;
        let (stored, records) = (&layers[layer].stored, &layers[layer].records);
        if records.unknown_of(stored, row).is_some() { return Read::Unknown(crossing.file, found); }
        return Read::Unaligned(crossing.file, crossing.at, found);
    };
    let Some((layer, row)) = crossing.parse else { return Read::Found(found) };
    let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
    let kind = kind_of(crossing.file);
    for (request, package) in requests {
        let written = text.text(parses.request_value.at(request));
        let passes_on = parses.request_republishes[request] == 1;
        for (site, local) in taken(&layers[layer], row, request, written, "", crossing.file, kind) {
            if site.name == name { found.push(OutsideUse { package: package.to_owned(), runtime: false, passes_on, site: bound(&layers[layer], row, site, if passes_on { "" } else { local }) }); }
        }
    }
    Read::Found(found)
}

/// Every binding of `name` off a request for a module of the runtime's, as
/// [`runtime_requests`] reads them.
fn runtime_uses(layers: &[Layer], crossing: &Crossing, name: &str, builtins: &HashSet<String>) -> Vec<OutsideUse> {
    let Some((layer, row)) = crossing.parse else { return Vec::new() };
    let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
    let kind = kind_of(crossing.file);
    let mut found = Vec::new();
    for (request, package) in runtime_requests(layers, crossing, builtins) {
        let written = text.text(parses.request_value.at(request));
        let passes_on = parses.request_republishes[request] == 1;
        for (site, local) in taken(&layers[layer], row, request, written, "", crossing.file, kind) {
            if site.name == name { found.push(OutsideUse { package: package.clone(), runtime: true, passes_on, site: bound(&layers[layer], row, site, if passes_on { "" } else { local }) }); }
        }
    }
    found
}

/// Which of one crossing's requests are for a module of the runtime's, each as
/// its index among the parse's requests and the module with its `node:`
/// scheme, in source order: a specifier [`builtin_of`] names, unless the scan
/// resolved the request to a file. A record whose targets do not line up with
/// its parse cannot say which did, so each such request is counted.
pub(crate) fn runtime_requests(layers: &[Layer], crossing: &Crossing, builtins: &HashSet<String>) -> Vec<(usize, String)> {
    let Some((layer, row)) = crossing.parse else { return Vec::new() };
    let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
    let (record_layer, record_row) = crossing.at;
    let (stored, records) = (&layers[record_layer].stored, &layers[record_layer].records);
    let requests = parses.requests.range(row);
    let first = requests.start;
    let targets = (records.targets_present[record_row] == 1).then(|| records.targets.range(record_row)).filter(|targets| targets.len() == requests.len());
    requests
        .filter_map(|request| {
            let module = builtin_of(text.text(parses.request_value.at(request)), builtins)?;
            let resolved = targets.as_ref().is_some_and(|targets| stored.optional(records.target_path.at(targets.start + (request - first))).is_some());
            (!resolved).then_some((request, module))
        })
        .collect()
}

#[cfg(test)]
#[path = "help_outside_tests.rs"]
mod tests;
