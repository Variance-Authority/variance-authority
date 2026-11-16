//! The git tree a scan, an update and a question are made against: every
//! tracked path under a root and the digest of its bytes on disk, held on this
//! side and answered from here.

use napi_derive::napi;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use crate::{acquire, batch, emitted, git, graph_index, index, parse_origin, parse_store, seed, source_update, tree};
#[cfg(unix)]
use crate::{change_tree, held_listing};

/// Every tracked path under a root, and the digest of the bytes on disk.
///
/// The paths are held here, sorted by code unit, and the object names as twenty
/// bytes each. A caller that wants all four hundred thousand of them as
/// JavaScript strings may have them — `paths` — but nothing in a scan needs to:
/// the questions a scan actually asks are a lookup, a fold and a filter, and all
/// three are answered without the listing leaving this side.
#[napi]
pub struct GitTree {
    /// A filesystem listing has paths but no content identity before acquisition.
    pub(crate) filesystem_root: Option<String>,
    pub(crate) root: std::path::PathBuf,
    pub(crate) paths: Vec<String>,
    pub(crate) oids: Arc<Vec<git::Oid>>,
    pub(crate) at: Arc<HashMap<String, u32>>,
    pub(crate) seeds: Vec<String>,
    /// Whether git vouches that each path is a regular file, by index.
    pub(crate) regular: Arc<Vec<bool>>,
    /// Paths on disk git gave no digest for.
    pub(crate) unhashed: Vec<String>,
    /// The package manifests and `tsconfig*.json` files in each directory, made
    /// the first time a scan asks where built output comes from.
    pub(crate) listing: OnceLock<Arc<emitted::Listing>>,
    /// The parse stores the last scan named, read once for every frontier of it.
    pub(crate) stores: std::sync::Mutex<Option<(Vec<String>, Arc<parse_store::Stores>)>>,
    /// The parses this tree's reads made from the blob each is kept under.
    pub(crate) from_blob: parse_origin::FromBlob,
    /// The object store this tree's scans read from, once they have read enough.
    pub(crate) store: Arc<acquire::TreeObjects>,
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
    Some(tree_from_snapshot(&root, snapshot, Vec::new()))
}

/// Build repository identity and select the Git-visible files below configured roots.
#[napi(catch_unwind)]
pub fn git_tree_for(root: String, dirs: Vec<String>) -> Option<GitTree> {
    let snapshot = git::snapshot(&root)?;
    let seeds = seed::seeds_of(&root, &dirs, &snapshot);
    Some(tree_from_snapshot(&root, snapshot, seeds))
}

impl GitTree {
    /// Every tracked path, in code-unit order.
    pub(crate) fn listed(&self) -> &[String] {
        &self.paths
    }

    pub(crate) fn listing(&self) -> Arc<emitted::Listing> {
        let made = || {
            let (at, regular) = (Arc::clone(&self.at), Arc::clone(&self.regular));
            Arc::new(emitted::Listing::of(at, regular, &self.unhashed).with_content(self.root.clone(), Arc::clone(&self.oids), Arc::clone(&self.store)))
        };
        Arc::clone(self.listing.get_or_init(made))
    }

    /// The stores at `paths`, read the first time a scan names them: a scan
    /// asks once per frontier, and what it adds is published after it.
    fn stores(&self, paths: Option<Vec<String>>) -> Option<Arc<parse_store::Stores>> {
        let paths = paths.filter(|paths| !paths.is_empty())?;
        let mut held = self.stores.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some((named, stores)) = held.as_ref() {
            if *named == paths {
                return Some(Arc::clone(stores));
            }
        }
        let stores = Arc::new(parse_store::Stores::read(&paths));
        *held = Some((paths, Arc::clone(&stores)));
        Some(stores)
    }
}

pub(crate) fn tree_from_snapshot(root: &str, snapshot: git::Snapshot, seeds: Vec<String>) -> GitTree {
    let mut at = HashMap::with_capacity(snapshot.paths.len() * 2);
    for (index, path) in snapshot.paths.iter().enumerate() {
        at.insert(path.clone(), index as u32);
    }

    GitTree {
        filesystem_root: None,
        root: std::fs::canonicalize(root).unwrap_or_else(|_| root.into()),
        paths: snapshot.paths,
        oids: Arc::new(snapshot.oids),
        at: Arc::new(at),
        regular: Arc::new(snapshot.regular),
        unhashed: snapshot.unhashed,
        seeds,
        listing: OnceLock::new(),
        stores: std::sync::Mutex::new(None),
        from_blob: parse_origin::FromBlob::default(),
        store: Arc::new(acquire::TreeObjects::default()),
        #[cfg(unix)]
        change: None,
    }
}

