//! A checkout's tracked paths and their object names, held on this side of the
//! boundary so a scan asks them questions instead of carrying the listing out.

// compass: variance-authority.reach.source-index

use napi_derive::napi;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

#[cfg(unix)]
use crate::{change_tree, held_listing};
use crate::{batch, emitted, git, graph_index, seed, source_update, tree};

/// Every tracked path under a root, and the digest of the bytes on disk.
///
/// The paths are held here, sorted by code unit, and the object names as twenty
/// bytes each. A caller that wants all four hundred thousand of them as
/// JavaScript strings may have them — `paths` — but nothing in a scan needs to:
/// the questions a scan actually asks are a lookup, a fold and a filter, and all
/// three are answered without the listing leaving this side.
#[napi]
pub struct GitTree {
    pub(crate) paths: Vec<String>,
    pub(crate) oids: Vec<git::Oid>,
    pub(crate) at: Arc<HashMap<String, u32>>,
    pub(crate) seeds: Vec<String>,
    /// Whether git vouches that each path is a regular file, by index.
    pub(crate) regular: Arc<Vec<bool>>,
    /// Paths on disk git gave no digest for.
    pub(crate) unhashed: Vec<String>,
    /// The package manifests and `tsconfig*.json` files in each directory, made
    /// the first time a scan asks where built output comes from.
    pub(crate) listing: OnceLock<Arc<emitted::Listing>>,
    /// How the tree was come by, when a change source other than git had a say.
    #[cfg(unix)]
    pub(crate) change: Option<held_listing::Change>,
}

/// Every tracked path under `root`, or nothing when this is not a checkout.
///
/// `null` rather than a throw, matching `gitDigests`: the scanner's own digest is
/// correct and merely slower, so a tarball or a sandbox is a saving that did not
/// apply rather than a repository that is misconfigured.
#[napi(catch_unwind)]
pub fn git_tree(root: String) -> Option<GitTree> {
    let snapshot = git::snapshot(&root)?;
    Some(tree_from_snapshot(snapshot, Vec::new()))
}

/// Build repository identity and select the Git-visible files below configured roots.
#[napi(catch_unwind)]
pub fn git_tree_for(root: String, dirs: Vec<String>) -> Option<GitTree> {
    let snapshot = git::snapshot(&root)?;
    let seeds = seed::seed_paths(&root, &dirs, &snapshot.paths);
    Some(tree_from_snapshot(snapshot, seeds))
}

impl GitTree {
    /// Every tracked path, in code-unit order.
    pub(crate) fn listed(&self) -> &[String] {
        &self.paths
    }

    fn listing(&self) -> Arc<emitted::Listing> {
        let made = || {
            let (at, regular) = (Arc::clone(&self.at), Arc::clone(&self.regular));
            Arc::new(emitted::Listing::of(at, regular, &self.unhashed))
        };
        Arc::clone(self.listing.get_or_init(made))
    }
}

pub(crate) fn tree_from_snapshot(snapshot: git::Snapshot, seeds: Vec<String>) -> GitTree {
    let mut at = HashMap::with_capacity(snapshot.paths.len() * 2);
    for (index, path) in snapshot.paths.iter().enumerate() {
        at.insert(path.clone(), index as u32);
    }

    GitTree {
        paths: snapshot.paths,
        oids: snapshot.oids,
        at: Arc::new(at),
        regular: Arc::new(snapshot.regular),
        unhashed: snapshot.unhashed,
        seeds,
        listing: OnceLock::new(),
        #[cfg(unix)]
        change: None,
    }
}

#[napi]
impl GitTree {
    /// Files found below the roots supplied to `gitTreeFor`.
    #[napi(catch_unwind)]
    pub fn seeds(&self) -> Vec<String> {
        self.seeds.clone()
    }
    /// How many paths the tree holds.
    #[napi(getter, catch_unwind)]
    pub fn size(&self) -> u32 {
        self.paths.len() as u32
    }

