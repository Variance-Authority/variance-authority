//! A catalogue made from the owners, the requests the sites file holds now, and the resolver.
//!
//! Every pair is resolved again; an entry whose resolution and digested sources are where the last catalogue
//! left them is carried from it rather than read. Pairs that resolve to one install share it, and its offers are
//! every specifier its manifest opens and every one a pair imports.

// compass: variance-authority.reach.relations

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::Path;
use std::sync::{Arc, OnceLock};

use dashmap::DashMap;
use rayon::prelude::*;

use super::catalogue::{Catalogue, Made, MadeInstall, MadePair};
use super::codec::{api as encoded, read_api};
use super::sites::State;
use super::{entry, relative, stamps, wanted, Api, Owner};
use crate::resolve::{Resolvers, Tsconfig};

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

/// The subpaths an installed manifest names one by one. A pattern such as `./*` opens every file under it, which
/// is a permission and not an API surface, so it is never enumerated: a specifier through it is read when a
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

/// One pair's reading: its install, issues, and each specifier with whether the install opens it, its entry
/// id, its reading and whether that was carried.
type Read = (String, Vec<String>, Vec<(String, bool, String, Api, bool)>);

/// The catalogue, how many of its entries were carried, and how many resolved to no entrypoint.
pub(super) fn made(root: &Path, owners: Vec<Owner>, manifests: Vec<String>, internal: Vec<String>, sites: Option<&State>,
    prior: Option<&Catalogue>, tsconfig: Tsconfig) -> (Made, u32, u32) {
    let wanted = wanted::of(&owners, sites);
    // The last catalogue's reading of each (owner manifest, specifier).
    let prior_owners = prior.map(Catalogue::owners).unwrap_or_default();
    let mut prior_entries = HashMap::<(&str, &str), u32>::new();
    if let Some(prior) = prior {
        for pair in 0..prior.pairs() {
            let (owner, _, install) = prior.pair(pair);
            for (specifier, entry, _) in prior.offers(install as usize) {
                prior_entries.entry((prior_owners[owner as usize].manifest.as_str(), specifier)).or_insert(entry);
            }
        }
    }
    let owner_rows: HashMap<&str, u32> = owners.iter().enumerate().map(|(at, owner)| (owner.manifest.as_str(), at as u32)).collect();
    let owner_of = |manifest: &str| &owners[owner_rows[manifest] as usize];
    let resolver = Resolvers::new(tsconfig, Some(vec!["types".to_owned(), "import".to_owned(), "default".to_owned()]));
    let parsed = DashMap::<String, Arc<OnceLock<(Api, bool)>>>::new();
    let importer_of = |manifest: &str| root.join(&owner_of(manifest).directory).join("__variance_dependency__.ts");
    let resolve = |manifest: &str, package: &str| {
        let importer = importer_of(manifest);
        resolver.resolution(&importer, package).or_else(|| resolver.declaration_resolution(&importer, package))
    };
    let pairs: Vec<_> = wanted.iter().collect();
    let keys: Vec<String> = pairs.par_iter().map(|((manifest, package), _)| wanted::install_key(manifest, resolve(manifest, package).as_ref())).collect();
    // Pairs that resolve to one install share a reading, and the one they share is read from the first of them in
    // key order, so which owner's neighbours (`@types/react` beside one, another copy beside the next) a reading
    // names does not depend on which thread got there first.
    let mut home = HashMap::<&str, &str>::new();
    for (((manifest, _), _), key) in pairs.iter().zip(&keys) { home.entry(key.as_str()).or_insert(manifest.as_str()); }
    let read: Vec<Read> = pairs.par_iter().zip(keys.par_iter()).map(|(((manifest, package), imported), key)| {
        let importer = importer_of(manifest);
        let shared = importer_of(home[key.as_str()]);
        let mut issues = Vec::new();
        let opened = resolve(manifest, package).as_ref().and_then(|answer| answer.package_json())
            .and_then(|package_json| fs::read(package_json.path()).ok())
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .map(|value| openings(package, &value));
        let opened = opened.unwrap_or_else(|| {
            issues.push(format!("the project resolver could not locate `{package}` from {}", relative(root, &importer)));
            BTreeSet::from([package.clone()])
        });
        let offered: BTreeSet<&String> = opened.iter().chain(*imported).collect();
        let offers = offered.into_iter().map(|specifier| {
            let held = prior_entries.get(&(manifest.as_str(), specifier.as_str())).and_then(|&entry| prior.and_then(|prior| read_api(prior.entry_blob(entry as usize))));
            let cell = parsed.entry(format!("{key}\0{specifier}")).or_insert_with(|| Arc::new(OnceLock::new())).clone();
            let (api, reused) = cell.get_or_init(|| entry::api(root, &shared, specifier, &resolver, held.as_ref())).clone();
            let id = format!("{}\0{}", api.runtime.as_ref().or(api.declarations.as_ref())
                .map_or_else(|| format!("unresolved:{manifest}"), |identity| identity.manifest.clone()),
                api.entrypoint.as_deref().unwrap_or(specifier));
            (specifier.clone(), opened.contains(specifier), id, api, reused)
        }).collect();
        issues.sort();
        issues.dedup();
        (key.clone(), issues, offers)
    }).collect();

    // Specifiers that resolve to one entrypoint share an id, and the first one's reading is kept.
    let mut entries = BTreeMap::<String, (Api, bool)>::new();
    let mut installs = BTreeMap::<&str, (&str, BTreeMap<String, (String, bool)>)>::new();
    for (((_, package), _), (key, _, offers)) in pairs.iter().zip(&read) {
        let install = installs.entry(key.as_str()).or_insert((package.as_str(), BTreeMap::new()));
        for (specifier, opened, id, api, reused) in offers {
            entries.entry(id.clone()).or_insert_with(|| (api.clone(), *reused));
            install.1.entry(specifier.clone()).and_modify(|held| held.1 |= opened).or_insert((id.clone(), *opened));
        }
    }
    let entry_rows: HashMap<&str, u32> = entries.keys().enumerate().map(|(at, id)| (id.as_str(), at as u32)).collect();
    let install_rows: HashMap<&str, u32> = installs.keys().enumerate().map(|(at, key)| (*key, at as u32)).collect();
    let made_pairs: Vec<MadePair> = pairs.iter().zip(&read).map(|(((manifest, package), _), (key, issues, _))| MadePair {
        owner: owner_rows[manifest.as_str()], package: package.clone(), install: install_rows[key.as_str()], issues: issues.clone(),
    }).collect();
    let made_installs: Vec<MadeInstall> = installs.iter().map(|(key, (package, offers))| MadeInstall {
        key: (*key).to_owned(), package: (*package).to_owned(),
        offers: offers.iter().map(|(specifier, (id, opened))| (specifier.clone(), entry_rows[id.as_str()], *opened)).collect(),
    }).collect();
    let apis: Vec<&Api> = entries.values().map(|(api, _)| api).collect();
    let stamps = stamps::of(root, &apis, &owners, &manifests);
    let reused = entries.values().filter(|(_, reused)| *reused).count() as u32;
    let unresolved = apis.iter().filter(|api| api.entrypoint.is_none()).count() as u32;
    let issues = made_pairs.iter().map(|pair| pair.issues.len()).sum::<usize>() as u32;
    let summary = [made_pairs.len() as u32, entries.len() as u32, apis.iter().filter(|api| api.entrypoint.is_some()).count() as u32,
        apis.iter().filter(|api| api.unavailable.is_some()).count() as u32 + issues];
    let made = Made {
        entries: entries.iter().map(|(id, (api, _))| (id.clone(), encoded(api))).collect(),
        owners, manifests, internal, pairs: made_pairs, installs: made_installs, stamps, summary,
    };
    (made, reused, unresolved)
}
