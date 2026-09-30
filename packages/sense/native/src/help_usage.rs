//! What a repository imports from what it publishes, read off the folded chain.
//!
//! `collectingUsage` in `packages/help/src/read.ts` is the twin: same joins,
//! same rule for which request counts, so the two answer alike. It exists here
//! because the chain is already open in this process and the JavaScript twin
//! decoded every record of it to be handed the same columns.

// compass: variance-authority.reach.relations

use std::collections::HashSet;

use napi_derive::napi;
use rayon::prelude::*;

use crate::compact::Layer;
use crate::orient_map_read::beside;
use crate::package_graph::{fold, join_parses, Crossing};
use crate::package_owners::{owners, NO_OWNER};

#[napi(object)]
#[derive(serde::Serialize)]
pub struct NamedExport {
    pub name: String,
    pub at: String,
    pub by: String,
    pub line: u32,
    #[serde(rename = "type")]
    pub r#type: bool,
    pub kind: String,
}

/// An import of a file of a workspace package, rather than of an entry its
/// manifest opens: `Deep` in `package/src/use.ts`.
#[napi(object)]
pub struct DeepRequest {
    pub specifier: String,
    pub by: String,
    pub at: String,
    pub line: u32,
    /// The file the specifier resolved to, as the index recorded it.
    pub to: Option<String>,
    /// Every name the import takes, keyed by the requested key.
    pub names: Vec<NameUse>,
}

#[napi(object)]
pub struct NameUse {
    pub key: String,
    pub name: String,
    pub by: String,
    pub at: String,
    pub line: u32,
    pub r#type: bool,
    pub kind: String,
    /// `dynamic` or `namespace` with the request's line, when no import named it.
    pub through: Option<String>,
    pub through_line: u32,
}

#[napi(object)]
pub struct IndexedUsage {
    pub exported: Vec<NamedExport>,
    pub deep: Vec<DeepRequest>,
    /// Imports of a package that declares no entry: every one is by path.
    pub by_path: Vec<DeepRequest>,
    pub unreadable: Vec<String>,
    /// Only the uses through a key in `opened`.
    pub names: Vec<NameUse>,
}

/// `kindOf` in `package/src/use.ts`.
fn kind_of(at: &str) -> &'static str {
    let file = at.rsplit('/').next().unwrap_or(at);
    if file.contains(".stories.") { "story" }
    else if file.contains(".test.") || file.contains(".spec.") || file.contains(".check.") { "test" }
    else { "source" }
}

/// `requested` in `package/src/manifest.ts`: `"<package> .<rest>"`.
fn requested(specifier: &str) -> (&str, String) {
    let name = if specifier.starts_with('@') {
        specifier.match_indices('/').nth(1).map_or(specifier, |(at, _)| &specifier[..at])
    } else {
        specifier.split('/').next().unwrap_or(specifier)
    };
    (name, format!("{name} .{}", &specifier[name.len()..]))
}

#[derive(Default)]
struct Part {
    exported: Vec<NamedExport>,
    deep: Vec<DeepRequest>,
    by_path: Vec<DeepRequest>,
    unreadable: Vec<String>,
    reasons: Vec<String>,
    names: Vec<NameUse>,
}

