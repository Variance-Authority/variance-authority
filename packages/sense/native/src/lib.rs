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
use std::sync::{Arc, OnceLock};

mod acquire;
mod append_index;
mod batch;
mod case_id;
mod case_owner;
mod case_preconditions;
mod compact;
mod conditions;
mod declarations;
mod declared_role;
mod declared_roles_check;
mod depends;
mod dependency_lexicon;
mod dependency_namespace;
mod digest;
mod emitted;
mod external_dependencies;
mod help_publish;
mod help_search;
mod help_usage;
mod source_tree;
mod generation;
mod git;
mod graph_index;
#[cfg(feature = "grammars")]
mod grammar;
#[cfg(feature = "grammars")]
mod languages;
mod harvest;
mod held;
mod index;
mod index_chain;
mod index_turn;
mod instrument;
mod instrument_walk;
mod journey;
mod journey_columns;
mod journey_forks;
mod journey_format;
mod journey_graph;
mod journey_journal;
mod journey_lazy;
mod journey_loaders;
mod journey_map;
mod journey_masks;
mod journey_output;
mod journey_paths;
mod journey_query;
mod journey_read;
mod journey_record;
mod journey_select;
mod journey_stitch;
mod journeys;
mod journeys_among;
mod journeys_answer;
mod journeys_fold;
mod journeys_graph;
mod journeys_parse;
mod journeys_read;
mod journeys_record;
mod journeys_roots;
mod journeys_steps;
mod journeys_walk;
mod log;
mod louvain;
mod members;
mod mocks;
mod module_moved;
mod module_readers;
mod module_shape;
mod module_verdict;
mod order;
mod off_thread;
mod orient_map;
mod orient_map_catalogued;
mod orient_map_closure;
mod orient_map_entries;
mod orient_map_layers;
mod orient_map_shipped;
mod orient_map_pages;
mod orient_map_read;
mod orient_map_signals;
mod orient_map_tree;
mod package_flows;
mod package_graph;
mod package_owners;
mod parse_columns;
mod path;
mod promisor;
mod read;
mod ready_index;
mod record;
mod resolve;
mod seed;
mod segment;
mod side_effects;
mod source_size;
mod source_update;
mod specifier;
mod stored;
mod tree;
mod witness;
mod witness_aliases;

pub use seed::seed_files;

/// One module's parse, as JSON: the value `readBatch` answers for a file on
/// disk, for source text the caller already holds.
#[napi(catch_unwind)]
pub fn read_source(file: String, source: String) -> String {
    let read = read::read_module(&file, &source, &oxc_allocator::Allocator::default(), true);
    serde_json::to_string(&read).unwrap_or_default()
}

/// What one file of a tree-sitter language asks for and publishes, as JSON.
///
/// The AST does not cross — a `Read` is a handful of specifiers and names, the
/// same object graph every reader answers with, and no more. `null` means no
/// reader here claims that language, and the caller records the file as unknown.
#[cfg(feature = "grammars")]
#[napi(catch_unwind)]
pub fn read_language(language: String, file: String, source: String) -> Option<String> {
    let read = languages::read(&language, &file, &source)?;
    serde_json::to_string(&read).ok()
}

/// The same method on a build whose grammars did not compile: it claims nothing.
///
/// The method stays rather than disappearing, so `record.ts` has one branch for
/// it: `null` makes every file in the five languages *unknown*, with a reason
/// that names the missing grammars. Everything else this crate does — git
/// identity, the path set, the oxc parse, resolution, the journey fold — is here
/// and is what it was.
#[cfg(not(feature = "grammars"))]
#[napi(catch_unwind)]
pub fn read_language(_language: String, _file: String, _source: String) -> Option<String> {
    None
}

/// The targets a `Package.swift` declares, as JSON `[{ name, path }]`.
///
/// `null` when the manifest does not parse, or on a build without the grammars;
/// either way `swift.ts` keeps the conventional `Sources/<name>` layout.
#[cfg(feature = "grammars")]
#[napi(catch_unwind)]
pub fn swift_targets(source: String) -> Option<String> {
    let targets = languages::swift_targets(&source)?;
    serde_json::to_string(&targets).ok()
}

/// The same method on a build whose grammars did not compile: it claims nothing.
#[cfg(not(feature = "grammars"))]
#[napi(catch_unwind)]
pub fn swift_targets(_source: String) -> Option<String> {
    None
}

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
    at: Arc<HashMap<String, u32>>,
    seeds: Vec<String>,
    /// Whether git vouches that each path is a regular file, by index.
    regular: Arc<Vec<bool>>,
    /// Paths on disk git gave no digest for.
    unhashed: Vec<String>,
    /// The package manifests and `tsconfig*.json` files in each directory, made
    /// the first time a scan asks where built output comes from.
    listing: OnceLock<Arc<emitted::Listing>>,
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

fn tree_from_snapshot(snapshot: git::Snapshot, seeds: Vec<String>) -> GitTree {
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
        source_update::update(
            options,
            source_update::Tree {
                paths: &self.paths,
                at: &self.at,
                oids: &self.oids,
                seeds: &self.seeds,
                listing: self.listing(),
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
