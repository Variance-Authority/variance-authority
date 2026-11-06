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
use variance_sense_instrument::digest;

mod acquire;
mod append_index;
mod assigned_object;
mod batch;
mod case_fold;
mod case_id;
mod case_lines;
mod case_owner;
mod case_said;
mod case_said_napi;
mod case_shard;
mod commit_text;
mod compact;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod large_alloc;

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[global_allocator]
static ALLOCATOR: large_alloc::Mapped = large_alloc::Mapped;
mod conditions;
mod coverage_rows;
mod crossing_sets;
mod declarations;
mod declared_role;
mod declared_roles_check;
mod dependency_lexicon;
mod dependency_namespace;
mod depends;
mod distill_cases;
mod distill_gather;
mod distill_own;
mod distill_rank;
mod distill_read;
mod emitted;
mod external_dependencies;
mod generation;
mod git;
mod git_tree;
#[cfg(feature = "grammars")]
mod grammar;
mod graph_dominators;
mod graph_index;
mod harvest;
mod change_tree;
mod held;
#[cfg(unix)]
mod held_listing;
mod help_aliases;
mod help_declared;
mod help_in_file;
mod help_member_uses;
mod help_members;
mod help_origin;
mod help_own_uses;
mod help_publish;
mod help_search;
mod help_usage;
mod index;
mod index_chain;
mod index_turn;
mod instrument;
mod journey;
mod journey_columns;
mod journey_compose;
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
#[cfg(feature = "grammars")]
mod languages;
mod lfs;
mod loads;
mod log;
mod louvain;
mod members;
mod mocks;
mod module_moved;
mod module_readers;
mod module_shape;
mod module_verdict;
mod nested;
mod off_thread;
mod order;
mod orient_map;
mod orient_map_catalogued;
mod orient_map_closure;
mod orient_map_entries;
mod orient_map_layers;
mod orient_map_pages;
mod orient_map_read;
mod orient_map_shipped;
mod orient_map_signals;
mod orient_map_tree;
mod package_flows;
mod package_graph;
mod package_owners;
mod parse_columns;
mod path;
mod promisor;
mod read;
mod read_shape;
mod ready_index;
mod record;
mod record_combine;
mod record_coverage;
mod record_coverage_address;
mod record_coverage_columns;
mod record_coverage_dictionary;
mod record_coverage_fold;
mod record_coverage_layer;
mod record_coverage_recut;
#[cfg(test)]
mod record_fixture;
mod record_layout;
mod record_parts;
mod record_start;
mod resolve;
mod resolve_export;
mod seed;
mod segment;
mod side_effects;
mod source_size;
mod source_tree;
mod source_update;
mod specifier;
mod stored;
mod test_blocks;
mod text_digests;
mod top_level;
mod tree;
#[cfg(unix)]
mod watchman;
mod witness;
mod witness_aliases;

pub use git_tree::{git_tree, git_tree_for, GitTree};
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
