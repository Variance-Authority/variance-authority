//! Installed third-party public names, indexed on the native side of the boundary.
//!
//! The source index owns observed requests. Manifests own install intent, and
//! the resolver owns availability. This corpus has its own file and cadence:
//! unchanged declaration graphs are retained when the source index moves.
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::{fs, path::{Path, PathBuf}};
use std::sync::{Arc, OnceLock};
use dashmap::DashMap;
use napi_derive::napi;
use oxc_allocator::Allocator;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use crate::read::read_module;
use crate::resolve::Resolvers;
#[path = "dependency_lexicon_boundary.rs"] mod boundary;
#[path = "dependency_lexicon_built.rs"] mod built;
#[path = "dependency_lexicon_clean.rs"] mod clean;
#[path = "dependency_lexicon_merge.rs"] mod merge;
#[path = "dependency_lexicon_wanted.rs"] mod wanted;
#[path = "dependency_lexicon_query.rs"]
mod query;
#[path = "dependency_stack.rs"]
mod stack;
#[path = "dependency_described.rs"]
mod describing;
#[path = "dependency_purpose.rs"]
mod purposes;
use purposes::{purpose, Purpose};
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Identity { name: String, version: String, manifest: String }
#[derive(Clone, Serialize, Deserialize)]
struct Name {
    name: String,
    kind: String,
    at: String,
    line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    doc: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Source { at: String, digest: String }
/// The `README.md` beside an installed package's manifest: where it is and how long, or why it did not read.
#[derive(Clone, Serialize, Deserialize)]
struct Readme {
    at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    lines: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unreadable: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Api {
    #[serde(skip_serializing_if = "Option::is_none")]
    runtime: Option<Identity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    declarations: Option<Identity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    entrypoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    names: Option<Vec<Name>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sources: Option<Vec<Source>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unavailable: Option<String>,
    /// Only on an unavailable entry: the package's own prose may be all it ships.
    #[serde(skip_serializing_if = "Option::is_none")]
    readme: Option<Readme>,
    /// What the package says it is for, read from the installed package at refresh.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    purpose: Option<Purpose>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Entry { id: String, api: Api }
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Availability {
    owner: String,
    package: String,
    specifier: String,
    entry: String,
    declared: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    imported: Option<bool>,
    /// How the owning manifest declares it: `dependency`, `optional`, `peer` or `dev`; absent when it does not.
    #[serde(skip_serializing_if = "Option::is_none")]
    declared_as: Option<String>,
    /// Written requests for this specifier under the owner; absent when no source index was read.
    #[serde(skip_serializing_if = "Option::is_none")]
    imports: Option<u32>,
    /// The first of them by path, as `file:line`; absent when none was written.
    #[serde(skip_serializing_if = "Option::is_none")]
    site: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct Issue { owner: String, package: String, reason: String }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Lexicon {
    version: u8,
    refreshed_at: String,
    entries: Vec<Entry>,
    availability: Vec<Availability>,
    issues: Vec<Issue>,
}
#[derive(Clone)]
struct Owner { manifest: String, directory: String, name: String, declared: BTreeSet<String>, kinds: BTreeMap<String, &'static str> }

#[derive(Default)]
struct Wanted { declared: bool, imported: BTreeSet<String>, requests: BTreeMap<String, (u32, String, u32)> }

#[napi(object)]
pub struct LexiconRefresh {
    pub path: String,
    pub packages: u32,
    pub entrypoints: u32,
    pub reused: u32,
    pub unavailable: u32,
    /// Entries that resolved to no entrypoint; absent when nothing was read to count them.
    pub unresolved: Option<u32>,
    /// True when the chain and the installed files were where the last refresh left them, and nothing was read.
    pub unchanged: bool,
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

fn digest(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    Some(format!("{:x}", Sha256::digest(bytes)))
}

fn identity(root: &Path, resolution: &oxc_resolver::Resolution) -> Option<Identity> {
    let path = resolution.package_json()?.path();
    let value: serde_json::Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    Some(Identity {
        name: value.get("name")?.as_str()?.to_owned(),
        version: value.get("version")?.as_str()?.to_owned(),
        manifest: relative(root, path),
    })
}

/// The README beside the runtime package's manifest — named by the resolver's answer, not found by a walk.
fn readme(root: &Path, runtime: &Option<Identity>) -> Option<Readme> {
    let manifest = root.join(&runtime.as_ref()?.manifest);
    let path = manifest.parent()?.join("README.md");
    if !path.exists() { return None; }
    let at = relative(root, &path);
    Some(match fs::read_to_string(&path) {
        Ok(text) => Readme { at, lines: Some(text.lines().count() as u32), unreadable: None },
        Err(error) => Readme { at, lines: None, unreadable: Some(error.to_string()) },
    })
}

/// Version 5 added `readme`, 7 added `purpose`. An older one still answers queries; a refresh rewrites it.
const VERSION: u8 = 7;

fn previous(path: &Path) -> Option<Lexicon> {
    let prior: Lexicon = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if prior.version != VERSION { return None; }
    Some(prior)
}

fn unchanged(root: &Path, prior: &Api, runtime: &Option<Identity>, declarations: &Option<Identity>, at: &str) -> bool {
    prior.entrypoint.as_deref() == Some(at) && &prior.runtime == runtime && &prior.declarations == declarations
        && prior.sources.as_ref().is_some_and(|sources| sources.iter().all(|source|
            digest(&root.join(&source.at)).as_deref() == Some(source.digest.as_str())))
}

/// The row a pair states for one specifier: what the checkout writes for it, and the entry it resolves to.
fn availability(owner: &Owner, package: &str, wanted: &Wanted, specifier: &str, entry: String, indexed: bool) -> Availability {
    Availability { owner: owner.manifest.clone(), package: package.to_owned(), specifier: specifier.to_owned(), entry, declared: wanted.declared,
        imported: indexed.then(|| wanted.imported.contains(specifier)), declared_as: owner.kinds.get(package).map(|kind| (*kind).to_owned()),
        imports: indexed.then(|| wanted.requests.get(specifier).map_or(0, |request| request.0)),
        site: wanted.requests.get(specifier).map(|request| format!("{}:{}", request.1, request.2)) }
}

fn targets(value: &serde_json::Value, into: &mut Vec<String>) {
    match value {
        serde_json::Value::String(value) => into.push(value.clone()),
        serde_json::Value::Array(values) => values.iter().for_each(|value| targets(value, into)),
        serde_json::Value::Object(values) => values.values().for_each(|value| targets(value, into)),
        _ => {}
    }
}

fn code_opening(opening: &str) -> bool {
    let last = opening.rsplit('/').next().unwrap_or("");
    let lower = last.to_ascii_lowercase();
    if lower == "package.json" || lower.starts_with("readme") || lower.starts_with("license") { return false; }
    let extension = last.rsplit_once('.').map_or("", |(_, extension)| extension);
    extension.is_empty() || ["js", "mjs", "cjs", "ts", "mts", "cts", "tsx", "jsx"].contains(&extension)
}

/// The subpaths an installed manifest names one by one. A pattern such as
/// `./*` opens every file under it, which is a permission and not an API
/// surface, so it is never enumerated: a specifier through it is read when a
/// source file imports it, and not before.
fn openings(package: &str, manifest: &serde_json::Value) -> BTreeSet<String> {
    let Some(exports) = manifest.get("exports") else { return BTreeSet::from([package.to_owned()]) };
    let paths: Vec<(&str, &serde_json::Value)> = match exports.as_object() {
        Some(map) if map.keys().any(|key| key.starts_with('.')) =>
            map.iter().filter(|(key, _)| key.starts_with('.')).map(|(key, value)| (key.as_str(), value)).collect(),
        _ => vec![(".", exports)],
    };
    let mut specifiers = BTreeSet::new();
    for (opening, value) in paths {
        if opening.contains('*') || !code_opening(opening) { continue; }
        let mut offered = Vec::new();
        targets(value, &mut offered);
        if offered.is_empty() { continue; }
        specifiers.insert(if opening == "." { package.to_owned() } else { format!("{package}/{}", opening.trim_start_matches("./")) });
    }
    specifiers
}

struct Reader<'a> {
    root: &'a Path, package: Option<PathBuf>,
    resolver: &'a Resolvers,
    cache: HashMap<PathBuf, Vec<Name>>,
    stack: HashSet<PathBuf>,
    sources: BTreeSet<PathBuf>,
}

impl Reader<'_> {
    fn names(&mut self, file: &Path) -> Vec<Name> {
        if let Some(found) = self.cache.get(file) { return found.clone(); }
        if !self.stack.insert(file.to_owned()) { return Vec::new(); }
        let found = self.read(file);
        self.stack.remove(file);
        self.cache.insert(file.to_owned(), found.clone());
        found
    }

    fn read(&mut self, file: &Path) -> Vec<Name> {
        let Ok(source) = fs::read_to_string(file) else { return Vec::new() };
        self.sources.insert(file.to_owned());
        let parsed = read_module(&file.to_string_lossy(), &source, &Allocator::default(), true);
        if parsed.unknown.is_some() { return Vec::new(); }
        let utf16: Vec<u16> = source.encode_utf16().collect();
        let mut names = BTreeMap::<(String, String), Name>::new();
        let mut imports = HashMap::<String, (String, String)>::new();
        for request in &parsed.requests {
            for binding in &request.bindings {
                imports.insert(binding.local.clone(), (request.value.clone(), binding.imported.clone()));
            }
        }
        for export in &parsed.exports {
            let Some(public) = &export.exported else {
                if let Some(from) = &export.from {
                    if let Some(target) = self.target(file, from) {
                        for name in self.names(&target).into_iter().filter(|name| name.name != "default") {
                            names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                        }
                    }
                }
                continue;
            };
            if let Some(from) = &export.from {
                if export.imported.as_deref() == Some("*") {
                    let name = Name { name: public.clone(), kind: "namespace".to_owned(),
                        at: relative(self.root, file), line: export.line,
                        signature: crate::dependency_namespace::text(&utf16, export.signature),
                        doc: crate::dependency_namespace::doc(&utf16, export.doc) };
                    names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                    continue;
                }
                if let Some(target) = self.target(file, from) {
                    for mut name in self.names(&target).into_iter().filter(|name|
                        name.name == export.imported.as_deref().unwrap_or(public)) {
                        name.name = public.clone();
                        names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                    }
                }
                continue;
            }
            let local = export.local.as_deref().unwrap_or(public);
            let matched: Vec<_> = parsed.symbols.iter().filter(|symbol| symbol.name == local).collect();
            if !matched.is_empty() {
                for symbol in matched {
                    let name = Name { name: public.clone(), kind: symbol.kind.to_owned(),
                        at: relative(self.root, file), line: symbol.line,
                        signature: crate::dependency_namespace::text(&utf16, symbol.signature),
                        doc: crate::dependency_namespace::doc(&utf16, symbol.doc.or(export.doc)) };
                    names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                }
            } else if let Some((request, imported)) = imports.get(local) {
                if let Some(target) = self.target(file, request) {
                    for mut name in self.names(&target).into_iter().filter(|name| &name.name == imported) {
                        name.name = public.clone();
                        names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                    }
                }
            } else {
                let name = Name { name: public.clone(), kind: "export".to_owned(),
                    at: relative(self.root, file), line: export.line,
                    signature: crate::dependency_namespace::text(&utf16, export.signature),
                    doc: crate::dependency_namespace::doc(&utf16, export.doc) };
                names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
            }
        }
        if names.is_empty() && source.contains("export =") {
            for symbol in crate::dependency_namespace::exported_namespace(&file.to_string_lossy(), &source) {
                let name = Name { name: symbol.name, kind: symbol.kind,
                    at: relative(self.root, file), line: symbol.line,
                    signature: symbol.signature, doc: symbol.doc };
                names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
            }
            if names.is_empty() {
                for request in crate::dependency_namespace::exported_import(&source) {
                    if let Some(target) = self.target(file, &request) {
                        for name in self.names(&target) {
                            names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                        }
                    }
                }
            }
        }
        names.into_values().collect()
    }

    fn target(&mut self, from: &Path, specifier: &str) -> Option<PathBuf> {
        let answer = self.resolver.declaration_resolution(from, specifier)?;
        if !boundary::permits(self.package.as_deref(), answer.package_json().map(|manifest| manifest.path()), answer.path(), specifier) { return None; }
        if let Some(manifest) = answer.package_json() { self.sources.insert(manifest.path().to_owned()); }
        Some(answer.path().to_owned())
    }
}
fn api(root: &Path, importer: &Path, specifier: &str, resolver: &Resolvers, previous: Option<&Api>) -> (Api, bool) {
    let runtime_resolution = resolver.resolution(importer, specifier);
    let declaration_resolution = resolver.declaration_resolution(importer, specifier);
    let runtime = runtime_resolution.as_ref().and_then(|resolution| identity(root, resolution));
    let declarations = declaration_resolution.as_ref().and_then(|resolution| identity(root, resolution));
    let Some(declaration) = declaration_resolution else {
        let reason = if runtime_resolution.is_some() {
            format!("the project resolver found no declarations for `{specifier}` from {}", relative(root, importer))
        } else {
            format!("the project resolver could not resolve `{specifier}` from {}", relative(root, importer))
        };
        let readme = readme(root, &runtime);
        let purpose = purpose(root, &runtime, &declarations, None);
        return (Api { runtime, declarations, entrypoint: None, names: None, sources: None, unavailable: Some(reason), readme, purpose }, false);
    };
    let entrypoint = relative(root, declaration.path());
    if let Some(prior) = previous.filter(|prior| unchanged(root, prior, &runtime, &declarations, &entrypoint)) {
        // A README is not among the digested sources, so an entry that publishes no names reads it again.
        let readme = prior.unavailable.is_some().then(|| readme(root, &runtime)).flatten();
        // Nor is it: the words a package says about itself are read again, so a README edit reaches the next refresh.
        let purpose = purpose(root, &runtime, &declarations, prior.names.as_deref());
        return (Api { readme, purpose, ..prior.clone() }, true);
    }
    let mut reader = Reader { root, package: declaration.package_json().map(|manifest| manifest.path().to_owned()), resolver, cache: HashMap::new(), stack: HashSet::new(), sources: BTreeSet::new() };
    if let Some(resolution) = runtime_resolution.as_ref() {
        if let Some(manifest) = resolution.package_json() { reader.sources.insert(manifest.path().to_owned()); }
    }
    if let Some(manifest) = declaration.package_json() { reader.sources.insert(manifest.path().to_owned()); }
    let names = reader.names(declaration.path());
    let sources = reader.sources.iter().filter_map(|path|
        Some(Source { at: relative(root, path), digest: digest(path)? })).collect();
    let unavailable = names.is_empty().then(|| format!("the declarations for `{specifier}` publish no names this reader can enumerate"));
    let readme = unavailable.is_some().then(|| readme(root, &runtime)).flatten();
    let purpose = purpose(root, &runtime, &declarations, Some(&names));
    (Api { runtime, declarations, entrypoint: Some(entrypoint), names: Some(names), sources: Some(sources), unavailable, readme, purpose }, false)
}

/// Refresh the complete installed lexicon from Git, the source index and the
/// package manager's resolver. No per-dependency object crosses N-API.
#[napi(catch_unwind)]
pub fn refresh_dependency_lexicon(root: String, index: String, path: String, refreshed_at: String) -> napi::Result<LexiconRefresh> {
    let root_path = Path::new(&root);
    let lexicon_path = Path::new(&path);
    // Read before anything else, so a chain that moves during the refresh is never recorded as the one it read.
    let chain = crate::index_chain::manifest_digests(&index);
    let held = built::read(lexicon_path, VERSION);
    if let (Some(held), Some(chain)) = (held.as_ref(), chain.as_ref()) {
        if built::holds(root_path, held, chain) {
            return Ok(LexiconRefresh { path, packages: held.packages, entrypoints: held.entrypoints, reused: held.reusable, unavailable: held.unavailable, unresolved: None, unchanged: true });
        }
    }
    let has_index = Path::new(&index).exists();
    let planned = held.as_ref().zip(chain.as_ref()).and_then(|(held, chain)| merge::plan(&root, &index, lexicon_path, chain, held));
    let (owners, sites, internal_names, changed, listed_manifests) = match planned {
        Some(plan) => (plan.owners, plan.files, plan.internal, Some(plan.changed), plan.manifests),
        None => {
            let (owners, sites, internal_names) = wanted::full(&root, &index, has_index)?;
            (owners, sites, internal_names, None, merge::manifests(&root).unwrap_or_default())
        }
    };
    let wanted = wanted::of(&owners, &sites);
    let prior = previous(Path::new(&path));
    let prior_entries: HashMap<&str, &Api> = prior.as_ref().into_iter()
        .flat_map(|prior| prior.entries.iter().map(|entry| (entry.id.as_str(), &entry.api))).collect();
    let prior_availability: HashMap<(&str, &str), &str> = prior.as_ref().into_iter()
        .flat_map(|prior| prior.availability.iter().map(|entry|
            ((entry.owner.as_str(), entry.specifier.as_str()), entry.entry.as_str()))).collect();
    let carried = prior.as_ref().zip(changed.as_ref()).map(|(prior, changed)| clean::Prior::new(prior, changed));
    let owner_by_manifest: HashMap<&str, &Owner> = owners.iter().map(|owner| (owner.manifest.as_str(), owner)).collect();
    let resolver = Resolvers::new(None, Some(vec!["types".to_owned(), "import".to_owned(), "default".to_owned()]));
    let parsed = DashMap::<String, Arc<OnceLock<(Api, bool)>>>::new();
    let importer_of = |manifest: &str| root_path.join(&owner_by_manifest[manifest].directory).join("__variance_dependency__.ts");
    let resolve = |manifest: &str, package: &str| {
        let importer = importer_of(manifest);
        resolver.resolution(&importer, package).or_else(|| resolver.declaration_resolution(&importer, package))
    };
    // Pairs that resolve to one install share a reading, and the one they share is read from the first of them in
    // key order, so which owner's neighbours (`@types/react` beside one, another copy beside the next) a
    // reading names does not depend on which thread got there first.
    let staged: Vec<_> = wanted.par_iter().map(|((manifest, package), wanted)| {
        let owner = owner_by_manifest[manifest.as_str()];
        match carried.as_ref().and_then(|carried| carried.clean(owner, package, wanted)) {
            Some(kept) => Ok(kept),
            None => Err(wanted::install_key(manifest, resolve(manifest, package).as_ref())),
        }
    }).collect();
    let mut home = HashMap::<&str, &str>::new();
    for (((manifest, _), _), stage) in wanted.iter().zip(&staged) {
        if let Err(key) = stage { home.entry(key.as_str()).or_insert(manifest.as_str()); }
    }
    let pairs: Vec<_> = wanted.iter().collect();
    let rows: Vec<_> = pairs.par_iter().zip(staged.par_iter()).map(|(((manifest, package), wanted), stage)| {
        let owner = owner_by_manifest[manifest.as_str()];
        let installed_key = match stage {
            Ok((outputs, issues)) => return (manifest.clone(), package.clone(), outputs.clone(), issues.clone()),
            Err(key) => key,
        };
        let importer = importer_of(manifest);
        let shared = importer_of(home[installed_key.as_str()]);
        let resolution = resolve(manifest, package);
        let mut issues = Vec::new();
        let (mut offered, installed) = match resolution.as_ref().and_then(|answer| answer.package_json()) {
            Some(package_json) => {
                let manifest_path = package_json.path();
                match fs::read(manifest_path).ok().and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok()) {
                    Some(value) => (openings(package, &value), true),
                    None => (BTreeSet::new(), false),
                }
            }
            None => (BTreeSet::new(), false),
        };
        if !installed {
            offered.insert(package.clone());
            issues.push(format!("the project resolver could not locate `{package}` from {}", relative(root_path, &importer)));
        }
        offered.extend(wanted.imported.iter().cloned());
        let mut outputs = Vec::new();
        for specifier in offered {
            let prior = prior_availability.get(&(manifest.as_str(), specifier.as_str()))
                .and_then(|id| prior_entries.get(id).copied());
            let cell = parsed.entry(format!("{installed_key}\0{specifier}"))
                .or_insert_with(|| Arc::new(OnceLock::new())).clone();
            let (api, reused) = cell.get_or_init(|| api(root_path, &shared, &specifier, &resolver, prior)).clone();
            let id = format!("{}\0{}", api.runtime.as_ref().or(api.declarations.as_ref())
                .map_or_else(|| format!("unresolved:{manifest}"), |identity| identity.manifest.clone()),
                api.entrypoint.as_deref().unwrap_or(&specifier));
            outputs.push((availability(owner, package, wanted, &specifier, id.clone(), has_index), Entry { id, api }, reused));
        }
        (manifest.clone(), package.clone(), outputs, issues)
    }).collect();

    let mut entries = BTreeMap::<String, Entry>::new();
    let mut availability = Vec::new();
    let mut issues = Vec::new();
    let mut reused = 0;
    for (owner, package, outputs, problems) in rows {
        for (row, entry, retained) in outputs {
            // Specifiers that resolve to one entrypoint share an id. The first row's reading is kept, so the next
            // refresh compares that row with itself: the last one's runtime identity can differ and would fail `unchanged`.
            if !entries.contains_key(&entry.id) {
                if retained { reused += 1; }
                entries.insert(entry.id.clone(), entry);
            }
            availability.push(row);
        }
        issues.extend(problems.into_iter().map(|reason| Issue { owner: owner.clone(), package: package.clone(), reason }));
    }
    availability.sort_by(|a, b| (a.owner.as_str(), a.specifier.as_str()).cmp(&(b.owner.as_str(), b.specifier.as_str())));
    issues.sort_by(|a, b| (&a.owner, &a.package, &a.reason).cmp(&(&b.owner, &b.package, &b.reason)));
    issues.dedup_by(|a, b| a.owner == b.owner && a.package == b.package && a.reason == b.reason);
    let corpus = Lexicon { version: VERSION, refreshed_at, entries: entries.into_values().collect(), availability, issues };
    let path_ref = Path::new(&path);
    let _ = fs::remove_file(built::file(path_ref));
    let _ = fs::remove_file(merge::file(path_ref));
    let bytes = serde_json::to_vec(&corpus).map_err(|error| napi::Error::from_reason(error.to_string()))?;
    merge::publish(path_ref, bytes).map_err(|error| napi::Error::from_reason(error.to_string()))?;
    let unavailable = corpus.entries.iter().filter(|entry| entry.api.unavailable.is_some()).count() as u32 + corpus.issues.len() as u32;
    if let Some(chain) = chain {
        let record = built::record(root_path, path_ref, chain.clone(), VERSION, &corpus.entries, &owners, &listed_manifests, held.as_ref().filter(|_| carried.is_some()), wanted.len() as u32, unavailable);
        let bytes = serde_json::to_vec(&record).map_err(|error| napi::Error::from_reason(error.to_string()))?;
        if has_index {
            merge::write(path_ref, &chain, listed_manifests, &owners, internal_names, sites).map_err(|error| napi::Error::from_reason(error.to_string()))?;
        }
        fs::write(built::file(path_ref), bytes).map_err(|error| napi::Error::from_reason(error.to_string()))?;
    }
    Ok(LexiconRefresh { path, packages: wanted.len() as u32, entrypoints: corpus.entries.len() as u32, reused, unavailable, unresolved: Some(corpus.entries.iter().filter(|entry| entry.api.entrypoint.is_none()).count() as u32), unchanged: false })
}
