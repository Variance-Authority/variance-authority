//! Where each package's shipped code starts: the files its manifest offers,
//! read as the source they are built from.
//!
//! What a package ships is its manifest's to say. `exports`, `main`, `module`
//! and `bin` are what a consumer loads, and a runtime loads nothing else of it,
//! so a file they name is an entry whoever else imports it: a package whose
//! every source file its own tests also import still ships them. A path under
//! a build's output is read back through the `tsconfig` that emits it
//! (`emitted.rs`), by the same resolver the scan resolves an import with, so
//! `./dist/index.js` is `src/index.ts` whether or not the build ran.
//!
//! A subpath pattern names no file: its `*` stands for whatever a consumer
//! writes after the key. So each file the package holds is asked which
//! substitutions could reach it, and the same resolver answers each one;
//! `./dist/*.js` reaches `src/a/b.ts` through `a/b` exactly as a consumer's
//! `pkg/a/b` would.
//!
//! The root config's `entrypoints` is not read here. It says where a directory
//! starts so that `variance coverage --from` can scope a closure, it may name a
//! directory that is no package, and where a package has a manifest the two
//! agree or the manifest is what a consumer gets. The manifests are also what
//! the kept map is keyed by, so a change to what a package offers folds the map
//! again, and a change to the config would not.
// TODO: a package whose manifest offers nothing — an application — starts where
// the root config's `entrypoints` says; that needs the fold handed the parsed
// config, and the kept map keyed by it.

// compass: variance-authority.reach.relations

use std::collections::HashMap;
use std::path::PathBuf;

use rayon::prelude::*;

use crate::package_owners::Package;
use crate::resolve::Resolvers;

/// Each package's declared entries, as indices into the counted files, by the
/// package's index in `packages`: the files its manifest offers that resolve to
/// a counted file it owns. Empty when it offers nothing that does, which is the
/// caller's to fall back from and to say so. `owner` is each counted file's
/// package.
pub(crate) fn declared(root: &str, packages: &[&Package], counted: &HashMap<&str, usize>, owner: &[u32]) -> Vec<Vec<usize>> {
    if packages.iter().all(|package| package.offers.is_empty()) {
        return vec![Vec::new(); packages.len()];
    }
    // The resolver answers with the path a symlink leads to, and a repository
    // path is cut from the root that path lies under.
    let root = std::fs::canonicalize(root).unwrap_or_else(|_| PathBuf::from(root));
    let resolvers = Resolvers::new(None, None);
    // A counted file under a directory the disk alone declines, such as a
    // tracked `build/`, is one git listed, and that is the word `resolve` takes.
    let known: HashMap<String, u32> = counted.keys().map(|&path| (path.to_owned(), 0)).collect();
    let mut path_of = vec![""; counted.len()];
    for (&path, &at) in counted {
        path_of[at] = path;
    }
    packages
        .par_iter()
        .enumerate()
        .map(|(at, package)| {
            let from = root.join(&package.directory).join("package.json");
            let reaches = |request: &str| resolvers.resolve(&root, &from, request, Some(&known)).and_then(|file| counted.get(file.as_str()).copied());
            let (patterns, targets): (Vec<String>, Vec<String>) = package
                .offers
                .iter()
                .filter(|target| !target.starts_with('/'))
                // A manifest path is relative to the manifest, `./` or not; a
                // request without it would name an installed package.
                .map(|target| if target.starts_with("./") || target.starts_with("../") { target.clone() } else { format!("./{target}") })
                .partition(|target| target.contains('*'));
            let mut entries: Vec<usize> = targets.iter().filter_map(|target| reaches(target)).filter(|&file| owner[file] as usize == at).collect();
            let prefix = if package.directory.is_empty() { String::new() } else { format!("{}/", package.directory) };
            for pattern in patterns.iter().filter_map(|pattern| pattern.split_once('*')).filter(|(_, tail)| !tail.contains('*')) {
                entries.extend((0..path_of.len()).filter(|&file| owner[file] as usize == at).filter(|&file| {
                    let Some(inside) = path_of[file].strip_prefix(&prefix) else { return false };
                    substitutions(inside, pattern.1).any(|x| reaches(&format!("{}{x}{}", pattern.0, pattern.1)) == Some(file))
                }));
            }
            entries.sort_unstable();
            entries.dedup();
            entries
        })
        .collect()
}

/// `path` with its last segment's extension cut off.
fn stem(path: &str) -> &str {
    let name = path.rfind('/').map_or(0, |at| at + 1);
    path[name..].rfind('.').map_or(path, |dot| &path[..name + dot])
}

/// The strings a pattern's `*` could stand for to reach the file at `inside`,
/// its path within the package, given what follows the `*`: every trailing run
/// of whole segments left once that tail is cut off, with and without both
/// extensions, since a build's output names the file its source is emitted to.
fn substitutions<'a>(inside: &'a str, tail: &'a str) -> impl Iterator<Item = &'a str> {
    [(inside, tail), (inside, stem(tail)), (stem(inside), tail), (stem(inside), stem(tail))]
        .into_iter()
        .filter_map(|(path, tail)| path.strip_suffix(tail))
        .flat_map(|rest| std::iter::once(0).chain(rest.match_indices('/').map(|(at, _)| at + 1)).map(move |start| &rest[start..]))
        .filter(|x| !x.is_empty())
}

#[cfg(all(test, unix))]
#[path = "orient_map_entries_tests.rs"]
mod tests;
