//! Where a Swift module name lands. A module is a whole target, so a name
//! reaches every Swift file of the target, and a file's own target (`*`) every
//! file beside it. The targets are read once per world, off every
//! `Package.swift`, so asking is a lookup.
//!
//! Swift lacks the edge this package is built on: `import Core` names a whole
//! target, nothing in the file says which of its files a symbol came from, and
//! files see each other within a target with no import at all
//! ([ADR-0066](https://github.com/Variance-Authority/variance-authority/blob/main/docs/context/adr/0066-a-language-is-a-reader-not-a-sense.md)).
//! The projection onto files over-reaches the way selection is allowed to: a
//! test that did not need running is cost. Measured on a 708-file, 51-target
//! SwiftPM package: the largest target is 78 files, and same-target visibility
//! is 20,756 edges, about twenty-nine per file.
//!
//! `Package.swift` is a program: `.target(name:path:)` is a call, `path:` is
//! often not the default, so the manifest is read with the Swift grammar, and
//! `Sources/<name>` is the fallback for a manifest that could not be read.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;

use crate::world::World;

/// The request a file makes for its own target: the files it sees without asking.
const OWN_TARGET: &str = "*";

const SWIFT_FILE: &str = ".swift";
const MANIFEST: &str = "Package.swift";

/// Each module name's directory, and every target
/// directory, longest first, so the innermost wins.
#[derive(Debug, Default)]
pub(crate) struct Index {
    by_name: HashMap<String, String>,
    directories: Vec<String>,
}

impl Index {
    /// The targets every manifest of `world` declares, the conventional layout first.
    pub(crate) fn of(world: &World) -> Self {
        let mut by_name = HashMap::new();
        for manifest in world.below("") {
            if !is_manifest(manifest) {
                continue;
            }
            let at = &manifest[..manifest.len().saturating_sub(MANIFEST.len() + 1)];
            // The convention first, so a manifest that could not be read still
            // produces targets, and a declared `path:` overwrites the guess after.
            for kind in ["Sources", "Tests"] {
                let base = under(at, kind);
                for path in world.below(&base) {
                    let rest = &path[base.len() + 1..];
                    if let Some(slash) = rest.find('/').filter(|slash| *slash > 0) {
                        let name = &rest[..slash];
                        by_name.insert(name.to_owned(), under(at, &format!("{kind}/{name}")));
                    }
                }
            }
            for (name, path) in declared_targets(world.text(manifest).as_deref()) {
                by_name.insert(name, under(at, &path));
            }
        }
        let mut directories: Vec<String> = by_name.values().cloned().collect();
        directories.sort_unstable();
        directories.dedup();
        // Two directories of one length cannot both hold a file, so their order is not an answer.
        directories.sort_by(|left, right| right.len().cmp(&left.len()));
        Self { by_name, directories }
    }
}

/// Every file a Swift module name reaches, which is every file in its target.
pub(crate) fn resolve(world: &World, from: &str, request: &str) -> Vec<String> {
    // A manifest is a build description, not a member of what it describes.
    if is_manifest(from) {
        return Vec::new();
    }
    let targets = world.swift_index();
    if request != OWN_TARGET {
        return targets.by_name.get(request).map_or_else(Vec::new, |declared| sources_under(world, declared, from, true));
    }
    if let Some(own) = targets.directories.iter().find(|at| from.starts_with(&format!("{at}/"))) {
        return sources_under(world, own, from, true);
    }
    // A Swift file no package claims: only the files beside it, since without
    // a manifest nothing says a subdirectory compiles with it.
    let directory = from.rfind('/').map_or("", |cut| &from[..cut]);
    sources_under(world, directory, from, false)
}

fn is_manifest(path: &str) -> bool {
    path == MANIFEST || path.ends_with(&format!("/{MANIFEST}"))
}

fn sources_under(world: &World, directory: &str, from: &str, deep: bool) -> Vec<String> {
    let keep = |path: &&str| path.ends_with(SWIFT_FILE) && *path != from && !is_manifest(path);
    if deep {
        world.below(directory).iter().copied().filter(keep).map(str::to_owned).collect()
    } else {
        world.under(directory).filter(keep).map(str::to_owned).collect()
    }
}

fn under(at: &str, rest: &str) -> String {
    if at.is_empty() { rest.to_owned() } else { format!("{at}/{rest}") }
}

/// The `.target(name:path:)` calls in a manifest, read with the Swift grammar;
/// nothing on a build without its grammars.
#[cfg(feature = "grammars")]
fn declared_targets(text: Option<&str>) -> Vec<(String, String)> {
    let targets = text.and_then(crate::languages::swift_targets).unwrap_or_default();
    targets.into_iter().map(|target| (target.name, target.path)).collect()
}

#[cfg(not(feature = "grammars"))]
fn declared_targets(_text: Option<&str>) -> Vec<(String, String)> {
    Vec::new()
}

#[cfg(test)]
#[path = "resolve_swift_tests.rs"]
mod tests;
