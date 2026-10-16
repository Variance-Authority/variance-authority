//! What each (owner manifest, package) pair is asked for: declared, and the specifiers imported under it.

// compass: variance-authority.reach.relations

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::{fs, path::Path};

use regex::Regex;

use super::sites::{sites, State};
use super::view::Owning;
use super::Owner;
use crate::package_owners::NO_OWNER;

/// The `package.json` paths git tracks under `root`, in code-unit order. A manifest that is not yet added is
/// not listed: the walk for untracked files costs half a second on a checkout the size of Kibana, and a
/// workspace nobody has added is one the index does not hold either. It is read once `git add` names it.
pub(super) fn manifests(root: &str) -> Option<Vec<String>> {
    let output = std::process::Command::new("git").arg("-C").arg(root)
        .args(["ls-files", "-z", "--cached", "--", "package.json", "*/package.json"])
        .output().ok().filter(|output| output.status.success())?;
    let mut listed: Vec<String> = output.stdout.split(|byte| *byte == 0).filter(|path| !path.is_empty())
        .map(|path| String::from_utf8_lossy(path).into_owned()).collect();
    listed.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    listed.dedup();
    Some(listed)
}

/// The pairs a lexicon is asked about, every declared external package and every package a source imports, each
/// with the specifiers a source under its owner imports.
pub(super) fn of(owners: &[Owner], state: Option<&State>) -> BTreeMap<(String, String), BTreeSet<String>> {
    let internal: HashSet<&str> = owners.iter().map(|owner| owner.name.as_str()).collect();
    let mut wanted = BTreeMap::<(String, String), BTreeSet<String>>::new();
    for owner in owners {
        for package in owner.declared.iter().filter(|package| !internal.contains(package.as_str())) {
            wanted.insert((owner.manifest.clone(), package.clone()), BTreeSet::new());
        }
    }
    let Some(state) = state else { return wanted };
    let mut owning = Owning::new(owners);
    for (file, rows) in state.files() {
        let owner = match owning.file(file) { NO_OWNER => continue, owner => &owners[owner as usize] };
        for site in sites(rows).filter(|site| !internal.contains(site.package)) {
            wanted.entry((owner.manifest.clone(), site.package.to_owned())).or_default().insert(site.specifier.to_owned());
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
