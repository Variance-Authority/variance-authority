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
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use crate::read::read_module;
use crate::resolve::Resolvers;
#[path = "dependency_lexicon_boundary.rs"] mod boundary;
#[path = "dependency_lexicon_query.rs"]
mod query;
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
}
#[derive(Serialize, Deserialize)]
struct Entry { id: String, api: Api }
#[derive(Serialize, Deserialize)]
struct Availability {
    owner: String,
    package: String,
    specifier: String,
    entry: String,
    declared: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    imported: Option<bool>,
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
struct Owner { manifest: String, directory: String, name: String, declared: BTreeSet<String> }

#[derive(Default)]
struct Wanted { declared: bool, imported: BTreeSet<String> }

#[napi(object)]
pub struct LexiconRefresh {
    pub path: String,
    pub packages: u32,
    pub entrypoints: u32,
    pub reused: u32,
    pub unavailable: u32,
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

fn previous(path: &Path) -> Option<Lexicon> {
    let prior: Lexicon = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if prior.version != 4 { return None; }
    Some(prior)
}

fn unchanged(root: &Path, prior: &Api, runtime: &Option<Identity>, declarations: &Option<Identity>, at: &str) -> bool {
    prior.entrypoint.as_deref() == Some(at) && &prior.runtime == runtime && &prior.declarations == declarations
        && prior.sources.as_ref().is_some_and(|sources| sources.iter().all(|source|
            digest(&root.join(&source.at)).as_deref() == Some(source.digest.as_str())))
}

fn workspace_patterns(value: &serde_json::Value) -> Vec<Regex> {
    let listed = value.get("workspaces").and_then(|value|
        value.as_array().or_else(|| value.get("packages").and_then(serde_json::Value::as_array)));
    listed.into_iter().flatten().filter_map(serde_json::Value::as_str).filter_map(|pattern| {
        let mut regex = String::from("^");
        let mut chars = pattern.chars().peekable();
        while let Some(ch) = chars.next() {
            match ch {
                '*' if chars.peek() == Some(&'*') => { chars.next(); regex.push_str(".*"); }
                '*' => regex.push_str("[^/]*"),
                '?' => regex.push_str("[^/]"),
                _ => regex.push_str(&regex::escape(&ch.to_string())),
            }
        }
        regex.push('$');
        Regex::new(&regex).ok()
    }).collect()
}

fn owners(root: &Path, paths: &[String]) -> Vec<Owner> {
    let root_value: serde_json::Value = fs::read(root.join("package.json")).ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or(serde_json::Value::Null);
    let patterns = workspace_patterns(&root_value);
    let mut found = Vec::new();
    for manifest in paths.iter().filter(|path| path == &"package.json" || path.ends_with("/package.json")) {
        let directory = manifest.strip_suffix("/package.json").unwrap_or("");
        if manifest != "package.json" && !patterns.iter().any(|pattern| pattern.is_match(directory)) { continue; }
        let value: serde_json::Value = match fs::read(root.join(manifest)).ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok()) { Some(value) => value, None => continue };
        let declared = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
            .into_iter().filter_map(|field| value.get(field).and_then(serde_json::Value::as_object))
            .flat_map(|map| map.keys().cloned()).collect();
        found.push(Owner { manifest: manifest.clone(), directory: directory.to_owned(),
            name: value.get("name").and_then(serde_json::Value::as_str).unwrap_or("").to_owned(), declared });
    }
    found.sort_by(|a, b| a.manifest.cmp(&b.manifest));
    found
}

fn owner_for<'a>(path: &str, owners: &'a [Owner]) -> Option<&'a Owner> {
    owners.iter().filter(|owner| owner.directory.is_empty() || path.starts_with(&format!("{}/", owner.directory)))
        .max_by_key(|owner| owner.directory.len())
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

fn descendants(directory: &Path) -> Vec<PathBuf> {
    let mut pending = vec![directory.to_owned()];
    let mut files = Vec::new();
    while let Some(current) = pending.pop() {
        let Ok(entries) = fs::read_dir(current) else { continue };
        for entry in entries.flatten() {
            if entry.file_type().is_ok_and(|kind| kind.is_symlink()) { continue; }
            let path = entry.path();
            if path.is_dir() && entry.file_name() != "node_modules" { pending.push(path); } else if path.is_file() { files.push(path); }
        }
    }
    files
}

