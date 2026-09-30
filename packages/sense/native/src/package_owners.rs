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
    /// The paths it offers a runtime, as written (`offered`).
    pub offers: Vec<String>,
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
    exports: Option<serde_json::Value>,
    main: Option<serde_json::Value>,
    module: Option<serde_json::Value>,
    bin: Option<serde_json::Value>,
}

/// The paths a manifest offers a runtime, as written: every target of
/// `exports` but one under a `types` condition, then `main`, `module` and
/// every `bin`. A declaration is not what a runtime loads, and a subpath
/// pattern (`./*`) opens whatever matches it rather than naming a file, so
/// neither is offered here.
// TODO: a subpath pattern offers every counted file its target matches; that
// needs the pattern expanded against the listing in `orient_map_entries.rs`.
fn offered(manifest: &Manifest) -> Vec<String> {
    fn targets(value: &serde_json::Value, into: &mut Vec<String>) {
        match value {
            serde_json::Value::String(target) if !target.contains('*') => into.push(target.clone()),
            serde_json::Value::Array(values) => values.iter().for_each(|value| targets(value, into)),
            serde_json::Value::Object(map) => {
                for (key, value) in map {
                    // A subpath key with a pattern maps a pattern; a condition
                    // key never holds one.
                    if key != "types" && key != "typings" && !key.contains('*') {
                        targets(value, into);
                    }
                }
            }
            _ => {}
        }
    }
    let mut offers = Vec::new();
    if let Some(exports) = &manifest.exports {
        targets(exports, &mut offers);
    }
    for field in [&manifest.main, &manifest.module] {
        if let Some(serde_json::Value::String(target)) = field {
            offers.push(target.clone());
        }
    }
    match &manifest.bin {
        Some(serde_json::Value::String(target)) => offers.push(target.clone()),
        Some(serde_json::Value::Object(map)) => offers.extend(map.values().filter_map(|value| value.as_str().map(str::to_owned))),
        _ => {}
    }
    offers
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
            let offers = offered(&parsed);
            let serde_json::Value::String(name) = parsed.name? else { return None };
            let depends = [&parsed.dependencies, &parsed.peer_dependencies, &parsed.optional_dependencies]
                .into_iter()
                .flat_map(declared)
                .collect();
            let develops = declared(&parsed.dev_dependencies).collect();
            Some(Package { directory: parent(manifest).to_owned(), name, depends, develops, offers })
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

/// Each package's name as a reader is shown it, and the packages shallowest
/// first. The shallowest manifest keeps a name two declare; a deeper one is
/// shown with its directory.
pub(crate) fn shown(owners: &Owners) -> (Vec<u32>, Vec<String>) {
    let mut order: Vec<u32> = (0..owners.packages.len() as u32).collect();
    let depth = |at: u32| owners.packages[at as usize].directory.split('/').filter(|part| !part.is_empty()).count();
    order.sort_by(|&a, &b| {
        depth(a).cmp(&depth(b)).then_with(|| crate::order::code_unit(&owners.packages[a as usize].directory, &owners.packages[b as usize].directory))
    });
    let mut claimed: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let mut shown: Vec<String> = vec![String::new(); owners.packages.len()];
    for &at in &order {
        let package = &owners.packages[at as usize];
        shown[at as usize] = if claimed.insert(&package.name) { package.name.clone() } else { format!("{} ({})", package.name, package.directory) };
    }
    (order, shown)
}

/// Any path's package, tracked or not: the listing's answer, else its nearest
/// named directory. `directories` maps each package's directory to it.
pub(crate) fn owner_of(owners: &Owners, directories: &HashMap<&str, u32>, path: &str) -> Option<u32> {
    if let Some(&(owner, _)) = owners.files.get(path) {
        return (owner != NO_OWNER).then_some(owner);
    }
    let mut directory = parent(path);
    loop {
        if let Some(&owner) = directories.get(directory) {
            return Some(owner);
        }
        if directory.is_empty() {
            return None;
        }
        directory = parent(directory);
    }
}