fn collect(layers: &[Layer], crossing: &Crossing, by: &str, packages: &HashSet<&str>, opened: &HashSet<&str>, unentered: &HashSet<&str>) -> Part {
    let mut part = Part::default();
    let (stored, records) = (&layers[crossing.at.0].stored, &layers[crossing.at.0].records);
    let at = crossing.file;
    if let Some(reason) = records.unknown_of(stored, crossing.at.1) { part.reasons.push(reason.to_owned()); }
    let Some((layer, row)) = crossing.parse else { return part };
    let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
    if text.optional(parses.unknown.at(row)).is_some() { part.unreadable.push(at.to_owned()); }
    let kind = kind_of(at);
    if parses.exports_present[row] == 1 {
        for export in parses.exports.range(row) {
            let id = parses.export_exported.at(export);
            let Some(name) = text.optional(id) else { continue };
            part.exported.push(NamedExport { name: name.to_owned(), at: at.to_owned(), by: by.to_owned(), line: parses.export_line.at(export), r#type: parses.export_type[export] == 1, kind: kind.to_owned() });
        }
    }
    let first = parses.requests.at(row) as usize;
    // The index resolved each request when it wrote the record; a record whose
    // targets do not line up with the parse's requests answers none of them.
    let targets: Vec<Option<&str>> = if records.targets_present[crossing.at.1] == 1 {
        records.targets.range(crossing.at.1).map(|target| stored.optional(records.target_path.at(target))).collect()
    } else {
        Vec::new()
    };
    let aligned = targets.len() == parses.requests.range(row).len();
    for request in parses.requests.range(row) {
        let value = text.text(parses.request_value.at(request));
        let (package, key) = requested(value);
        if !packages.contains(package) { continue; }
        let line = parses.request_line.at(request);
        let mut names = Vec::new();
        for binding in parses.request_bindings.range(request) {
            let imported = text.text(parses.binding_imported.at(binding));
            if imported == "*" { continue; }
            names.push(NameUse { key: key.clone(), name: imported.to_owned(), by: by.to_owned(), at: at.to_owned(), line: parses.binding_line.at(binding), r#type: parses.binding_type[binding] == 1, kind: kind.to_owned(), through: None, through_line: 0 });
        }
        let through = if text.text(parses.request_kind.at(request)) == "dynamic" { "dynamic" } else { "namespace" };
        for member in parses.members.range(row) {
            if parses.member_request.at(member) as usize != request - first { continue; }
            names.push(NameUse { key: key.clone(), name: text.text(parses.member_name.at(member)).to_owned(), by: by.to_owned(), at: at.to_owned(), line: parses.member_line.at(member), r#type: false, kind: kind.to_owned(), through: Some(through.to_owned()), through_line: line });
        }
        if opened.contains(key.as_str()) {
            part.names.extend(names);
            continue;
        }
        let to = if aligned { targets[request - first].map(str::to_owned) } else { None };
        let held = DeepRequest { specifier: value.to_owned(), by: by.to_owned(), at: at.to_owned(), line, to, names };
        if unentered.contains(package) { part.by_path.push(held) } else { part.deep.push(held) }
    }
    part
}

pub(crate) fn usage(root: &str, layers: &[Layer], opened: &[String], unentered: &[String]) -> IndexedUsage {
    let folded = fold(layers);
    let paths = beside(root, folded.keys().copied());
    let owners = owners(root, &paths);
    let mut crossings: Vec<Crossing> = folded
        .into_iter()
        .map(|(path, at)| Crossing { file: path, owner: owners.files.get(path).map_or(NO_OWNER, |&(owner, _)| owner), others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let opened: HashSet<&str> = opened.iter().map(String::as_str).collect();
    let unentered: HashSet<&str> = unentered.iter().map(String::as_str).collect();
    let packages: HashSet<&str> = opened.iter().map(|key| key.split(' ').next().unwrap_or(key)).chain(unentered.iter().copied()).collect();
    let parts: Vec<Part> = crossings
        .par_iter()
        .map(|crossing| {
            let by = if crossing.owner == NO_OWNER { "" } else { owners.packages[crossing.owner as usize].name.as_str() };
            collect(layers, crossing, by, &packages, &opened, &unentered)
        })
        .collect();
    let mut out = IndexedUsage { exported: Vec::new(), deep: Vec::new(), by_path: Vec::new(), unreadable: Vec::new(), names: Vec::new() };
    let mut reasons = Vec::new();
    for part in parts {
        reasons.extend(part.reasons);
        out.exported.extend(part.exported);
        out.deep.extend(part.deep);
        out.by_path.extend(part.by_path);
        out.unreadable.extend(part.unreadable);
        out.names.extend(part.names);
    }
    out.unreadable.extend(reasons);
    out
}
