//! What a catalogue was read from on disk, and whether that still holds.
//!
//! The catalogue is a function of the checkout's manifests and of the installed packages. A refresh that finds
//! every path it read where it left it, and the source index where the sites file left it, has nothing to do,
//! so it reads none of them: not a manifest, not the git tree, and not a package.
//!
//! An installed file is compared by the size and modification time the file system reports, the comparison git
//! makes for its own index. The `node_modules` directories an owner resolves through are stamped too, because a
//! package added, removed or relinked changes what a specifier means without touching a file the catalogue read.

// compass: variance-authority.reach.relations

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use rayon::prelude::*;

use super::{Api, Owner};

/// The stamp the file system reports for `path`, or `absent`.
pub(super) fn stamp(path: &Path) -> String {
    let Ok(meta) = fs::metadata(path) else { return "absent".to_owned() };
    let nanos = meta.modified().ok().and_then(|at| at.duration_since(UNIX_EPOCH).ok()).map_or(0, |since| since.as_nanos());
    format!("{nanos}:{}", meta.len())
}

/// The `node_modules` directories an owner's specifiers resolve through: its own and each ancestor's up to
/// the root, and the scope directories inside them.
fn directories(root: &Path, owners: &[Owner]) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    for owner in owners {
        let mut directory = Path::new(&owner.directory);
        loop {
            let modules = directory.join("node_modules");
            if found.insert(modules.to_string_lossy().into_owned()) {
                if let Ok(listing) = fs::read_dir(root.join(&modules)) {
                    for child in listing.flatten() {
                        if child.file_name().to_string_lossy().starts_with('@') {
                            found.insert(modules.join(child.file_name()).to_string_lossy().into_owned());
                        }
                    }
                }
            }
            match directory.parent() {
                Some(parent) if directory != Path::new("") => directory = parent,
                _ => break,
            }
        }
    }
    found
}

/// The `skills/` directories beside the manifests one entry was read from.
fn skill_homes(api: &Api) -> impl Iterator<Item = std::path::PathBuf> + '_ {
    [&api.runtime, &api.declarations].into_iter().flatten()
        .filter_map(|identity| Path::new(&identity.manifest).parent().map(|parent| parent.join("skills")))
}

/// What one entry read: its digested sources, the manifests and README its purpose came from, and its skills.
fn read_by(api: &Api) -> Vec<String> {
    let mut paths: Vec<String> = api.sources.iter().flatten().map(|source| source.at.clone()).collect();
    for identity in [&api.runtime, &api.declarations].into_iter().flatten() {
        paths.push(identity.manifest.clone());
        if let Some(parent) = Path::new(&identity.manifest).parent() {
            paths.push(parent.join("README.md").to_string_lossy().into_owned());
        }
    }
    // The directory's stamp moves when a skill folder is added or removed; each file's when one is edited.
    paths.extend(skill_homes(api).map(|home| home.to_string_lossy().into_owned()));
    paths.extend(api.skills.iter().flatten().map(|skill| skill.at.clone()));
    paths
}

/// A `SKILL.md` for every folder under the entry's `skills/`, read or not: one written into a folder that
/// held none moves from `absent`, which the folder's own directory stamp does not show.
fn skill_files(root: &Path, api: &Api) -> Vec<String> {
    skill_homes(api).flat_map(|home| {
        fs::read_dir(root.join(&home)).into_iter().flatten().flatten()
            .filter(|child| child.file_type().is_ok_and(|kind| kind.is_dir() || kind.is_symlink()))
            .map(move |child| home.join(child.file_name()).join("SKILL.md").to_string_lossy().into_owned())
    }).collect()
}

/// Every path a catalogue over `apis` and `owners` was read from, each with its stamp, in code-unit order.
pub(super) fn of(root: &Path, apis: &[&Api], owners: &[Owner], manifests: &[String]) -> Vec<(String, String)> {
    let mut paths: BTreeSet<String> = apis.iter().flat_map(|api| read_by(api)).collect();
    paths.extend(apis.par_iter().flat_map_iter(|api| skill_files(root, api)).collect::<Vec<_>>());
    paths.extend(directories(root, owners));
    paths.extend(manifests.iter().cloned());
    // The root manifest names the workspaces, whether git tracks it or not.
    paths.insert("package.json".to_owned());
    let mut paths: Vec<String> = paths.into_iter().collect();
    paths.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    paths.into_par_iter().map(|at| { let held = stamp(&root.join(&at)); (at, held) }).collect()
}

/// The stamped paths whose stamp is no longer the one held.
pub(super) fn moved<'a>(root: &Path, stamps: &[(&'a str, &'a str)]) -> Vec<&'a str> {
    stamps.par_iter().filter(|(at, held)| stamp(&root.join(at)) != *held).map(|(at, _)| *at).collect()
}
