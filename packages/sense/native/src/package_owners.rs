//! Which package every tracked file belongs to, from the tree git already
//! listed.
//!
//! The rule is `ownership` in `packages/package/src/manifest.ts`: the nearest
//! directory above a file whose `package.json` has a string `name`, and no
//! package when nothing above it is named, the root included. That function
//! asks the file system per directory, which is right for a caller holding a
//! handful of files. The package graph holds every file in the repository, and
//! git has already said where every manifest is, so the manifests are read
//! once, in parallel, and every tracked directory is answered from its parent's
//! answer — one lookup per directory, never a walk per file.
//!
//! A package is identified by its directory, not its name. Two manifests
//! declaring one name are two packages, which is what a fixture workspace
//! nested in a test directory is, and merging them would charge one package
//! with the other's imports.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

use rayon::prelude::*;
use serde::Deserialize;

/// The owner of a file no named manifest sits above.
pub(crate) const NO_OWNER: u32 = u32::MAX;

/// One named manifest: its directory, `''` at the root, its name, and the
/// names it declares it takes: `dependencies`, `peerDependencies` and
/// `optionalDependencies` in `depends`, `devDependencies` in `develops`.
pub(crate) struct Package {
    pub directory: String,
    pub name: String,
    pub depends: Vec<String>,
    pub develops: Vec<String>,
}

pub(crate) struct Owners<'a> {
    pub packages: Vec<Package>,
    /// Every tracked file's package, as an index into `packages` or
    /// [`NO_OWNER`], and its position in the listing it came from.
    pub files: HashMap<&'a str, (u32, u32)>,
}

#[derive(Deserialize)]
pub(crate) struct Manifest {
    name: Option<serde_json::Value>,
    pub dependencies: Option<serde_json::Value>,
    #[serde(rename = "peerDependencies")]
    pub peer_dependencies: Option<serde_json::Value>,
    #[serde(rename = "optionalDependencies")]
    pub optional_dependencies: Option<serde_json::Value>,
    #[serde(rename = "devDependencies")]
    pub dev_dependencies: Option<serde_json::Value>,
}

/// The keys of a dependency map; anything that is not a map declares nothing.
pub(crate) fn declared(field: &Option<serde_json::Value>) -> impl Iterator<Item = String> + '_ {
    field.as_ref().and_then(serde_json::Value::as_object).into_iter().flat_map(|map| map.keys().cloned())
}

/// The directory a repository-relative path sits in, `''` at the root.
pub(crate) fn parent(path: &str) -> &str {
    path.rfind('/').map_or("", |at| &path[..at])
}

/// Every path in `paths` given its package, reading each tracked
/// `package.json` under `root` once. A manifest under a directory the index
/// scan declines even where git lists it (`crate::path::excluded_when_listed`)
/// is a copy or an output, not a package, and names nothing.
pub(crate) fn owners<'a>(root: &str, paths: &'a [String]) -> Owners<'a> {
    let manifests: Vec<&str> = paths
        .iter()
        .map(String::as_str)
        .filter(|path| path.rsplit('/').next() == Some("package.json") && is_package(path))
        .collect();
    // A manifest that cannot be read or does not parse names nothing, which is
    // what `ownership` makes of it too: the directory defers to its parent.
    let mut named: Vec<Package> = manifests
        .par_iter()
        .filter_map(|manifest| {
            let bytes = std::fs::read(std::path::Path::new(root).join(manifest)).ok()?;
            let parsed: Manifest = serde_json::from_slice(&bytes).ok()?;
            let serde_json::Value::String(name) = parsed.name? else { return None };
            let depends = [&parsed.dependencies, &parsed.peer_dependencies, &parsed.optional_dependencies]
                .into_iter()
                .flat_map(declared)
                .collect();
            let develops = declared(&parsed.dev_dependencies).collect();
            Some(Package { directory: parent(manifest).to_owned(), name, depends, develops })
        })
        .collect();
    named.sort_unstable_by(|left, right| crate::order::code_unit(&left.directory, &right.directory));
    let by_directory: HashMap<&str, u32> =
        named.iter().enumerate().map(|(at, package)| (package.directory.as_str(), at as u32)).collect();

    let mut directories: HashMap<&'a str, u32> = HashMap::new();
    let mut files = HashMap::with_capacity(paths.len());
    for (at, path) in paths.iter().enumerate() {
        let owner = directory_owner(parent(path), &by_directory, &mut directories);
        files.insert(path.as_str(), (owner, at as u32));
    }
    Owners { packages: named, files }
}

/// Whether a `package.json` at `path` may name a package: no directory above
/// it is one the index scan declines.
pub(crate) fn is_package(path: &str) -> bool {
    !parent(path).split('/').any(crate::path::excluded_when_listed)
}

/// A directory's package: its own manifest's, or its parent's answer.
fn directory_owner<'a>(directory: &'a str, named: &HashMap<&str, u32>, known: &mut HashMap<&'a str, u32>) -> u32 {
    if let Some(&owner) = known.get(directory) {
        return owner;
    }
    let owner = match named.get(directory) {
        Some(&owner) => owner,
        None if directory.is_empty() => NO_OWNER,
        None => directory_owner(parent(directory), named, known),
    };
    known.insert(directory, owner);
    owner
}