    /// Whether the tree holds this path.
    #[napi(catch_unwind)]
    pub fn has(&self, path: String) -> bool {
        self.at.contains_key(&path)
    }

    /// The digest of one path's bytes on disk, spelled `git:<object>`.
    #[napi(catch_unwind)]
    pub fn digest(&self, path: String) -> Option<String> {
        self.at
            .get(&path)
            .map(|index| git::spell(&self.oids[*index as usize]))
    }

    /// Digests for `paths`, in the same order; empty when the tree has no path.
    #[napi(catch_unwind)]
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
        tsconfig: Option<napi::Either<String, bool>>,
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
                tsconfig: crate::resolve::Tsconfig::from_js(tsconfig),
                condition_names,
            },
            Some(oids),
            Some(self.at.as_ref()),
            Some(self.listing()),
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
        tsconfig: Option<napi::Either<String, bool>>,
        condition_names: Option<Vec<String>>,
        include_parses: Option<bool>,
    ) -> batch::ScanBatch {
        batch::scan_graph_with_tree(
            batch::GraphOptions {
                root,
                seeds,
                largest_file,
                readers,
                tsconfig: crate::resolve::Tsconfig::from_js(tsconfig),
                condition_names,
                include_parses: include_parses.unwrap_or(false),
            },
            &self.at,
            &self.oids,
            self.listing(),
        )
    }

    /// Walk the module closure of `seeds` and keep it here as records and a
    /// parse layer, for a cold build that publishes from this side.
    #[napi(catch_unwind)]
    pub fn index_graph(&self, options: graph_index::IndexGraphOptions) -> napi::Result<graph_index::IndexGraph> {
        graph_index::index_graph(options, &self.at, &self.oids, self.listing())
    }

    /// Bring the source index at `options.index` up to this tree, on this
    /// side, or `null` when the JavaScript update has to (`source_update.rs`).
    #[napi(catch_unwind)]
    pub fn update_index(&self, options: source_update::UpdateOptions) -> napi::Result<Option<source_update::Updated>> {
        #[cfg(unix)]
        let carry = match change_tree::carry(&self.change, &options.config, &options.index) { Ok(carry) => carry, Err(done) => return Ok(Some(done)) };
        source_update::update(
            options,
            source_update::Tree {
                paths: &self.paths,
                at: &self.at,
                oids: &self.oids,
                seeds: &self.seeds,
                listing: self.listing(),
                regular: &self.regular,
                unhashed: &self.unhashed,
                #[cfg(unix)]
                carry,
            },
        )
    }

    /// Every path, sorted by code unit.
    ///
    /// The one method that is the size of the repository. A caller wanting the
    /// whole listing as a `Map` — the published `gitDigests` shape — goes
    /// through here and pays for it; a scan does not.
    #[napi(catch_unwind)]
    pub fn paths(&self) -> Vec<String> {
        self.paths.clone()
    }

    /// Every digest, in the same order as `paths`.
    #[napi(catch_unwind)]
    pub fn digests(&self) -> Vec<String> {
        self.oids.iter().map(git::spell).collect()
    }

    /// Every path whose basename is one of `names`, or is a `tsconfig*.json`.
    ///
    /// The list is the caller's because `reuse.ts` owns it. What is not the
    /// caller's is the scan over four hundred thousand paths to apply it.
    #[napi(catch_unwind)]
    pub fn named(&self, names: Vec<String>) -> Vec<String> {
        self.paths
            .iter()
            .filter(|path| tree::named(path, &names))
            .cloned()
            .collect()
    }

    /// Every directory in the tree, named by the entries it holds.
    #[napi(catch_unwind)]
    pub fn directories(&self) -> HashMap<String, String> {
        tree::directories(&self.paths)
    }

    /// The configuration digest: the caller's header, then the tree's own part.
    ///
    /// `aliasesUnknown` is the case `reuse.ts` gives up on — no configuration
    /// bounds where a bare specifier could land, so the honest expression is the
    /// whole path set. That is the fold most worth doing here, because it is the
    /// one whose input is every path there is.
    #[napi(catch_unwind)]
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
