//! What a repository imports from what it publishes, read off the folded chain.
//!
//! `collectingUsage` in `packages/help/src/read.ts` is the twin: same joins,
//! same rule for which request counts, so the two answer alike. It exists here
//! because the chain is already open in this process and the JavaScript twin
//! decoded every record of it to be handed the same columns.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use napi_derive::napi;
use rayon::prelude::*;

use crate::compact::Layer;
use crate::help_in_file::{in_file, InFile};
use crate::orient_map_read::beside;
use crate::package_graph::{fold, join_parses, passed_on, At, Crossing};
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
    /// The kind of the declaration the export binds in its own file, as the
    /// parse records it (`function`, `class`, `const` …); absent for an
    /// `export … from`, whose declaration is another file's.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub declaration: Option<String>,
    /// The doc comment above the export, or above the declaration it binds in
    /// the same file, as `dependency_namespace::doc` cuts it from the file at the
    /// span the index holds; absent when nothing documents it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
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
#[derive(Clone)]
pub struct NameUse {
    pub key: String,
    pub name: String,
    /// The name the importing file binds it to, or passes it on as, when the
    /// binding renames it with `as`; `None` when it keeps `name`.
    pub local: Option<String>,
    pub by: String,
    pub at: String,
    pub line: u32,
    pub r#type: bool,
    pub kind: String,
    /// `dynamic` or `namespace` with the request's line, when no import named it.
    pub through: Option<String>,
    pub through_line: u32,
    /// The name is read off the module's `default`, which under interop is a
    /// CommonJS module's `module.exports`.
    pub through_default: bool,
    /// The module goes, whole, somewhere the reader does not follow: this line
    /// may read the name, and what it reads is not recorded.
    pub whole: bool,
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
pub(crate) fn kind_of(at: &str) -> &'static str {
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

/// The names one request of the parse at `row` takes, each a use of `key`,
/// with the name it binds in the file, empty for a member read: every binding
/// but `*`, and every member read off the module the request holds whole,
/// through `import()` or `import * as`.
fn taken<'a>(layer: &'a Layer, row: usize, request: usize, key: &str, by: &str, at: &str, kind: &str) -> Vec<(NameUse, &'a str)> {
    let (text, parses) = (&layer.stored, &layer.parses);
    let first = parses.requests.at(row) as usize;
    let line = parses.request_line.at(request);
    let mut names = Vec::new();
    for binding in parses.request_bindings.range(request) {
        let imported = text.text(parses.binding_imported.at(binding));
        if imported == "*" { continue; }
        let local = text.text(parses.binding_local.at(binding));
        let renamed = (local != imported).then(|| local.to_owned());
        names.push((NameUse { key: key.to_owned(), name: imported.to_owned(), local: renamed, by: by.to_owned(), at: at.to_owned(), line: parses.binding_line.at(binding), r#type: parses.binding_type[binding] == 1, kind: kind.to_owned(), through: None, through_line: 0, through_default: false, whole: false }, local));
    }
    // Only an `import()` type holds a module through a `type` request, since a
    // type-only namespace holds nothing: it is an `import()`, and its reads are types.
    let kind_written = text.text(parses.request_kind.at(request));
    let typed = kind_written == "type";
    let through = if kind_written == "dynamic" || typed { "dynamic" } else { "namespace" };
    for member in parses.members.range(row) {
        if parses.member_request.at(member) as usize != request - first { continue; }
        let name = text.text(parses.member_name.at(member));
        let (through_default, whole) = (parses.member_through_default[member] == 1, name == "*");
        names.push((NameUse { key: key.to_owned(), name: name.to_owned(), local: None, by: by.to_owned(), at: at.to_owned(), line: parses.member_line.at(member), r#type: typed, kind: kind.to_owned(), through: Some(through.to_owned()), through_line: line, through_default, whole }, ""));
    }
    names
}

fn collect(root: &str, layers: &[Layer], crossing: &Crossing, by: &str, targets: &Targets) -> Part {
    let mut part = Part::default();
    let (stored, records) = (&layers[crossing.at.0].stored, &layers[crossing.at.0].records);
    let at = crossing.file;
    if let Some(reason) = records.unknown_of(stored, crossing.at.1) { part.reasons.push(reason.to_owned()); }
    let Some((layer, row)) = crossing.parse else { return part };
    let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
    if text.optional(parses.unknown.at(row)).is_some() { part.unreadable.push(at.to_owned()); }
    let kind = kind_of(at);
    if parses.exports_present[row] == 1 {
        // The file is read only when an export of it is documented: the index
        // holds where each comment is, and the text is the file's.
        let mut source: Option<Vec<u16>> = None;
        for export in parses.exports.range(row) {
            let id = parses.export_exported.at(export);
            let Some(name) = text.optional(id) else { continue };
            // The TypeScript reader spans an export's doc on the export; the
            // others span it on the declaration the export binds, by its name.
            let bound = text.optional(parses.export_local.at(export)).filter(|_| text.optional(parses.export_from.at(export)).is_none()).and_then(|local| {
                // One name may be declared twice, `const Kind` and `type Kind`: an
                // export takes the declaration on its own line, else the first.
                let line = parses.export_line.at(export);
                let named = || parses.symbols.range(row).filter(move |&symbol| parses.symbol_reach[symbol] != crate::harvest::SCOPE_CODE && text.text(parses.symbol_name.at(symbol)) == local);
                named().find(|&symbol| parses.symbol_line.at(symbol) == line).or_else(|| named().next())
            });
            let declaration = bound.map(|symbol| text.text(parses.symbol_kind.at(symbol)).to_owned());
            let doc = parses.doc_of_export(export).or_else(|| bound.and_then(|symbol| parses.doc_of_symbol(symbol))).and_then(|span| {
                let utf16 = source.get_or_insert_with(|| {
                    std::fs::read_to_string(std::path::Path::new(root).join(at)).map(|text| text.encode_utf16().collect()).unwrap_or_default()
                });
                crate::dependency_namespace::doc(utf16, Some(span))
            });
            part.exported.push(NamedExport { name: name.to_owned(), at: at.to_owned(), by: by.to_owned(), line: parses.export_line.at(export), r#type: parses.export_type[export] == 1, kind: kind.to_owned(), declaration, doc });
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
        let names: Vec<NameUse> = taken(&layers[layer], row, request, &key, by, at, kind).into_iter().map(|(taken, _)| taken).collect();
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
            collect(root, layers, crossing, by, &targets)
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

/// Who imports one name out of a set of files, and which files pass it on.
#[napi(object)]
pub struct Importers {
    /// Every use, ordered by the importing file in code units, then by line.
    pub uses: Vec<NameUse>,
    /// Every file that passes the name on with `export … from`, under the name
    /// it exports, in code-unit order; none of the files asked about.
    pub through: Vec<String>,
    /// Every line of one of the files asked about that uses the name the file
    /// declares at its top level, by file in code units, then by line.
    pub in_file: Vec<InFile>,
}

/// Every import, by any file on the chain, of `name` out of one of `files`:
/// the bindings and member reads that take it through a request the index
/// resolved to one of them. A relative import is read like one between
/// packages, which `usage` does not record. Each use's `key` is the specifier
/// as written, and its `name` the name it takes, which a re-export can rename.
///
/// What an `export … from` passes on is `passed_on`'s answer, the one the
/// package graph reads: that is no use, and the file that writes it is
/// followed instead under the name it exports, so an import through a barrel
/// is listed and the barrel is not. A bare `export *` passes on every name but
/// `default`. The question is about source, so a type-only re-export passes
/// its names on too, and every use that came through one is a type use,
/// whatever its importer wrote. Each file is followed once per name, and once
/// more when a value path reaches a name a type-only one reached first, so a
/// cycle of re-exports ends.
///
/// A file asked about that declares the name uses it by scope, not by import,
/// and the scan read those lines with its parse: they are `in_file`.
pub(crate) fn importers(root: &str, layers: &[Layer], files: &[String], name: &str) -> Importers {
    // Every file is one origin, so a file passed the name by two of them is followed once.
    let origins: HashMap<String, HashMap<String, HashSet<usize>>> =
        files.iter().map(|file| (file.clone(), HashMap::from([(name.to_owned(), HashSet::from([0]))]))).collect();
    let folded = fold(layers);
    let in_file = in_file(root, layers, &folded, files, name);
    let (found, through) = importers_folded(root, layers, &folded, origins);
    let mut found: Vec<NameUse> = found.into_iter().map(|taken| taken.taken).collect();
    found.sort_by(|a, b| {
        crate::order::code_unit(&a.at, &b.at)
            .then(a.line.cmp(&b.line))
            .then_with(|| crate::order::code_unit(&a.name, &b.name))
            .then_with(|| crate::order::code_unit(&a.key, &b.key))
            // Two bindings of one name on one line differ by what they bind it to.
            .then_with(|| crate::order::code_unit(a.local.as_deref().unwrap_or(""), b.local.as_deref().unwrap_or("")))
    });
    let mut through: Vec<String> = through.into_iter().filter(|file| !files.contains(file)).collect();
    through.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    Importers { uses: found, through, in_file }
}

/// One use `importers_from` found, of the `origin` it was asked for, with the
/// name the import binds in the file, empty for a member read.
pub(crate) struct Taken {
    pub(crate) origin: usize,
    pub(crate) taken: NameUse,
    pub(crate) local: String,
}

/// Per file, each name wanted out of it, and per origin whether only a
/// type-only path reached it.
type Wanted = HashMap<String, HashMap<String, HashMap<usize, bool>>>;

/// `importers` for several names at once: each `(file, name)` of `wanted`
/// carries the origins it answers for, and every use and every file passing
/// one on carries them along, so one walk answers them all. Each file is
/// followed once per name and origin, and once more when a value path reaches
/// it after a type-only one; a site reached both ways is a value use.
pub(crate) fn importers_from(
    root: &str,
    layers: &[Layer],
    asked: HashMap<String, HashMap<String, HashSet<usize>>>,
) -> (Vec<Taken>, HashSet<String>) {
    importers_folded(root, layers, &fold(layers), asked)
}

fn importers_folded(
    root: &str,
    layers: &[Layer],
    folded: &HashMap<&str, At>,
    asked: HashMap<String, HashMap<String, HashSet<usize>>>,
) -> (Vec<Taken>, HashSet<String>) {
    let mut wanted: Wanted = asked
        .into_iter()
        .map(|(file, names)| (file, names.into_iter().map(|(name, origins)| (name, origins.into_iter().map(|origin| (origin, false)).collect())).collect()))
        .collect();
    // Each `(file, name, origin)` followed, and whether only a type-only path reached it.
    let mut seen: HashMap<(String, String, usize), bool> = HashMap::new();
    for (file, names) in &wanted {
        for (name, origins) in names {
            seen.extend(origins.keys().map(|&origin| ((file.clone(), name.clone(), origin), false)));
        }
    }
    let mut found: HashMap<(usize, String, u32, String, String, String), Taken> = HashMap::new();
    let mut through = HashSet::new();
    while !wanted.is_empty() {
        let (uses, passed) = importers_of(root, layers, folded, &wanted);
        for one in uses {
            let site = (one.origin, one.taken.at.clone(), one.taken.line, one.taken.name.clone(), one.taken.key.clone(), one.local.clone());
            match found.entry(site) {
                std::collections::hash_map::Entry::Occupied(mut held) => held.get_mut().taken.r#type &= one.taken.r#type,
                std::collections::hash_map::Entry::Vacant(free) => {
                    free.insert(one);
                }
            }
        }
        wanted = HashMap::new();
        for (file, exported, origin, typed) in passed {
            let key = (file.clone(), exported.clone(), origin);
            let follow = match seen.get(&key) {
                None => true,
                Some(&held) => held && !typed,
            };
            if follow {
                seen.insert(key, typed);
                through.insert(file.clone());
                let held = wanted.entry(file).or_default().entry(exported).or_default().entry(origin).or_insert(typed);
                *held &= typed;
            }
        }
    }
    (found.into_values().collect(), through)
}

/// One step of `importers_from`: the uses of each wanted name out of its
/// file, and each `(file, name, origin, type_only)` a re-export passes one of
/// them on as.
fn importers_of(
    root: &str,
    layers: &[Layer],
    folded: &HashMap<&str, At>,
    wanted: &Wanted,
) -> (Vec<Taken>, Vec<(String, String, usize, bool)>) {
    let lands = |at: At| {
        let (stored, records) = (&layers[at.0].stored, &layers[at.0].records);
        records.targets_present[at.1] == 1
            && records.targets.range(at.1).any(|target| stored.optional(records.target_path.at(target)).is_some_and(|path| wanted.contains_key(path)))
    };
    let mut crossings: Vec<Crossing> = folded
        .iter()
        .filter(|&(_, &at)| lands(at))
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let paths = beside(root, crossings.iter().map(|crossing| crossing.file));
    let owners = owners(root, &paths);
    let parts: Vec<(Vec<Taken>, Vec<(String, String, usize, bool)>)> = crossings
        .par_iter()
        .map(|crossing| {
            let (mut found, mut passed) = (Vec::new(), Vec::new());
            let Some((layer, row)) = crossing.parse else { return (found, passed) };
            let (stored, records) = (&layers[crossing.at.0].stored, &layers[crossing.at.0].records);
            let resolved: Vec<Option<&str>> =
                records.targets.range(crossing.at.1).map(|target| stored.optional(records.target_path.at(target))).collect();
            let (text, parses) = (&layers[layer].stored, &layers[layer].parses);
            // A record whose targets do not line up with the parse's requests answers none of them.
            if resolved.len() != parses.requests.range(row).len() { return (found, passed); }
            let first = parses.requests.at(row) as usize;
            let by = owners.package_of(crossing.file);
            let kind = kind_of(crossing.file);
            for request in parses.requests.range(row) {
                let Some(names) = resolved[request - first].and_then(|path| wanted.get(path)) else { continue };
                if parses.request_republishes[request] != 1 {
                    let written = text.text(parses.request_value.at(request));
                    for (mut taken, local) in taken(&layers[layer], row, request, written, by, crossing.file, kind) {
                        // A module that escapes whole may be read for any name wanted out of it.
                        let asked: Vec<(&String, &HashMap<usize, bool>)> =
                            if taken.whole { names.iter().collect() } else { names.get_key_value(&taken.name).into_iter().collect() };
                        let written_type = taken.r#type;
                        for (name, origins) in asked {
                            taken.name.clone_from(name);
                            for (&origin, &typed) in origins {
                                taken.r#type = written_type || typed;
                                found.push(Taken { origin, taken: taken.clone(), local: local.to_owned() });
                            }
                        }
                    }
                    continue;
                }
                let every = |type_only: bool| {
                    names.iter().filter(|(name, _)| *name != "default").flat_map(move |(name, origins)| {
                        origins.iter().map(move |(&origin, &typed)| (crossing.file.to_owned(), name.clone(), origin, typed || type_only))
                    })
                };
                match passed_on(&layers[layer], row, request) {
                    // An export list the parse never recorded reads as the whole
                    // module, and as types when the whole statement says `export type`.
                    None => passed.extend(every(text.text(parses.request_kind.at(request)) == "type")),
                    Some(listed) => {
                        for one in listed {
                            match (one.exported, names.get(one.imported)) {
                                (None, _) if one.imported == "*" => passed.extend(every(one.type_only)),
                                // `export * as ns` passes a namespace: the name is a member read off it.
                                (Some(_), _) if one.imported == "*" => {}
                                (Some(exported), Some(origins)) => passed.extend(
                                    origins.iter().map(|(&origin, &typed)| (crossing.file.to_owned(), exported.to_owned(), origin, typed || one.type_only)),
                                ),
                                _ => {}
                            }
                        }
                    }
                }
            }
            (found, passed)
        })
        .collect();
    let (mut found, mut passed) = (Vec::new(), Vec::new());
    for (uses, passes) in parts {
        found.extend(uses);
        passed.extend(passes);
    }
    (found, passed)
}

#[cfg(test)]
#[path = "help_usage_tests.rs"]
mod tests;
