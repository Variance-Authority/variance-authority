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
    packages
        .par_iter()
        .enumerate()
        .map(|(at, package)| {
            let from = root.join(&package.directory).join("package.json");
            let mut entries: Vec<usize> = package
                .offers
                .iter()
                .filter(|target| !target.starts_with('/'))
                .filter_map(|target| {
                    // A manifest path is relative to the manifest, `./` or not;
                    // a request without it would name an installed package.
                    let request = if target.starts_with("./") || target.starts_with("../") { target.clone() } else { format!("./{target}") };
                    let file = resolvers.resolve(&root, &from, &request, Some(&known))?;
                    counted.get(file.as_str()).copied()
                })
                .filter(|&file| owner[file] as usize == at)
                .collect();
            entries.sort_unstable();
            entries.dedup();
            entries
        })
        .collect()
}

#[cfg(all(test, unix))]
#[path = "orient_map_entries_tests.rs"]
mod tests;
