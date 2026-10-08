//! Installed third-party public names, indexed on the native side of the boundary.
//!
//! The source index owns observed requests. Manifests own install intent, and
//! the resolver owns availability. This corpus has its own file and cadence:
//! unchanged declaration graphs are retained when the source index moves.
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::{fs, path::Path};
use std::sync::{Arc, OnceLock};
use dashmap::DashMap;
use napi_derive::napi;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use crate::resolve::Resolvers;
#[path = "dependency_lexicon_boundary.rs"] mod boundary;
#[path = "dependency_lexicon_built.rs"] mod built;
#[path = "dependency_lexicon_clean.rs"] mod clean;
#[path = "dependency_lexicon_entry.rs"] mod entry;
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
use purposes::Purpose;
#[path = "dependency_skills.rs"]
mod skilled;
use skilled::Skill;
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
    /// The agent skills the package ships in `skills/`, read from the installed package at refresh.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    skills: Option<Vec<Skill>>,
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

/// Version 5 added `readme`, 7 added `purpose`, 8 reads `export =` from the tree, 9 added `skills`. An older one still answers queries; a refresh rewrites it.
const VERSION: u8 = 9;
/// The first version that read skills; an older lexicon answers with them unread, not absent.
const SKILLS: u8 = 9;

fn previous(path: &Path) -> Option<Lexicon> {
    let prior: Lexicon = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if prior.version != VERSION { return None; }
    Some(prior)
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

/// Refresh the complete installed lexicon from Git, the source index and the
/// package manager's resolver. No per-dependency object crosses N-API.
#[napi(ts_return_type = "Promise<LexiconRefresh>")]
pub fn refresh_dependency_lexicon(root: String, index: String, path: String, refreshed_at: String) -> napi::bindgen_prelude::AsyncTask<crate::off_thread::OffThread<LexiconRefresh>> {
    crate::off_thread::off_thread(move || refresh(root, index, path, refreshed_at))
}

fn refresh(root: String, index: String, path: String, refreshed_at: String) -> napi::Result<LexiconRefresh> {
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
            let (api, reused) = cell.get_or_init(|| entry::api(root_path, &shared, &specifier, &resolver, prior)).clone();
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
