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
use crate::package_graph::{fold, join_parses, At, Crossing};
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
    /// Imports of a specifier a published manifest declares and no entry
    /// opens, because the reading could not follow it to a source file.
    pub unfollowed: Vec<DeepRequest>,
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
    unfollowed: Vec<DeepRequest>,
    unreadable: Vec<String>,
    reasons: Vec<String>,
    names: Vec<NameUse>,
}

/// The packages an import between packages is followed into, by what each
/// declares: `ImportTargets` in `package/src/entry.ts`, keyed as `requested` keys.
struct Targets<'a> {
    /// Every package an import is followed into: published, or declaring no entry.
    packages: HashSet<&'a str>,
    opened: HashSet<&'a str>,
    unentered: HashSet<&'a str>,
    declared: HashSet<&'a str>,
}

/// `landing` in `package/src/entry.ts`, for a package already known to be followed into.
enum Landing { Opened, Unfollowed, Deep, ByPath }

impl Targets<'_> {
    fn landing(&self, package: &str, key: &str) -> Landing {
        if self.opened.contains(key) { Landing::Opened }
        else if self.unentered.contains(package) { Landing::ByPath }
        else if self.declared.contains(key) { Landing::Unfollowed }
        else { Landing::Deep }
    }
}

/// The names one request of the parse at `row` takes, each a use of `key`:
/// every binding but `*`, and every member read off the module the request
/// holds whole, through `import()` or `import * as`.
fn taken(layer: &Layer, row: usize, request: usize, key: &str, by: &str, at: &str, kind: &str) -> Vec<NameUse> {
    let (text, parses) = (&layer.stored, &layer.parses);
    let first = parses.requests.at(row) as usize;
    let line = parses.request_line.at(request);
    let mut names = Vec::new();
    for binding in parses.request_bindings.range(request) {
        let imported = text.text(parses.binding_imported.at(binding));
        if imported == "*" { continue; }
        names.push(NameUse { key: key.to_owned(), name: imported.to_owned(), by: by.to_owned(), at: at.to_owned(), line: parses.binding_line.at(binding), r#type: parses.binding_type[binding] == 1, kind: kind.to_owned(), through: None, through_line: 0 });
    }
    let through = if text.text(parses.request_kind.at(request)) == "dynamic" { "dynamic" } else { "namespace" };
    for member in parses.members.range(row) {
        if parses.member_request.at(member) as usize != request - first { continue; }
        names.push(NameUse { key: key.to_owned(), name: text.text(parses.member_name.at(member)).to_owned(), by: by.to_owned(), at: at.to_owned(), line: parses.member_line.at(member), r#type: false, kind: kind.to_owned(), through: Some(through.to_owned()), through_line: line });
    }
    names
}

fn collect(layers: &[Layer], crossing: &Crossing, by: &str, targets: &Targets) -> Part {
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
    let resolved: Vec<Option<&str>> = if records.targets_present[crossing.at.1] == 1 {
        records.targets.range(crossing.at.1).map(|target| stored.optional(records.target_path.at(target))).collect()
    } else {
        Vec::new()
    };
    let aligned = resolved.len() == parses.requests.range(row).len();
    for request in parses.requests.range(row) {
        let value = text.text(parses.request_value.at(request));
        let (package, key) = requested(value);
        if !targets.packages.contains(package) { continue; }
        let line = parses.request_line.at(request);
        let names = taken(&layers[layer], row, request, &key, by, at, kind);
        let into = match targets.landing(package, &key) {
            Landing::Opened => {
                part.names.extend(names);
                continue;
            }
            Landing::Unfollowed => &mut part.unfollowed,
            Landing::Deep => &mut part.deep,
            Landing::ByPath => &mut part.by_path,
        };
        let to = if aligned { resolved[request - first].map(str::to_owned) } else { None };
        into.push(DeepRequest { specifier: value.to_owned(), by: by.to_owned(), at: at.to_owned(), line, to, names });
    }
    part
}

/// What the files on the chain import from the workspace's packages. `opened`
/// and `declared` are `requested` keys; `published` and `unentered` are names.
pub(crate) fn usage(root: &str, layers: &[Layer], opened: &[String], published: &[String], unentered: &[String], declared: &[String]) -> IndexedUsage {
    let folded = fold(layers);
    let paths = beside(root, folded.keys().copied());
    let owners = owners(root, &paths);
    let mut crossings: Vec<Crossing> = folded
        .into_iter()
        .map(|(path, at)| Crossing { file: path, owner: owners.files.get(path).map_or(NO_OWNER, |&(owner, _)| owner), others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let targets = Targets {
        // A published package whose entry opens nothing is still one its importers reach past.
        packages: published.iter().chain(unentered).map(String::as_str).collect(),
        opened: opened.iter().map(String::as_str).collect(),
        unentered: unentered.iter().map(String::as_str).collect(),
        declared: declared.iter().map(String::as_str).collect(),
    };
    let parts: Vec<Part> = crossings
        .par_iter()
        .map(|crossing| {
            let by = if crossing.owner == NO_OWNER { "" } else { owners.packages[crossing.owner as usize].name.as_str() };
            collect(layers, crossing, by, &targets)
        })
        .collect();
    let mut out = IndexedUsage { exported: Vec::new(), deep: Vec::new(), by_path: Vec::new(), unfollowed: Vec::new(), unreadable: Vec::new(), names: Vec::new() };
    let mut reasons = Vec::new();
    for part in parts {
        reasons.extend(part.reasons);
        out.exported.extend(part.exported);
        out.deep.extend(part.deep);
        out.by_path.extend(part.by_path);
        out.unfollowed.extend(part.unfollowed);
        out.unreadable.extend(part.unreadable);
        out.names.extend(part.names);
    }
    out.unreadable.extend(reasons);
    out
}

/// Every import, by any file on the chain, of `name` out of one of `files`:
/// the bindings and member reads that take it through a request the index
/// resolved to one of them, in code-unit order of the importing file. A
/// relative import is read like one between packages, which `usage` does not
/// record. Each use's `key` is the specifier as written.
pub(crate) fn importers(root: &str, layers: &[Layer], files: &[String], name: &str) -> Vec<NameUse> {
    let wanted: HashSet<&str> = files.iter().map(String::as_str).collect();
    let lands = |at: At| {
        let (stored, records) = (&layers[at.0].stored, &layers[at.0].records);
        records.targets_present[at.1] == 1
            && records.targets.range(at.1).any(|target| stored.optional(records.target_path.at(target)).is_some_and(|path| wanted.contains(path)))
    };
    let mut crossings: Vec<Crossing> = fold(layers)
        .into_iter()
        .filter(|&(_, at)| lands(at))
        .map(|(file, at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let paths = beside(root, crossings.iter().map(|crossing| crossing.file));
    let owners = owners(root, &paths);
    let parts: Vec<Vec<NameUse>> = crossings
        .par_iter()
        .map(|crossing| {
            let Some((layer, row)) = crossing.parse else { return Vec::new() };
            let (stored, records) = (&layers[crossing.at.0].stored, &layers[crossing.at.0].records);
            let resolved: Vec<Option<&str>> =
                records.targets.range(crossing.at.1).map(|target| stored.optional(records.target_path.at(target))).collect();
            let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
            // A record whose targets do not line up with the parse's requests answers none of them.
            if resolved.len() != parses.requests.range(row).len() { return Vec::new(); }
            let first = parses.requests.at(row) as usize;
            let by = match owners.files.get(crossing.file) {
                Some(&(owner, _)) if owner != NO_OWNER => owners.packages[owner as usize].name.as_str(),
                _ => "",
            };
            let kind = kind_of(crossing.file);
            let mut found = Vec::new();
            for request in parses.requests.range(row) {
                if !resolved[request - first].is_some_and(|path| wanted.contains(path)) { continue; }
                let written = text.text(parses.request_value.at(request));
                found.extend(taken(&layers[layer], row, request, written, by, crossing.file, kind).into_iter().filter(|taken| taken.name == name));
            }
            found
        })
        .collect();
    parts.into_iter().flatten().collect()
}