fn openings(directory: &Path, package: &str, manifest: &serde_json::Value) -> (BTreeSet<String>, Vec<String>) {
    let Some(exports) = manifest.get("exports") else { return (BTreeSet::from([package.to_owned()]), Vec::new()) };
    let paths: Vec<(&str, &serde_json::Value)> = match exports.as_object() {
        Some(map) if map.keys().any(|key| key.starts_with('.')) =>
            map.iter().filter(|(key, _)| key.starts_with('.')).map(|(key, value)| (key.as_str(), value)).collect(),
        _ => vec![(".", exports)],
    };
    let mut specifiers = BTreeSet::new();
    let mut issues = Vec::new();
    let mut files: Option<Vec<PathBuf>> = None;
    for (opening, value) in paths {
        if !code_opening(opening) { continue; }
        let mut offered = Vec::new();
        targets(value, &mut offered);
        if offered.is_empty() { continue; }
        let mut concrete = BTreeSet::new();
        if !opening.contains('*') { concrete.insert(opening.to_owned()); }
        else if opening.matches('*').count() == 1 {
            for target in offered.iter().filter(|target| target.starts_with("./") && target.contains('*')) {
                let Some((before, after)) = target[2..].split_once('*') else { continue };
                let available = files.get_or_insert_with(|| descendants(directory));
                for path in available.iter() {
                    let at = relative(directory, path);
                    if let Some(part) = at.strip_prefix(before).and_then(|rest| rest.strip_suffix(after)) {
                        if !part.is_empty() {
                            let subpath = opening.replace('*', part);
                            if code_opening(&subpath) { concrete.insert(subpath); }
                        }
                    }
                }
                if !concrete.is_empty() { break; }
            }
        }
        if concrete.is_empty() { issues.push(format!("the installed exports map has an unexpanded subpath: {opening}")); }
        for subpath in concrete {
            specifiers.insert(if subpath == "." { package.to_owned() } else { format!("{package}/{}", subpath.trim_start_matches("./")) });
        }
    }
    (specifiers, issues)
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
        return (Api { runtime, declarations, entrypoint: None, names: None, sources: None, unavailable: Some(reason) }, false);
    };
    let entrypoint = relative(root, declaration.path());
    if let Some(prior) = previous.filter(|prior| unchanged(root, prior, &runtime, &declarations, &entrypoint)) {
        return (prior.clone(), true);
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
    (Api { runtime, declarations, entrypoint: Some(entrypoint), names: Some(names), sources: Some(sources), unavailable }, false)
}

