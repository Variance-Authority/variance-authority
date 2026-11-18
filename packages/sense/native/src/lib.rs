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

use variance_sense_instrument::digest;

mod acquire;
mod append_index;
mod assigned_object;
mod batch;
mod case_fold;
mod case_id;
mod case_lines;
mod case_readings;
mod case_regions;
mod case_readings_lay;
mod case_owner;
mod case_said;
mod case_said_napi;
mod case_shard;
mod case_times;
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
#[cfg(test)]
mod git_fixture;
mod git_store;
mod git_tree;
pub use git_tree::{git_tree, git_tree_for, GitTree};
#[cfg(feature = "grammars")]
mod grammar;
mod graph_dominators;
mod graph_index;
mod harvest;
mod chain_lookup;
mod change_tree;
mod held;
#[cfg(unix)]
mod held_listing;
mod help;
use help::*;
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
mod journal_scan;
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
mod listing;
mod loads;
mod log;
mod louvain;
mod members;
mod mocks;
mod module_moved;
mod module_readers;
mod module_shape;
mod module_verdict;
mod name_table;
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
mod parse_origin;
mod parse_store;
mod path;
mod promisor;
mod read;
mod read_any;
mod read_napi;
mod read_rows;
mod span_text;
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
mod record_attempts;
mod record_parts;
mod record_start;
mod resolve;
mod resolve_export;
mod resolve_jvm;
mod resolve_python;
mod resolve_rust;
mod resolve_swift;
mod seed;
mod segment;
mod side_effects;
mod source_size;
mod source_tree;
mod source_update;
mod specifier;
mod stored;
mod style;
mod text_cut;
mod text_digests;
mod top_level;
mod tree;
#[cfg(unix)]
mod watchman;
mod witness;
mod witness_aliases;
mod world;

pub use seed::seed_files;

