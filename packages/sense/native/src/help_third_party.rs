//! Who imports a name out of a package the workspace installs rather than writes.
//!
//! The declaration is not in the checkout, but every import of it is: a request
//! the scan could not resolve to a file, whose specifier names a package the
//! record says the file imports and no manifest of the workspace declares. That
//! is the rule `requests_of` in `external_dependencies.rs` keeps for the
//! external packages a file reaches, read here per binding, so a site has its
//! own line and the name it binds.

// compass: variance-authority.reach.relations

use std::collections::HashSet;

use rayon::prelude::*;

use crate::compact::Layer;
use crate::help_usage::{kind_of, taken, NameUse};
use crate::orient_map_read::beside;
use crate::package_graph::{fold, join_parses, Crossing};
use crate::package_owners::{owners, NO_OWNER};
use crate::specifier::{package_of, request_of};

/// Every import of `name` out of a package no manifest of the workspace
/// declares, by any file on the chain: each binding and each member read off a
/// module held whole. A use's `key` is the specifier as written. Ordered by the
/// importing file in code units, then by line, then by specifier.
pub(crate) fn third_party_importers(root: &str, layers: &[Layer], name: &str) -> Vec<NameUse> {
    let folded = fold(layers);
    let paths = beside(root, folded.keys().copied());
    let owners = owners(root, &paths);
    let internal: HashSet<&str> = owners.packages.iter().map(|package| package.name.as_str()).collect();
    // Only a record that says it imports an outside package has a parse worth joining.
    let mut crossings: Vec<Crossing> = folded
        .iter()
        .filter(|&(_, &(layer, row))| {
            let (stored, records) = (&layers[layer].stored, &layers[layer].records);
            records.targets_present[row] == 1 && records.packages_of(stored, row).any(|package| !internal.contains(package))
        })
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let mut found: Vec<NameUse> = crossings
        .par_iter()
        .flat_map_iter(|crossing| {
            let mut found = Vec::new();
            let Some((layer, row)) = crossing.parse else { return found };
            let (stored, records) = (&layers[crossing.at.0].stored, &layers[crossing.at.0].records);
            let imported: HashSet<&str> = records.packages_of(stored, crossing.at.1).collect();
            let resolved: Vec<bool> = records.targets.range(crossing.at.1).map(|target| stored.optional(records.target_path.at(target)).is_some()).collect();
            let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
            // A record whose targets do not line up with the parse's requests answers none of them.
            if resolved.len() != parses.requests.range(row).len() { return found; }
            let first = parses.requests.at(row) as usize;
            let (by, kind) = (owners.package_of(crossing.file), kind_of(crossing.file));
            for request in parses.requests.range(row) {
                if resolved[request - first] || parses.request_republishes[request] == 1 { continue; }
                let written = text.text(parses.request_value.at(request));
                let Some(package) = request_of(written).and_then(|value| package_of(value, &HashSet::new())) else { continue };
                if !imported.contains(package) || internal.contains(package) { continue; }
                found.extend(taken(&layers[layer], row, request, written, by, crossing.file, kind).into_iter().map(|(use_, _)| use_).filter(|use_| use_.name == name));
            }
            found
        })
        .collect();
    found.sort_by(|a, b| {
        crate::order::code_unit(&a.at, &b.at)
            .then(a.line.cmp(&b.line))
            .then_with(|| crate::order::code_unit(&a.key, &b.key))
            .then_with(|| crate::order::code_unit(a.local.as_deref().unwrap_or(""), b.local.as_deref().unwrap_or("")))
    });
    found
}
