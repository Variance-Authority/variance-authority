//! What each (owner manifest, package) pair is asked for: declared, imported, and the first site of each request.

// compass: variance-authority.reach.relations

use std::collections::{BTreeMap, HashSet};
use std::{fs, path::Path};

use regex::Regex;

use super::{merge, Owner, Wanted};

/// Every owner, request site and internal package name, read from git and the whole source index.
pub(super) fn full(root: &str, index: &str, has_index: bool) -> napi::Result<(Vec<Owner>, BTreeMap<String, Vec<merge::Site>>, Vec<String>)> {
    let Some(snapshot) = crate::git::snapshot(root) else {
        return Err(napi::Error::from_reason(format!("git could not list the checkout at {root}")));
    };
    let owners = owners(Path::new(root), &snapshot.paths);
    // The source index is the owner's reading of requests. Its full Rust orientation stays native here.
    let mut sites = BTreeMap::new();
    if has_index {
        let source_files: Vec<String> = snapshot.paths.iter().filter(|path| merge::is_source(path)).cloned().collect();
        if !source_files.is_empty() {
            let observed = crate::external_dependencies::external_dependencies(
                root.to_owned(), index.to_owned(), source_files, u32::MAX, u32::MAX,
            )?.ok_or_else(|| napi::Error::from_reason("the source index did not read"))?;
            if observed.more > 0 || observed.dependencies.iter().any(|dependency| dependency.more_sites > 0) {
                return Err(napi::Error::from_reason("the source index has more external requests than the lexicon reader can carry"));
            }
            sites = merge::contributions(observed.dependencies.into_iter().flat_map(|dependency| {
                let package = dependency.package;
                dependency.sites.into_iter().map(move |site| (site.file, merge::Site { package: package.clone(), specifier: site.specifier, line: site.line }))
            }));
        }
    }
    let internal = crate::package_owners::owners(root, &snapshot.paths).packages.into_iter().map(|package| package.name).collect();
    Ok((owners, sites, internal))
}

/// The pairs a lexicon is asked about: every declared external package, and every package a source imports.
pub(super) fn of(owners: &[Owner], sites: &BTreeMap<String, Vec<merge::Site>>) -> BTreeMap<(String, String), Wanted> {
    let internal: HashSet<&str> = owners.iter().map(|owner| owner.name.as_str()).collect();
    let mut wanted = BTreeMap::<(String, String), Wanted>::new();
    for owner in owners {
        for package in owner.declared.iter().filter(|package| !internal.contains(package.as_str())) {
            wanted.insert((owner.manifest.clone(), package.clone()), Wanted { declared: true, ..Wanted::default() });
        }
    }
    let mut owning = merge::Owning::new(owners);
    for (file, requests) in sites {
        let Some(owner) = owning.of(file) else { continue };
        for site in requests {
            if internal.contains(site.package.as_str()) { continue; }
            let held = wanted.entry((owner.manifest.clone(), site.package.clone())).or_default();
            held.declared |= owner.declared.contains(&site.package);
            let request = held.requests.entry(site.specifier.clone()).or_insert((0, file.clone(), site.line));
            request.0 += 1;
            if crate::order::code_unit(file, &request.1).then(site.line.cmp(&request.2)).is_lt() {
                request.1 = file.clone();
                request.2 = site.line;
            }
            held.imported.insert(site.specifier.clone());
        }
    }
    wanted
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

pub(super) fn owners(root: &Path, paths: &[String]) -> Vec<Owner> {
    let root_value: serde_json::Value = fs::read(root.join("package.json")).ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or(serde_json::Value::Null);
    let patterns = workspace_patterns(&root_value);
    let mut found = Vec::new();
    for manifest in paths.iter().filter(|path| path == &"package.json" || path.ends_with("/package.json")) {
        let directory = manifest.strip_suffix("/package.json").unwrap_or("");
        if manifest != "package.json" && !patterns.iter().any(|pattern| pattern.is_match(directory)) { continue; }
        let value: serde_json::Value = match fs::read(root.join(manifest)).ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok()) { Some(value) => value, None => continue };
        // A package in more than one field is reported under the strongest: what ships, then what a consumer must bring, then what only builds.
        let mut kinds = BTreeMap::<String, &'static str>::new();
        for (field, kind) in [("dependencies", "dependency"), ("optionalDependencies", "optional"), ("peerDependencies", "peer"), ("devDependencies", "dev")] {
            for package in value.get(field).and_then(serde_json::Value::as_object).into_iter().flat_map(|map| map.keys()) {
                kinds.entry(package.clone()).or_insert(kind);
            }
        }
        let declared = kinds.keys().cloned().collect();
        found.push(Owner { manifest: manifest.clone(), directory: directory.to_owned(),
            name: value.get("name").and_then(serde_json::Value::as_str).unwrap_or("").to_owned(), declared, kinds });
    }
    found.sort_by(|a, b| a.manifest.cmp(&b.manifest));
    found
}

/// What a pair's readings are shared by: the installed manifest it resolved to, or the pair's own owner when nothing did.
pub(super) fn install_key(owner: &str, resolution: Option<&oxc_resolver::Resolution>) -> String {
    resolution.and_then(|answer| answer.package_json()).map(|manifest| manifest.path().to_string_lossy().into_owned())
        .unwrap_or_else(|| format!("unresolved:{owner}"))
}
