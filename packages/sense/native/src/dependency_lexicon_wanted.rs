//! What each (owner manifest, package) pair is asked for: declared, and the specifiers imported under it.

// compass: variance-authority.reach.relations

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::Path;

use super::sites::{sites, State};
use super::view::Owning;
use super::Owner;
use crate::package_owners::{is_package, NO_OWNER};

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

/// The owner rows: every tracked `package.json` the package owner would read (`crate::package_owners::is_package`),
/// so a file is judged against the manifest nearest above it (ADR-0082) whether or not the root's `workspaces` list
/// it. A project nested in the checkout with a manifest and an install of its own declares its own dependencies. A
/// manifest without a `name` declares them all the same: a name makes a package importable, not its declarations.
pub(super) fn owners(root: &Path, paths: &[String]) -> Vec<Owner> {
    owners_from(root, paths, None)
}

pub(super) fn owners_from(root: &Path, paths: &[String], listing: Option<&crate::emitted::Listing>) -> Vec<Owner> {
    let manifests = paths.iter().filter(|path| path.rsplit('/').next() == Some("package.json") && is_package(path));
    let mut found = Vec::new();
    for manifest in manifests {
        let directory = manifest.strip_suffix("/package.json").unwrap_or("");
        let value: serde_json::Value = match crate::emitted::read_content(listing, &root.join(manifest)).ok()
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


#[cfg(all(test, unix))]
mod tests {
    #[test]
    fn carried_workspace_owners_read_indexed_bytes_and_worktree_policy_stays_explicit() {
        let root = crate::git_fixture::repository("listed-lexicon-owner", &[
            ("package.json", br#"{"name":"listed","dependencies":{"external":"*"}}"#),
        ]);
        let tree = crate::git_tree::git_tree(root.to_str().unwrap().to_owned()).unwrap();
        let listing = tree.listing();
        std::fs::remove_file(root.join("package.json")).unwrap();
        let owners = super::owners_from(&root, &tree.paths, Some(&listing));
        assert_eq!(owners.len(), 1);
        assert_eq!(owners[0].name, "listed");
        assert!(owners[0].declared.contains("external"));
        assert!(super::owners(&root, &tree.paths).is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
}
