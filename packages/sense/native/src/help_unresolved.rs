//! The files `importers` cannot answer for: each import whose specifier the
//! index resolved to no file, and that could take one of the names the walk
//! wanted. A use there is not listed, so the answer names the file instead.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use crate::compact::Layer;
use crate::orient_map_read::beside;
use crate::package_graph::{fold, join_parses, passed_on, At, Crossing};
use crate::package_owners::{owners, NO_OWNER};
use crate::specifier::{is_relative, package_of};

/// Every file, in code-unit order, with an import that resolved to no file
/// and could take one of `exports`: a relative specifier, which could have
/// meant any file, or one naming a package that holds one of `files` or
/// `through`, the files the name is declared in or passed on through.
pub(super) fn unresolved(
    root: &str,
    layers: &[Layer],
    folded: &HashMap<&str, At>,
    files: &[String],
    through: &HashSet<String>,
    exports: &HashSet<String>,
) -> Vec<String> {
    let holding = files.iter().map(String::as_str).chain(through.iter().map(String::as_str));
    let paths = beside(root, holding.clone());
    let packages: HashSet<String> = {
        let owners = owners(root, &paths);
        holding.map(|file| owners.package_of(file)).filter(|name| !name.is_empty()).map(str::to_owned).collect()
    };
    let leaves = |at: At| {
        let (stored, records) = (&layers[at.0].stored, &layers[at.0].records);
        records.targets_present[at.1] == 1 && records.targets.range(at.1).any(|target| stored.optional(records.target_path.at(target)).is_none())
    };
    let mut crossings: Vec<Crossing> = folded
        .iter()
        .filter(|&(_, &at)| leaves(at))
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let none = HashSet::new();
    crossings
        .iter()
        .filter(|crossing| {
            let Some((layer, row)) = crossing.parse else { return false };
            let (stored, records) = (&layers[crossing.at.0].stored, &layers[crossing.at.0].records);
            let resolved: Vec<bool> = records.targets.range(crossing.at.1).map(|target| stored.optional(records.target_path.at(target)).is_some()).collect();
            let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
            if resolved.len() != parses.requests.range(row).len() { return false; }
            let first = parses.requests.at(row) as usize;
            parses.requests.range(row).any(|request| {
                if resolved[request - first] { return false; }
                let written = text.text(parses.request_value.at(request));
                let meant = is_relative(written) || package_of(written, &none).is_some_and(|package| packages.contains(package));
                meant && takes(&layers[layer], row, request, exports)
            })
        })
        .map(|crossing| crossing.file.to_owned())
        .collect()
}

/// Whether `request` of the parse at `row` could take one of `exports`: it
/// binds one, reads one off the module, holds the module whole, or passes one
/// on.
fn takes(layer: &Layer, row: usize, request: usize, exports: &HashSet<String>) -> bool {
    if layer.parses.request_republishes[request] == 1 {
        return match passed_on(layer, row, request) {
            None => true,
            Some(listed) => listed.iter().any(|one| one.imported == "*" || exports.contains(one.imported)),
        };
    }
    names(layer, row, request, exports) || reads(layer, row, request, &|name| name == "*")
}

/// Whether the import `request` of the parse at `row` binds one of `exports`
/// or reads one off the module.
fn names(layer: &Layer, row: usize, request: usize, exports: &HashSet<String>) -> bool {
    let (text, parses) = (&layer.stored, &layer.parses);
    parses.request_bindings.range(request).any(|binding| {
        let imported = text.text(parses.binding_imported.at(binding));
        imported != "*" && exports.contains(imported)
    }) || reads(layer, row, request, &|name| exports.contains(name))
}

/// Whether a name `keep` lets through is read off the module `request` of the parse at `row` imports.
fn reads(layer: &Layer, row: usize, request: usize, keep: &dyn Fn(&str) -> bool) -> bool {
    let (text, parses) = (&layer.stored, &layer.parses);
    let first = parses.requests.at(row) as usize;
    parses.members.range(row).any(|member| parses.member_request.at(member) as usize == request - first && keep(text.text(parses.member_name.at(member))))
}

/// Every specifier, as written and in code-unit order, that names a package
/// or a runtime module the index resolved to no file and that an import binds
/// `name` out of or reads it off: where a name no file here declares comes
/// from, for `discover --imports` to list the files.
pub(crate) fn sources(layers: &[Layer], name: &str) -> Vec<String> {
    let folded = fold(layers);
    let leaves = |at: At| {
        let (stored, records) = (&layers[at.0].stored, &layers[at.0].records);
        records.targets_present[at.1] == 1 && records.targets.range(at.1).any(|target| stored.optional(records.target_path.at(target)).is_none())
    };
    let mut crossings: Vec<Crossing> = folded
        .iter()
        .filter(|&(_, &at)| leaves(at))
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    join_parses(layers, &mut crossings);
    let wanted = HashSet::from([name.to_owned()]);
    let mut found = HashSet::new();
    for crossing in &crossings {
        let Some((layer, row)) = crossing.parse else { continue };
        let (stored, records) = (&layers[crossing.at.0].stored, &layers[crossing.at.0].records);
        let resolved: Vec<bool> = records.targets.range(crossing.at.1).map(|target| stored.optional(records.target_path.at(target)).is_some()).collect();
        let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
        if resolved.len() != parses.requests.range(row).len() { continue; }
        let first = parses.requests.at(row) as usize;
        for request in parses.requests.range(row) {
            if resolved[request - first] || parses.request_republishes[request] == 1 { continue; }
            let written = text.text(parses.request_value.at(request));
            if is_relative(written) || written.starts_with('/') || written.starts_with('#') { continue; }
            if names(&layers[layer], row, request, &wanted) { found.insert(written.to_owned()); }
        }
    }
    let mut found: Vec<String> = found.into_iter().collect();
    found.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    found
}