/// Refresh the complete installed lexicon from Git, the source index and the
/// package manager's resolver. No per-dependency object crosses N-API.
#[napi(catch_unwind)]
pub fn refresh_dependency_lexicon(root: String, index: String, path: String, refreshed_at: String) -> napi::Result<LexiconRefresh> {
    let root_path = Path::new(&root);
    let Some(snapshot) = crate::git::snapshot(&root) else {
        return Err(napi::Error::from_reason(format!("git could not list the checkout at {root}")));
    };
    let owners = owners(root_path, &snapshot.paths);
    let internal: HashSet<&str> = owners.iter().map(|owner| owner.name.as_str()).collect();
    let mut wanted = BTreeMap::<(String, String), Wanted>::new();
    for owner in &owners {
        for package in owner.declared.iter().filter(|package| !internal.contains(package.as_str())) {
            wanted.insert((owner.manifest.clone(), package.clone()), Wanted { declared: true, ..Wanted::default() });
        }
    }

    // The source index is the owner's reading of requests. Its full Rust
    // orientation stays native here; only this corpus crosses the boundary.
    let has_index = Path::new(&index).exists();
    if has_index {
        let source_files: Vec<String> = snapshot.paths.iter().filter(|path|
            [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].iter().any(|suffix| path.ends_with(suffix)))
            .cloned().collect();
        if !source_files.is_empty() {
            let observed = crate::external_dependencies::external_dependencies(
                root.clone(), index, source_files, u32::MAX, u32::MAX,
            )?.ok_or_else(|| napi::Error::from_reason("the source index did not read"))?;
            if observed.more > 0 || observed.dependencies.iter().any(|dependency| dependency.more_sites > 0) {
                return Err(napi::Error::from_reason("the source index has more external requests than the lexicon reader can carry"));
            }
            for dependency in observed.dependencies {
                if internal.contains(dependency.package.as_str()) { continue; }
                for site in dependency.sites {
                    let Some(owner) = owner_for(&site.file, &owners) else { continue };
                    let held = wanted.entry((owner.manifest.clone(), dependency.package.clone())).or_default();
                    held.declared |= owner.declared.contains(&dependency.package);
                    held.imported.insert(site.specifier);
                }
            }
        }
    }

    let prior = previous(Path::new(&path));
    let prior_entries: HashMap<&str, &Api> = prior.as_ref().into_iter()
        .flat_map(|prior| prior.entries.iter().map(|entry| (entry.id.as_str(), &entry.api))).collect();
    let prior_availability: HashMap<(&str, &str), &str> = prior.as_ref().into_iter()
        .flat_map(|prior| prior.availability.iter().map(|entry|
            ((entry.owner.as_str(), entry.specifier.as_str()), entry.entry.as_str()))).collect();
    let owner_by_manifest: HashMap<&str, &Owner> = owners.iter().map(|owner| (owner.manifest.as_str(), owner)).collect();
    let resolver = Resolvers::new(None, Some(vec!["types".to_owned(), "import".to_owned(), "default".to_owned()]));
    let parsed = DashMap::<String, Arc<OnceLock<(Api, bool)>>>::new();
    let rows: Vec<_> = wanted.par_iter().map(|((manifest, package), wanted)| {
        let owner = owner_by_manifest[manifest.as_str()];
        let importer = root_path.join(&owner.directory).join("__variance_dependency__.ts");
        let resolution = resolver.resolution(&importer, package)
            .or_else(|| resolver.declaration_resolution(&importer, package));
        let mut issues = Vec::new();
        let (mut offered, installed) = match resolution.as_ref().and_then(|answer| answer.package_json()) {
            Some(package_json) => {
                let manifest_path = package_json.path();
                match fs::read(manifest_path).ok().and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok()) {
                    Some(value) => {
                        let (offered, problems) = openings(manifest_path.parent().unwrap_or(root_path), package, &value);
                        issues.extend(problems);
                        (offered, true)
                    }
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
        let installed_key = resolution.as_ref().and_then(|answer| answer.package_json())
            .map(|manifest| manifest.path().to_string_lossy().into_owned())
            .unwrap_or_else(|| format!("unresolved:{manifest}"));
        let mut outputs = Vec::new();
        for specifier in offered {
            let prior = prior_availability.get(&(manifest.as_str(), specifier.as_str()))
                .and_then(|id| prior_entries.get(id).copied());
            let cell = parsed.entry(format!("{installed_key}\0{specifier}"))
                .or_insert_with(|| Arc::new(OnceLock::new())).clone();
            let (api, reused) = cell.get_or_init(|| api(root_path, &importer, &specifier, &resolver, prior)).clone();
            let id = format!("{}\0{}", api.runtime.as_ref().or(api.declarations.as_ref())
                .map_or_else(|| format!("unresolved:{manifest}"), |identity| identity.manifest.clone()),
                api.entrypoint.as_deref().unwrap_or(&specifier));
            outputs.push((Availability { owner: manifest.clone(), package: package.clone(), specifier: specifier.clone(),
                entry: id.clone(), declared: wanted.declared,
                imported: has_index.then(|| wanted.imported.contains(&specifier)) }, Entry { id, api }, reused));
        }
        (manifest.clone(), package.clone(), outputs, issues)
    }).collect();

    let mut entries = BTreeMap::<String, Entry>::new();
    let mut availability = Vec::new();
    let mut issues = Vec::new();
    let mut reused = 0;
    for (owner, package, outputs, problems) in rows {
        for (row, entry, retained) in outputs {
            if entries.insert(entry.id.clone(), entry).is_none() && retained { reused += 1; }
            availability.push(row);
        }
        issues.extend(problems.into_iter().map(|reason| Issue { owner: owner.clone(), package: package.clone(), reason }));
    }
    availability.sort_by(|a, b| (a.owner.as_str(), a.specifier.as_str()).cmp(&(b.owner.as_str(), b.specifier.as_str())));
    issues.sort_by(|a, b| (&a.owner, &a.package, &a.reason).cmp(&(&b.owner, &b.package, &b.reason)));
    issues.dedup_by(|a, b| a.owner == b.owner && a.package == b.package && a.reason == b.reason);
    let corpus = Lexicon { version: 4, refreshed_at, entries: entries.into_values().collect(), availability, issues };
    let path_ref = Path::new(&path);
    if let Some(parent) = path_ref.parent() {
        fs::create_dir_all(parent).map_err(|error| napi::Error::from_reason(error.to_string()))?;
    }
    let temporary = path_ref.with_extension(format!("{}.tmp", std::process::id()));
    let bytes = serde_json::to_vec(&corpus).map_err(|error| napi::Error::from_reason(error.to_string()))?;
    fs::write(&temporary, bytes).map_err(|error| napi::Error::from_reason(error.to_string()))?;
    fs::rename(&temporary, path_ref).map_err(|error| napi::Error::from_reason(error.to_string()))?;
    Ok(LexiconRefresh { path, packages: wanted.len() as u32, entrypoints: corpus.entries.len() as u32,
        reused, unavailable: corpus.entries.iter().filter(|entry| entry.api.unavailable.is_some()).count() as u32 + corpus.issues.len() as u32 })
}
