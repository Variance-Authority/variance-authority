//! A catalogue made from the owners, the requests the sites file holds now, and the resolver.
//!
//! Every pair is resolved again; an entry whose resolution and digested sources are where the last catalogue
//! left them is carried from it rather than read. Pairs that resolve to one install share it, and its offers are
//! every specifier its manifest opens and every one a pair imports.

// compass: variance-authority.reach.relations

use std::collections::{BTreeMap, BTreeSet, HashMap};
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
type Read = (String, Vec<String>, Vec<(String, bool, String, Arc<Api>, bool)>);

/// The catalogue, how many of its entries were carried, and how many resolved to no entrypoint.
pub(super) fn made(root: &Path, owners: Vec<Owner>, manifests: Vec<String>, internal: Vec<String>, sites: Option<&State>,
    prior: Option<&Catalogue>, tsconfig: Tsconfig, listing: Option<Arc<crate::emitted::Listing>>, read_blobs: bool) -> (Made, u32, u32) {
    let mut phases = crate::timings::Phases::new("lexicon build", "wanted requests");
    let wanted = wanted::of(&owners, sites);
    phases.note(format_args!("owners={}, manifests={}, wanted pairs={}", owners.len(), manifests.len(), wanted.len()));
    phases.next("prior entries and resolver");
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
    let resolver = Resolvers::over(tsconfig, Some(vec!["types".to_owned(), "import".to_owned(), "default".to_owned()]), crate::emitted::Emitted::listed_for(root, listing, read_blobs));
    let parsed = DashMap::<String, Arc<OnceLock<(Arc<Api>, bool)>>>::new();
    let manifest_readings = entry::Readings::default();
    let importer_of = |manifest: &str| root.join(&owner_of(manifest).directory).join("__variance_dependency__.ts");
    let resolve = |manifest: &str, package: &str| {
        let importer = importer_of(manifest);
        resolver.resolution(&importer, package).or_else(|| resolver.declaration_resolution(&importer, package))
    };
    let pairs: Vec<_> = wanted.iter().collect();
    phases.next("pair resolution");
    let (keys, resolved_manifests): (Vec<_>, Vec<_>) = pairs.par_iter().map(|((manifest, package), _)| {
        let answer = resolve(manifest, package);
        let key = wanted::install_key(manifest, answer.as_ref());
        (key, answer.as_ref().and_then(|answer| answer.package_json().cloned()))
    }).unzip();
    phases.next("install homes");
    // Pairs that resolve to one install share a reading, and the one they share is read from the first of them in
    // key order, so which owner's neighbours (`@types/react` beside one, another copy beside the next) a reading
    // names does not depend on which thread got there first.
    let mut home = HashMap::<&str, &str>::new();
    for (((manifest, _), _), key) in pairs.iter().zip(&keys) { home.entry(key.as_str()).or_insert(manifest.as_str()); }
    phases.note(format_args!("pairs={}, installs={}", pairs.len(), home.len()));
    phases.next("resolve and read installed APIs");
    let read: Vec<Read> = pairs.par_iter().zip(keys.par_iter()).zip(resolved_manifests.par_iter()).map(|((((manifest, package), imported), key), manifest_json)| {
        let importer = importer_of(manifest);
        let shared = importer_of(home[key.as_str()]);
        let mut issues = Vec::new();
        let opened = manifest_json.as_ref().and_then(|package_json| manifest_readings.with(package_json.path(), |value| openings(package, value)));
        let opened = opened.unwrap_or_else(|| {
            issues.push(format!("the project resolver could not locate `{package}` from {}", relative(root, &importer)));
            BTreeSet::from([package.clone()])
        });
        let offered: BTreeSet<&String> = opened.iter().chain(*imported).collect();
        let offers = offered.into_iter().map(|specifier| {
            let cell = parsed.entry(format!("{key}\0{specifier}")).or_insert_with(|| Arc::new(OnceLock::new())).clone();
            let (api, reused) = cell.get_or_init(|| {
                let held = prior_entries.get(&(manifest.as_str(), specifier.as_str())).and_then(|&entry| prior.and_then(|prior| read_api(prior.entry_blob(entry as usize))));
                let (api, reused) = entry::api(root, &shared, specifier, &resolver, &manifest_readings, held.as_ref());
                (Arc::new(api), reused)
            }).clone();
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
    phases.note(format_args!("unique installed API readings={}", parsed.len()));
    manifest_readings.note(&phases);
    phases.next("release shared declaration facts");
    drop(manifest_readings);
    phases.next("catalogue rows");
    let mut entries = BTreeMap::<String, (Arc<Api>, bool)>::new();
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
    let apis: Vec<&Api> = entries.values().map(|(api, _)| api.as_ref()).collect();
    phases.note(format_args!("entries={}, installs={}", entries.len(), made_installs.len()));
    phases.next("installed source stamps");
    let stamps = stamps::of(root, &apis, &owners, &manifests);
    phases.note(format_args!("stamps={}", stamps.len()));
    phases.next("entry encoding");
    let reused = entries.values().filter(|(_, reused)| *reused).count() as u32;
    let unresolved = apis.iter().filter(|api| api.entrypoint.is_none()).count() as u32;
    let issues = made_pairs.iter().map(|pair| pair.issues.len()).sum::<usize>() as u32;
    let summary = [made_pairs.len() as u32, entries.len() as u32, apis.iter().filter(|api| api.entrypoint.is_some()).count() as u32,
        apis.iter().filter(|api| api.unavailable.is_some()).count() as u32 + issues];
    let made = Made {
        entries: entries.iter().map(|(id, (api, _))| (id.clone(), encoded(api))).collect(),
        owners, manifests, internal, pairs: made_pairs, installs: made_installs, stamps, summary,
    };
    phases.note(format_args!("reused={reused}, unresolved={unresolved}, issues={issues}"));
    phases.next("release catalogue inputs");
    (made, reused, unresolved)
}

#[cfg(test)]
mod tests {
    #[test]
    fn manifest_openings_keep_absent_null_conditions_and_patterns_distinct() {
        for (json, expected) in [
            (r#"{}"#, vec!["kit"]),
            (r#"{"exports":null}"#, vec![]),
            (r#"{"exports":false}"#, vec![]),
            (r#"{"exports":42}"#, vec![]),
            (r#"{"exports":{}}"#, vec![]),
            (r#"{"exports":""}"#, vec!["kit"]),
            (r#"{"exports":{"import":"./index.js","types":"./index.d.ts"}}"#, vec!["kit"]),
            (r#"{"exports":{".":null,"./a":{"types":"./a.d.ts"},"./*":"./*","./readme.md":"./readme.md","./data.json":"./data.json","./a.ts":["./a.ts",null]}}"#, vec!["kit/a", "kit/a.ts"]),
            (r#"{"exports":{"./bool":false,"./blank":"","./array":[null,false,{"default":"./f.js"}]}}"#, vec!["kit/array", "kit/blank"]),
        ] {
            let manifest = serde_json::from_str(json).unwrap();
            assert_eq!(super::openings("kit", &manifest).into_iter().collect::<Vec<_>>(), expected, "{json}");
        }
    }
}