#[napi]
impl GitTree {
    /// The paths came from the filesystem and have no Git content identities.
    #[napi(getter)]
    pub fn filesystem(&self) -> bool {
        self.filesystem_root.is_some()
    }
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
            .and_then(|index| self.oids.get(*index as usize))
            .map(git::spell)
    }

    /// Digests for `paths`, in the same order; empty when the tree has no path.
    #[napi(catch_unwind)]
    pub fn digests_for(&self, paths: Vec<String>) -> Vec<String> {
        paths
            .iter()
            .map(|path| {
                self.at
                    .get(path)
                    .and_then(|index| self.oids.get(*index as usize))
                    .map_or_else(String::new, git::spell)
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
        stores: Option<Vec<String>>,
    ) -> batch::ScanBatch {
        let oids = files
            .iter()
            .map(|file| self.at.get(file).and_then(|index| self.oids.get(*index as usize)).copied())
            .collect();
        let stores = self.stores(stores);
        let opened = stores.as_deref().map(parse_store::Stores::open);
        let kept = |identity: &str, file: &str| opened.as_ref()?.view(identity, &index::way(file))?.source_read(file);
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
            &kept,
            &self.from_blob,
            &self.store,
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
        stores: Option<Vec<String>>,
    ) -> batch::ScanBatch {
        let stores = self.stores(stores);
        let opened = stores.as_deref().map(parse_store::Stores::open);
        let kept = |identity: &str, file: &str| opened.as_ref()?.view(identity, &index::way(file))?.source_read(file);
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
            &self.paths,
            &self.at,
            &self.oids,
            self.listing(),
            &kept,
            &self.from_blob,
            &self.store,
        )
    }

    /// Walk the module closure of `seeds` and keep it here as records and a
    /// parse layer, for a cold build that publishes from this side.
    #[napi(catch_unwind)]
    pub fn index_graph(&self, mut options: graph_index::IndexGraphOptions, session: Option<&crate::scan_session::ScanSession>) -> napi::Result<graph_index::IndexGraph> {
        let stores = self.stores(options.stores.take());
        let opened = stores.as_deref().map(parse_store::Stores::open);
        let state = session.map(|session| session.hold(&options.root, options.largest_file, options.packs, &self.at)).transpose()?;
        let fresh = crate::scan_session::State::default();
        let state = state.as_deref().unwrap_or(&fresh);
        graph_index::index_graph(options, &self.paths, &self.at, &self.oids, self.listing(), opened.as_ref(), &self.from_blob, &self.store, state)
    }

    /// Bring the source index at `options.index` up to this tree, on this
    /// side, or `null` when it could not complete (`source_update.rs`).
    #[napi(catch_unwind)]
    pub fn update_index(&self, options: source_update::UpdateOptions) -> napi::Result<Option<source_update::Updated>> {
        #[cfg(unix)]
        let carry = match change_tree::carry(&self.change, &options.config, &options.index) { Ok(carry) => carry, Err(done) => return Ok(Some(done)) };
        let worktree = acquire::TreeObjects::worktree();
        let store = if options.packs == Some(false) { &worktree } else { self.store.as_ref() };
        let tree = source_update::Tree {
            paths: &self.paths,
            at: &self.at,
            oids: &self.oids,
            seeds: &self.seeds,
            listing: self.listing(),
            regular: &self.regular,
            unhashed: &self.unhashed,
            from_blob: &self.from_blob,
            store,
            #[cfg(unix)]
            carry,
        };
        // A same-length damaged segment can pass framing and fail when a row
        // is read. Rebuild against its original publication on this side.
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| source_update::update(options.clone(), tree.clone()))) {
            Ok(updated) => updated,
            Err(_) => source_update::rebuild(options, tree),
        }
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
        if self.filesystem_root.is_some() { return vec![String::new(); self.paths.len()] }
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

    /// The alias configurations read from this tree's shared content owner.
    #[napi(catch_unwind)]
    pub fn aliases_in(&self, paths: Vec<String>) -> Option<crate::witness_aliases::AliasesRead> {
        crate::witness_aliases::read_from(self.root.to_str()?, &paths, Some(self.listing()))
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
        if let Some(root) = &self.filesystem_root {
            return crate::filesystem_tree::config_digest(root, &self.paths, header, &names, aliases_unknown);
        }
        tree::config_digest(
            &header,
            &self.paths,
            |at| git::spell(&self.oids[at]),
            &names,
            aliases_unknown,
        )
    }
}
