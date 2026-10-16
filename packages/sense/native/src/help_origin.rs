//! Where a name a file only passes on comes from.
//!
//! `export { taxOf as levy } from './tax.js'` exports `levy` and declares
//! nothing: the declaration is `taxOf` in the file the request resolved to.
//! The importers of a name are walked forward from its declaration
//! (`help_usage.rs`); this walks the other way, from one export back through
//! each `export … from` that passes it on, to the file that declares it. The
//! parse says which name each request passes on as which (`passed_on`), and
//! the file's record says which file the request resolved to.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

use napi_derive::napi;

use crate::compact::Layer;
use crate::package_graph::{fold, join_parses, passed_on, At, Crossing};
use crate::package_owners::NO_OWNER;

/// One file a name is passed on from, and the name it has there.
#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PassedFrom {
    pub at: String,
    pub name: String,
}

/// Each file and name the export `name` of `file` is passed on from, nearest
/// first, the last one the file that declares it; empty when `file` passes no
/// export by that name on. A namespace (`export * as`), a bare `export *`, a
/// type-only export and a request that resolved to no file of the checkout end
/// the walk where they stand, and so does a cycle.
pub(crate) fn passed_from(layers: &[Layer], file: &str, name: &str) -> Vec<PassedFrom> {
    let folded = fold(layers);
    let mut hops: Vec<PassedFrom> = Vec::new();
    let mut at = PassedFrom { at: file.to_owned(), name: name.to_owned() };
    while let Some(next) = step(layers, &folded, &at) {
        if next == at || hops.contains(&next) { break; }
        hops.push(next.clone());
        at = next;
    }
    hops
}

/// The file and name one `export … from` of `from.at` passes `from.name` on from.
fn step(layers: &[Layer], folded: &HashMap<&str, At>, from: &PassedFrom) -> Option<PassedFrom> {
    let (&file, &at) = folded.get_key_value(from.at.as_str())?;
    let mut crossings = [Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None }];
    join_parses(layers, &mut crossings);
    let (layer, row) = crossings[0].parse?;
    let (stored, records) = (&layers[at.0].stored, &layers[at.0].records);
    if records.targets_present[at.1] != 1 { return None; }
    let resolved: Vec<Option<&str>> = records.targets.range(at.1).map(|target| stored.optional(records.target_path.at(target))).collect();
    let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
    // A record whose targets do not line up with the parse's requests answers none of them.
    if resolved.len() != parses.requests.range(row).len() { return None; }
    let first = parses.requests.at(row) as usize;
    for request in parses.requests.range(row) {
        if text.text(parses.request_kind.at(request)) != "reexports" { continue; }
        let Some(to) = resolved[request - first] else { continue };
        let passed = passed_on(&layers[layer], row, request).unwrap_or_default();
        if let Some((imported, _)) = passed.into_iter().find(|&(imported, exported)| imported != "*" && exported == Some(from.name.as_str())) {
            return Some(PassedFrom { at: to.to_owned(), name: imported.to_owned() });
        }
    }
    None
}
