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
use std::sync::{Arc, Mutex};

use rayon::prelude::*;

use crate::package_owners::Package;
use crate::resolve::{Resolvers, Tsconfig};

/// Each package's declared entries, as indices into the counted files, by the
/// package's index in `packages`: the files its manifest offers that resolve to
/// a counted file it owns. Empty when it offers nothing that does, which is the
/// caller's to fall back from and to say so. `owner` is each counted file's
/// package. `tsconfig` is the config the scan that built the index resolved
/// under.
pub(crate) fn declared(root: &str, packages: &[&Package], counted: &HashMap<&str, usize>, owner: &[u32], listing: Option<Arc<crate::emitted::Listing>>, tsconfig: Tsconfig, read_blobs: bool) -> Vec<Vec<usize>> {
    #[derive(Default)]
    struct Counts {
        reaches: usize, unique: usize, successes: usize, misses: usize,
        candidates: usize, substitutions: usize, memo_hits: usize, resolver_calls: usize,
    }
    let mut phases = crate::timings::Phases::new("map entries", "prepare resolver and owned candidates");
    if packages.iter().all(|package| package.offers.is_empty()) {
        return vec![Vec::new(); packages.len()];
    }
    // The resolver answers with the path a symlink leads to, and a repository
    // path is cut from the root that path lies under.
    let root = std::fs::canonicalize(root).unwrap_or_else(|_| PathBuf::from(root));
    let filesystem = crate::emitted::Emitted::listed_for(&root, listing, read_blobs);
    let resolvers = Resolvers::over(tsconfig, None, filesystem.clone());
    // A counted file under a directory the disk alone declines, such as a
    // tracked `build/`, is one git listed, and that is the word `resolve` takes.
    let known: HashMap<String, u32> = counted.keys().map(|&path| (path.to_owned(), 0)).collect();
    let mut path_of = vec![""; counted.len()];
    for (&path, &at) in counted {
        path_of[at] = path;
    }
    let mut by_owner = vec![Vec::new(); packages.len()];
    for file in 0..path_of.len() {
        if let Some(files) = by_owner.get_mut(owner[file] as usize) {
            files.push(file);
        }
    }
    phases.note(format_args!("{} packages, {} counted files", packages.len(), path_of.len()));
    phases.next("resolve offered entries");
    let totals = phases.enabled().then(|| Mutex::new(Counts::default()));
    let entries = packages
        .par_iter()
        .enumerate()
        .map(|(at, package)| {
            let mut measured = Counts::default();
            let from = root.join(&package.directory).join("package.json");
            let (patterns, targets): (Vec<String>, Vec<String>) = package
                .offers
                .iter()
                .filter(|target| !target.starts_with('/'))
                // A manifest path is relative to the manifest, `./` or not; a
                // request without it would name an installed package.
                .map(|target| if target.starts_with("./") || target.starts_with("../") { target.clone() } else { format!("./{target}") })
                .partition(|target| target.contains('*'));
            let files: Vec<PathBuf> = if patterns.is_empty() { Vec::new() } else { by_owner[at].iter().map(|&file| root.join(path_of[file])).collect() };
            let offered = resolvers.offered_requests(&from, &files, &patterns);
            measured.candidates = files.len();
            measured.substitutions = offered.len();
            let mut requests = targets;
            requests.extend(offered);
            requests.sort_by(|a, b| crate::order::code_unit(a, b));
            requests.dedup();
            measured.unique = requests.len();
            let mut entries = Vec::new();
            for request in requests {
                measured.reaches += 1;
                measured.resolver_calls += 1;
                let answer = resolvers.resolve(&root, &from, &request, Some(&known)).and_then(|file| counted.get(file.as_str()).copied());
                if let Some(file) = answer {
                    measured.successes += 1;
                    if owner[file] as usize == at { entries.push(file); }
                } else { measured.misses += 1; }
            }
            entries.sort_unstable();
            entries.dedup();
            if let Some(totals) = &totals {
                let mut totals = totals.lock().unwrap();
                totals.reaches += measured.reaches;
                totals.unique += measured.unique;
                totals.successes += measured.successes;
                totals.misses += measured.misses;
                totals.candidates += measured.candidates;
                totals.substitutions += measured.substitutions;
                totals.resolver_calls += measured.resolver_calls;
            }
            entries
        })
        .collect();
    if let Some(totals) = totals {
        let totals = totals.into_inner().unwrap();
        phases.note(format_args!("reaches={}, unique requests within packages={}, memo hits={}, resolver calls={}, successes={}, misses={}, owned candidate visits={}, substitution attempts={}",
            totals.reaches, totals.unique, totals.memo_hits, totals.resolver_calls, totals.successes, totals.misses, totals.candidates, totals.substitutions));
    }
    if let Some(counts) = filesystem.metadata_counts() { phases.note(counts); }
    entries
}

#[cfg(all(test, unix))]
#[path = "orient_map_entries_tests.rs"]
mod tests;
