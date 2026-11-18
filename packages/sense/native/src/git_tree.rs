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
    /// The parse stores the last scan named, read once for every frontier of it.
    pub(crate) stores: std::sync::Mutex<Option<(Vec<String>, Arc<parse_store::Stores>)>>,
    /// The parses this tree's reads made from the blob each is kept under.
    pub(crate) from_blob: parse_origin::FromBlob,
    /// The object store this tree's scans read from, once they have read enough.
    pub(crate) store: acquire::TreeObjects,
    /// Every file on disk, for a directory git does not list: what the
    /// languages that resolve over the tree ask about (`disk_tree`).
    pub(crate) disk: Option<(Arc<HashMap<String, u32>>, Vec<String>)>,
    /// How the tree was come by, when a change source other than git had a say.
    #[cfg(unix)]
    pub(crate) change: Option<held_listing::Change>,
}

/// How many times an update reads the chain again after another writer published over the one it read.
const WRITER_ATTEMPTS: u32 = 4;

/// Every tracked path under `root`, or nothing when this is not a checkout.
///
/// `null` rather than a throw, matching `gitDigests`: whether a directory git
/// does not list is an error is the caller's to say, and the index refuses it.
#[napi(catch_unwind)]
pub fn git_tree(root: String) -> Option<GitTree> {
    let snapshot = git::snapshot(&root)?;
    Some(tree_from_snapshot(snapshot, Vec::new()))
}

/// Build repository identity and select the Git-visible files below configured roots.
#[napi(catch_unwind)]
pub fn git_tree_for(root: String, dirs: Vec<String>) -> Option<GitTree> {
    let snapshot = git::snapshot(&root)?;
    let seeds = seed::seeds_of(&root, &dirs, &snapshot);
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
        stores: std::sync::Mutex::new(None),
        from_blob: parse_origin::FromBlob::default(),
        store: acquire::TreeObjects::default(),
        disk: None,
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
        stores: Option<Vec<String>>,
        records: Option<crate::record::RecordOptions>,
    ) -> napi::Result<batch::ScanBatch> {
        let oids = files
            .iter()
            .map(|file| self.at.get(file).map(|index| self.oids[*index as usize]))
            .collect();
        let stores = self.stores(stores);
        let opened = stores.as_deref().map(parse_store::Stores::open);
        let kept = |identity: &str, file: &str| opened.as_ref()?.view(identity, &index::way(file))?.read();
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
            batch::Tree { known: Some(self.at.as_ref()), world: Some(self.at.as_ref()), oids: &self.oids },
            Some(self.listing()),
            &kept,
            &self.from_blob,
            &self.store,
            records,
        )
    }

    /// The parses the stores at `stores` hold for `files` at `digests`, from the
    /// reading the scan answered `kept` from, so a row it kept is handed over
    /// even when another root has published the stores since.
    #[napi]
    pub fn kept_parses(&self, stores: Vec<String>, files: Vec<String>, digests: Vec<String>) -> napi::bindgen_prelude::Buffer {
        let Some(stores) = self.stores(Some(stores)) else { return Vec::new().into() };
        let wanted = digests.into_iter().zip(&files).map(|(digest, file)| (digest, index::way(file)));
        stores.open().segment(wanted).into()
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
        records: Option<crate::record::RecordOptions>,
    ) -> napi::Result<batch::ScanBatch> {
        let stores = self.stores(stores);
        let opened = stores.as_deref().map(parse_store::Stores::open);
        let kept = |identity: &str, file: &str| opened.as_ref()?.view(identity, &index::way(file))?.read();
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
            &kept,
            &self.from_blob,
            &self.store,
            records,
        )
    }

    /// Walk the module closure of `seeds` and keep it here as records and a
    /// parse layer, for a cold build that publishes from this side.
    #[napi(catch_unwind)]
    pub fn index_graph(&self, mut options: graph_index::IndexGraphOptions) -> napi::Result<graph_index::IndexGraph> {
        let stores = self.stores(options.stores.take());
        let opened = stores.as_deref().map(parse_store::Stores::open);
        graph_index::index_graph(options, &self.at, &self.oids, self.listing(), opened.as_ref(), &self.from_blob, &self.store)
    }

    /// Bring the source index at `options.index` up to this tree, on this
    /// side (`source_update.rs`).
    #[napi(catch_unwind)]
    pub fn update_index(&self, options: source_update::UpdateOptions) -> napi::Result<source_update::Updated> {
        // Open is timed from here: the carry reads the index, and a retry opens it again.
        let opening = std::cell::Cell::new(Some(crate::stages::start("open")));
        let open = || opening.take().unwrap_or_else(|| crate::stages::start("open"));
        #[cfg(unix)]
        let carry = match change_tree::carry(&self.change, &options.config, &options.index) {
            Ok(carry) => carry,
            Err(done) => {
                open().end();
                return Ok(done);
            }
        };
        let disk = acquire::TreeObjects::disk();
        let store = if options.packs == Some(false) { &disk } else { &self.store };
        let tree = || source_update::Tree {
            paths: &self.paths,
            at: &self.at,
            oids: &self.oids,
            seeds: &self.seeds,
            listing: self.listing(),
            regular: &self.regular,
            unhashed: &self.unhashed,
            world: self.disk.as_ref().map_or((&*self.at, &self.paths[..]), |(at, paths)| (&**at, &paths[..])),
            from_blob: &self.from_blob,
            store,
            #[cfg(unix)]
            carry: carry.clone(),
        };
        // A segment of the published length is read unhashed, so damaged bytes in it can panic a read:
        // the index is then rebuilt from the tree, as any other chain it cannot stand on is. The
        // rebuild reads nothing from the chain, so a panic it repeats is no damage and is the error;
        // the first panic's message is printed, since the rebuild alone cannot name it.
        let once = |trusted: bool| match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| source_update::update(options.clone(), tree(), trusted, open()))) {
            Ok(done) => done,
            Err(panic) => {
                let message = panic.downcast_ref::<&str>().map(|text| text.to_string()).or_else(|| panic.downcast_ref::<String>().cloned()).unwrap_or_default();
                eprintln!("variance: an update standing on the source index panicked ({message}); rebuilding it from the tree");
                source_update::update(options.clone(), tree(), false, open())
            }
        };
        // A writer that lost the race reads the chain the winner published and makes its delta
        // against that: each loss is another writer's publication, so a few attempts settle it,
        // and the last loss is reported as refused.
        let mut attempts = 1;
        loop {
            let (updated, lost) = once(true)?;
            if !lost || attempts == WRITER_ATTEMPTS {
                return Ok(updated);
            }
            attempts += 1;
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

#[cfg(all(test, unix))]
#[path = "git_tree_writers_tests.rs"]
mod writers_tests;
