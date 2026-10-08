//! What a lexicon was built from, and whether that still holds.
//!
//! The lexicon is a function of three things that each have an owner of change:
//! the source index's chain (its manifest names every segment by digest), the
//! checkout's manifests and sources (which the index digests), and the installed
//! packages. A refresh that finds all three where it left them has nothing to
//! do, so it reads none of them: not the chain's records, not the git tree, and
//! not a package. The record is kept beside the lexicon in a file of its own
//! so that asking costs a few kilobytes, not the corpus.
//!
//! An installed file is compared by the size and modification time the file
//! system reports, the comparison git makes for its own index; a file whose
//! stamp moved is read again by the refresh that follows. The `node_modules`
//! directories an owner resolves through are stamped too, because a package
//! added, removed or relinked changes what a specifier means without touching a
//! file the lexicon read.

// compass: variance-authority.reach.relations

use std::collections::BTreeSet;
use std::path::Path;
use std::time::UNIX_EPOCH;
use std::fs;

use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use super::{Entry, Owner};

const FORMAT: u8 = 1;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Built {
    format: u8,
    /// The lexicon file format the record was made for.
    version: u8,
    /// The lexicon file this record describes, so a lexicon removed or replaced since is not taken as current.
    lexicon: String,
    /// The source index's segments, oldest first.
    chain: Vec<String>,
    /// Every installed path the refresh read, and its stamp.
    stamps: Vec<(String, String)>,
    pub packages: u32,
    pub entrypoints: u32,
    pub reusable: u32,
    pub unavailable: u32,
}

/// The stamp the file system reports for `path`, or `absent`.
fn stamp(path: &Path) -> String {
    let Ok(meta) = fs::metadata(path) else { return "absent".to_owned() };
    let nanos = meta.modified().ok().and_then(|at| at.duration_since(UNIX_EPOCH).ok()).map_or(0, |since| since.as_nanos());
    format!("{nanos}:{}", meta.len())
}

pub(super) fn file(lexicon: &Path) -> std::path::PathBuf {
    lexicon.with_extension("built.json")
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

/// What one entry read: its digested sources, the manifests and README its purpose came from, and its skills.
pub(super) fn read_by(entry: &Entry) -> Vec<String> {
    let mut paths: Vec<String> = entry.api.sources.iter().flatten().map(|source| source.at.clone()).collect();
    for identity in [&entry.api.runtime, &entry.api.declarations].into_iter().flatten() {
        paths.push(identity.manifest.clone());
        if let Some(parent) = Path::new(&identity.manifest).parent() {
            paths.push(parent.join("README.md").to_string_lossy().into_owned());
            // The directory's stamp moves when a skill is added or removed; each file's when one is edited.
            paths.push(parent.join("skills").to_string_lossy().into_owned());
        }
    }
    paths.extend(entry.api.skills.iter().flatten().map(|skill| skill.at.clone()));
    paths
}

pub(super) fn record(root: &Path, lexicon: &Path, chain: Vec<String>, version: u8, entries: &[Entry], owners: &[Owner], manifests: &[String], carried: Option<&Built>, packages: u32, unavailable: u32) -> Built {
    let mut paths: BTreeSet<String> = entries.iter().flat_map(read_by).collect();
    // The directories an owner resolves through were listed by the refresh that made the record, and a refresh that
    // merged did not move any of them, so they are carried; one that read everything lists them again.
    match carried {
        Some(held) => paths.extend(held.stamps.iter().map(|(at, _)| at.clone())),
        None => paths.extend(directories(root, owners)),
    }
    paths.extend(manifests.iter().cloned());
    let paths: Vec<String> = paths.into_iter().collect();
    let stamps = paths.par_iter().map(|at| (at.clone(), stamp(&root.join(at)))).collect();
    Built {
        format: FORMAT, version, lexicon: stamp(lexicon), chain, stamps, packages, unavailable,
        entrypoints: entries.len() as u32,
        reusable: entries.iter().filter(|entry| entry.api.entrypoint.is_some()).count() as u32,
    }
}

/// The record a refresh left, when it is one this build reads.
pub(super) fn read(lexicon: &Path, version: u8) -> Option<Built> {
    let built: Built = serde_json::from_slice(&fs::read(file(lexicon)).ok()?).ok()?;
    (built.format == FORMAT && built.version == version && built.lexicon == stamp(lexicon)).then_some(built)
}

/// Whether the chain and every stamp are what the record holds.
pub(super) fn holds(root: &Path, built: &Built, chain: &[String]) -> bool {
    built.chain == chain && built.stamps.par_iter().all(|(at, held)| &stamp(&root.join(at)) == held)
}

impl Built {
    pub(super) fn chain(&self) -> &[String] { &self.chain }

    /// The recorded paths whose stamp is no longer what the record holds.
    pub(super) fn changed(&self, root: &Path) -> std::collections::HashSet<String> {
        self.stamps.par_iter().filter(|(at, held)| &stamp(&root.join(at)) != held).map(|(at, _)| at.clone()).collect()
    }
}
