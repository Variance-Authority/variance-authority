//! The scanning path of `@variance-authority/sense`, on one side of the boundary.
//!
//! A cold scan of a large monorepo is not slow because any one library is slow —
//! the parser is already Rust, and so is the resolver. It is slow because every
//! file's result is deserialized into JavaScript objects, walked there, and
//! resolved from there, one file at a time. This crate is where that stops: git
//! identity, the path set, parsing, extraction and resolution stay together, and
//! the boundary carries compact answers rather than a graph.
//!
//! The rule the surface below is built on is that **no per-node object crosses
//! it**. A method here returns a digest, a count, a fold, or a batch of columns.
//! Anything that would hand JavaScript one object per file or one object per
//! edge belongs on the JavaScript side, where it already exists.

#![deny(clippy::all)]

use napi_derive::napi;
use std::collections::HashMap;

mod acquire;
mod batch;
mod digest;
mod git;
mod index;
mod order;
mod path;
mod read;
mod resolve;
mod seed;
mod tree;

pub use seed::seed_files;

/// Every tracked path under a root, and the digest of the bytes on disk.
///
/// The paths are held here, sorted by code unit, and the object names as twenty
/// bytes each. A caller that wants all four hundred thousand of them as
/// JavaScript strings may have them — `paths` — but nothing in a scan needs to:
/// the questions a scan actually asks are a lookup, a fold and a filter, and all
/// three are answered without the listing leaving this side.
#[napi]
pub struct GitTree {
    paths: Vec<String>,
    oids: Vec<git::Oid>,
    at: HashMap<String, u32>,
    seeds: Vec<String>,
}

/// Every tracked path under `root`, or nothing when this is not a checkout.
///
/// `null` rather than a throw, matching `gitDigests`: the scanner's own digest is
/// correct and merely slower, so a tarball or a sandbox is a saving that did not
/// apply rather than a repository that is misconfigured.
#[napi]
pub fn git_tree(root: String) -> Option<GitTree> {
    let snapshot = git::snapshot(&root)?;
    Some(tree_from_snapshot(snapshot, Vec::new()))
}

/// Build repository identity and select the Git-visible files below configured roots.
#[napi]
pub fn git_tree_for(root: String, dirs: Vec<String>) -> Option<GitTree> {
    let snapshot = git::snapshot(&root)?;
    let seeds = seed::seed_paths(&root, &dirs, &snapshot.paths);
    Some(tree_from_snapshot(snapshot, seeds))
}

fn tree_from_snapshot(snapshot: git::Snapshot, seeds: Vec<String>) -> GitTree {
    let mut at = HashMap::with_capacity(snapshot.paths.len() * 2);
    for (index, path) in snapshot.paths.iter().enumerate() {
        at.insert(path.clone(), index as u32);
    }

    GitTree {
        paths: snapshot.paths,
        oids: snapshot.oids,
        at,
        seeds,
    }
}

#[napi]
impl GitTree {
    /// Files found below the roots supplied to `gitTreeFor`.
    #[napi]
    pub fn seeds(&self) -> Vec<String> {
        self.seeds.clone()
    }
    /// How many paths the tree holds.
    #[napi(getter)]
    pub fn size(&self) -> u32 {
        self.paths.len() as u32
    }

    /// Whether the tree holds this path.
    #[napi]
    pub fn has(&self, path: String) -> bool {
        self.at.contains_key(&path)
    }

    /// The digest of one path's bytes on disk, spelled `git:<object>`.
    #[napi]
    pub fn digest(&self, path: String) -> Option<String> {
        self.at
            .get(&path)
            .map(|index| git::spell(&self.oids[*index as usize]))
    }

    /// Digests for `paths`, in the same order; empty when the tree has no path.
    #[napi]
    pub fn digests_for(&self, paths: Vec<String>) -> Vec<String> {
        paths
            .iter()
            .map(|path| {
                self.at
                    .get(path)
                    .map_or_else(String::new, |index| git::spell(&self.oids[*index as usize]))
            })
            .collect()
    }

    /// Read tracked files from Git's pack streams and every other file from disk.
    #[napi]
    #[allow(
        clippy::too_many_arguments,
        reason = "stable positional N-API contract"
    )]
    pub fn scan_batch(
        &self,
        root: String,
        files: Vec<String>,
        largest_file: Option<u32>,
        digests: Option<bool>,
        readers: Option<u32>,
        tsconfig: Option<String>,
        condition_names: Option<Vec<String>>,
    ) -> batch::ScanBatch {
        let oids = files
            .iter()
            .map(|file| self.at.get(file).map(|index| self.oids[*index as usize]))
            .collect();
        batch::scan_batch_with_oids(
            batch::ScanOptions {
                root,
                files,
                largest_file,
                digests,
                readers,
                tsconfig,
                condition_names,
            },
            Some(oids),
            Some(&self.at),
        )
    }

    /// Follow every module reachable from `seeds` in one native operation.
    #[napi]
    #[allow(
        clippy::too_many_arguments,
        reason = "stable positional N-API contract"
    )]
    pub fn scan_graph(
        &self,
        root: String,
        seeds: Vec<String>,
        largest_file: Option<u32>,
        readers: Option<u32>,
        tsconfig: Option<String>,
        condition_names: Option<Vec<String>>,
        include_parses: Option<bool>,
    ) -> batch::ScanBatch {
        batch::scan_graph_with_tree(
            batch::GraphOptions {
                root,
                seeds,
                largest_file,
                readers,
                tsconfig,
                condition_names,
                include_parses: include_parses.unwrap_or(false),
            },
            &self.at,
            &self.oids,
        )
    }

    /// Every path, sorted by code unit.
    ///
    /// The one method that is the size of the repository. A caller wanting the
    /// whole listing as a `Map` — the published `gitDigests` shape — goes
    /// through here and pays for it; a scan does not.
    #[napi]
    pub fn paths(&self) -> Vec<String> {
        self.paths.clone()
    }

    /// Every digest, in the same order as `paths`.
    #[napi]
    pub fn digests(&self) -> Vec<String> {
        self.oids.iter().map(git::spell).collect()
    }

    /// Every path whose basename is one of `names`, or is a `tsconfig*.json`.
    ///
    /// The list is the caller's because `reuse.ts` owns it. What is not the
    /// caller's is the scan over four hundred thousand paths to apply it.
    #[napi]
    pub fn named(&self, names: Vec<String>) -> Vec<String> {
        self.paths
            .iter()
            .filter(|path| tree::named(path, &names))
            .cloned()
            .collect()
    }

    /// Every directory in the tree, named by the entries it holds.
    #[napi]
    pub fn directories(&self) -> HashMap<String, String> {
        tree::directories(&self.paths)
    }

    /// The configuration digest: the caller's header, then the tree's own part.
    ///
    /// `aliasesUnknown` is the case `reuse.ts` gives up on — no configuration
    /// bounds where a bare specifier could land, so the honest expression is the
    /// whole path set. That is the fold most worth doing here, because it is the
    /// one whose input is every path there is.
    #[napi]
    pub fn config_digest(
        &self,
        header: Vec<String>,
        names: Vec<String>,
        aliases_unknown: bool,
    ) -> String {
        tree::config_digest(
            &header,
            &self.paths,
            &self.digests(),
            &names,
            aliases_unknown,
        )
    }
}
