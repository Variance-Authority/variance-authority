//! Where each package's shipped code starts: the files its manifest offers,
//! read as the source they are built from.
//!
//! What a package ships is its manifest's to say. `exports`, `main`, `module`
//! and `bin` are what a consumer loads, and a runtime loads nothing else of it,
//! so a file they name is an entry whoever else imports it and whatever its
//! path says: a package whose every source file its own tests also import
//! still ships them, and so does one offering `./src/jest.ts` as `./jest`. The
//! exception is a package inside a test's fixtures, which offers its files to
//! that test (`read` in `orient_map_read.rs`). A path under
//! a build's output is read back through the `tsconfig` that emits it
//! (`emitted.rs`), by the same resolver the scan resolves an import with, so
//! `./dist/index.js` is `src/index.ts` whether or not the build ran.
//!
//! A subpath pattern is matched against counted source files and the output
//! paths their declared layouts write. The resolver verifies each matching
//! request, preserving extension precedence and symlink behavior.
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
use crate::resolve::{Resolvers, EXTENSION_ALIASES, MODULE_EXTENSIONS, STYLE_EXTENSIONS};

/// Each package's declared entries, as indices into the counted files, by the
/// package's index in `packages`: the files its manifest offers that resolve to
/// a counted file it owns. Empty when it offers nothing that does, which is the
/// caller's to fall back from and to say so. `owner` is each counted file's
/// package. `resolvers` carries the listing and layouts the scan resolved under.
pub(crate) fn declared(root: &str, packages: &[&Package], counted: &HashMap<&str, usize>, owner: &[u32], resolvers: &Resolvers) -> Vec<Vec<usize>> {
    if packages.iter().all(|package| package.offers.is_empty()) {
        return vec![Vec::new(); packages.len()];
    }
    // The resolver answers with the path a symlink leads to, and a repository
    // path is cut from the root that path lies under.
    let root = std::fs::canonicalize(root).unwrap_or_else(|_| PathBuf::from(root));
    // A counted file under a directory the disk alone declines, such as a
    // tracked `build/`, is one git listed, and that is the word `resolve` takes.
    let known: HashMap<String, u32> = counted.keys().map(|&path| (path.to_owned(), 0)).collect();
    let mut path_of = vec![""; counted.len()];
    for (&path, &at) in counted {
        path_of[at] = path;
    }
    let mut owned = vec![Vec::new(); packages.len()];
    for (file, &package) in owner.iter().enumerate() {
        owned[package as usize].push(file);
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
            let directory = root.join(&package.directory);
            let patterns: Vec<_> = patterns.iter().filter_map(|pattern| {
                let (prefix, suffix) = pattern.split_once('*')?;
                if suffix.contains('*') { return None; }
                let absolute = crate::conditions::normalize(&directory.join(prefix));
                // A fixed directory prefix may be a workspace symlink. Match
                // its destination, but resolve the original request below.
                let matched = if prefix.ends_with('/') {
                    format!("{}/", std::fs::canonicalize(&absolute).unwrap_or(absolute).to_string_lossy())
                } else {
                    let parent = absolute.parent()?;
                    std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_owned()).join(absolute.file_name()?).to_string_lossy().into_owned()
                }.replace('\\', "/");
                Some((prefix, suffix, matched))
            }).collect();
            if !patterns.is_empty() {
                for &file in &owned[at] {
                    let path = root.join(path_of[file]);
                    let matched = resolvers.spellings(&directory, &path).into_iter().any(|spelled| {
                        let absolute = crate::conditions::normalize(&directory.join(spelled)).to_string_lossy().replace('\\', "/");
                        candidates(&absolute).into_iter().any(|candidate| patterns.iter().any(|(prefix, suffix, matched)| {
                            candidate.strip_prefix(matched).and_then(|rest| rest.strip_suffix(suffix))
                                .filter(|star| !star.is_empty()).is_some_and(|star| reaches(&format!("{prefix}{star}{suffix}")) == Some(file))
                        }))
                    });
                    if matched { entries.push(file); }
                }
            }
            entries.sort_unstable();
            entries.dedup();
            entries
        })
        .collect()
}

/// Spellings the existing resolver can extend or alias to this path. Each
/// match is still resolved, so another file earlier in its order wins.
fn candidates(path: &str) -> Vec<String> {
    let mut requests = vec![path.to_owned()];
    for extension in MODULE_EXTENSIONS.iter().chain(STYLE_EXTENSIONS).copied().chain(std::iter::once(".json")) {
        if let Some(stem) = path.strip_suffix(extension) {
            requests.push(stem.to_owned());
            if let Some(directory) = stem.strip_suffix("/index") {
                requests.extend([directory.to_owned(), format!("{directory}/")]);
            }
        }
    }
    for (written, aliases) in EXTENSION_ALIASES {
        for alias in *aliases {
            if let Some(stem) = path.strip_suffix(alias) { requests.push(format!("{stem}{written}")); }
        }
    }
    requests.sort_unstable();
    requests.dedup();
    requests
}

#[cfg(all(test, unix))]
#[path = "orient_map_entries_tests.rs"]
mod tests;
