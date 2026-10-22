//! Which imports bind a name to an export of another name.
//!
//! `import { stringReader as openStrings } from './strings.js'` binds
//! `openStrings` in its file to the export `stringReader` of the file the
//! request resolves to. The binding the parse recorded is the one fact that
//! ties the two names; nothing about how they are spelled does. A question
//! about the local name reads the binding here and follows it to the original.

// compass: variance-authority.reach.relations

use std::collections::HashSet;

use napi_derive::napi;

use crate::compact::Layer;
use crate::help_usage::kind_of;
use crate::orient_map_read::beside;
use crate::package_graph::{fold, join_parses, Crossing};
use crate::package_owners::{owners, NO_OWNER};

/// One import that binds a local name to an export named otherwise.
#[napi(object)]
pub struct Alias {
    /// The importing file, and the line of its import statement.
    pub at: String,
    pub line: u32,
    /// The package of the importing file, or empty when no package holds it.
    pub by: String,
    /// `story`, `test` or `source`, by the importing file's name.
    pub kind: String,
    /// The export name the binding takes, `default` for a default import.
    pub imported: String,
    /// The specifier as the importing file wrote it.
    pub specifier: String,
    /// The file the index resolved the specifier to, when it resolved.
    pub to: Option<String>,
    pub r#type: bool,
}

/// Every binding on the chain whose local name is `local` and whose imported
/// name is another, ordered by the importing file in code units, then by line.
/// A namespace import names no export and is left out. So is a binding an
/// `export … from` writes: its name is the one the file publishes, not one it
/// binds, and the export list is what answers it.
pub(crate) fn aliases(root: &str, layers: &[Layer], local: &str) -> Vec<Alias> {
    // The digests whose parse binds the name somewhere on the chain; the
    // file's newest parse is joined below and asked again. A layer whose
    // dictionary never names it binds it nowhere, and is not read.
    let mut binding: HashSet<&str> = HashSet::new();
    for layer in layers {
        let (stored, parses) = (&layer.stored, &layer.parses);
        let ids = stored.ids_of(local);
        if ids.is_empty() { continue; }
        for row in 0..parses.key.len() {
            let renames = parses.requests.range(row).any(|request| {
                parses.request_bindings.range(request).any(|at| {
                    ids.contains(&parses.binding_local.at(at)) && !ids.contains(&parses.binding_imported.at(at))
                })
            });
            if renames { binding.insert(stored.text(parses.key.at(row))); }
        }
    }
    if binding.is_empty() { return Vec::new(); }
    let mut crossings: Vec<Crossing> = fold(layers)
        .into_iter()
        .filter(|&(_, (layer, row))| {
            let (stored, records) = (&layers[layer].stored, &layers[layer].records);
            stored.optional(records.digest.at(row)).is_some_and(|digest| binding.contains(digest))
        })
        .map(|(file, at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let paths = beside(root, crossings.iter().map(|crossing| crossing.file));
    let owners = owners(root, &paths);
    let mut found = Vec::new();
    for crossing in &crossings {
        let Some((layer, row)) = crossing.parse else { continue };
        let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
        let (stored, records) = (&layers[crossing.at.0].stored, &layers[crossing.at.0].records);
        let resolved: Vec<Option<&str>> = if records.targets_present[crossing.at.1] == 1 {
            records.targets.range(crossing.at.1).map(|target| stored.optional(records.target_path.at(target))).collect()
        } else {
            Vec::new()
        };
        // A record whose targets do not line up with the parse's requests resolves none of them.
        let aligned = resolved.len() == parses.requests.range(row).len();
        let first = parses.requests.at(row) as usize;
        let by = owners.package_of(crossing.file);
        let mut sites = Vec::new();
        for request in parses.requests.range(row) {
            let specifier = text.text(parses.request_value.at(request));
            // An `export … from` group, `export type` included, binds nothing of its own.
            if parses.request_republishes[request] == 1 { continue; }
            for at in parses.request_bindings.range(request) {
                if text.text(parses.binding_local.at(at)) != local { continue; }
                let imported = text.text(parses.binding_imported.at(at));
                if imported == local || imported == "*" { continue; }
                sites.push(Alias {
                    at: crossing.file.to_owned(),
                    line: parses.binding_line.at(at),
                    by: by.to_owned(),
                    kind: kind_of(crossing.file).to_owned(),
                    imported: imported.to_owned(),
                    specifier: specifier.to_owned(),
                    to: if aligned { resolved[request - first].map(str::to_owned) } else { None },
                    r#type: parses.binding_type[at] == 1,
                });
            }
        }
        sites.sort_by_key(|site| site.line);
        found.extend(sites);
    }
    found
}
