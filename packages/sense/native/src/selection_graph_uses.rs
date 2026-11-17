//! Demand-driven Uses provenance, joined from the same native source snapshot.
// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};
use serde::Serialize;
use crate::package_graph::{join_parses, Crossing};
use super::State;

#[derive(Clone, Debug, Default, Serialize)]
pub(crate) struct EdgeUse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imports: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reexports: Option<Vec<(String, String)>>,
}

impl State {
    pub(crate) fn edge_use(&self, importer: u32, target: u32) -> Option<EdgeUse> {
        if self.additions.contains(&(importer, target)) { return None }
        let mut uses = self.uses.lock().unwrap_or_else(|poison| poison.into_inner());
        let row = uses.entry(importer).or_insert_with(|| self.uses_of(importer));
        row.get(self.names.get(target as usize)?).cloned()
    }

    fn uses_of(&self, importer: u32) -> HashMap<String, EdgeUse> {
        let layers = self.source.layers();
        let Some(file) = self.names.get(importer as usize) else { return HashMap::new() };
        let Some((file, at)) = crate::chain_lookup::record(layers, file) else { return HashMap::new() };
        let mut crossing = [Crossing { file, at, owner: crate::package_owners::NO_OWNER, others: Vec::new(), parse: None }];
        join_parses(layers, &mut crossing);
        let Some((layer, row)) = crossing[0].parse else { return HashMap::new() };
        let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
        let (record_text, records) = (&layers[at.0].stored, &layers[at.0].records);
        let targets = records.targets.range(at.1);
        let requests = parses.requests.range(row);
        if records.targets_present[at.1] != 1 || requests.len() != targets.len() { return HashMap::new() }
        let mut imports: HashMap<String, Option<HashSet<String>>> = HashMap::new();
        let mut republishing = HashMap::new();
        for (request, target) in requests.zip(targets) {
            let Some(target) = record_text.optional(records.target_path.at(target)) else { continue };
            match text.text(parses.request_kind.at(request)) {
                "reexports" => { republishing.insert(text.text(parses.request_value.at(request)), target); }
                "imports" => {
                    let names: Vec<_> = parses.request_bindings.range(request).map(|at| text.text(parses.binding_imported.at(at))).collect();
                    let row = imports.entry(target.to_owned()).or_insert_with(|| Some(HashSet::new()));
                    if names.is_empty() || names.contains(&"*") { *row = None; }
                    else if let Some(held) = row { held.extend(names.into_iter().map(str::to_owned)); }
                }
                _ => {}
            }
        }
        let exports_present = parses.exports_present[row] == 1;
        let mut passes: HashMap<&str, Vec<(String, String)>> = HashMap::new();
        if exports_present {
            for export in parses.exports.range(row) {
                if parses.export_type[export] == 1 { continue }
                let Some(from) = text.optional(parses.export_from.at(export)) else { continue };
                let Some(&target) = republishing.get(from) else { continue };
                passes.entry(target).or_default().push((text.optional(parses.export_imported.at(export)).unwrap_or("*").to_owned(),
                    text.optional(parses.export_exported.at(export)).unwrap_or("*").to_owned()));
            }
        }
        let targets: HashSet<_> = imports.keys().cloned().chain(republishing.values().map(|to| (*to).to_owned())).collect();
        targets.into_iter().map(|target| {
            let imported = imports.remove(&target).flatten().map(|names| {
                let mut names: Vec<_> = names.into_iter().collect(); names.sort_unstable_by(|a, b| crate::order::code_unit(a, b)); names
            });
            let reexports = exports_present.then(|| passes.remove(target.as_str()).unwrap_or_default());
            (target, EdgeUse { imports: imported, reexports })
        }).collect()
    }
}
