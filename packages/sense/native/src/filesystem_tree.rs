//! A native filesystem listing for source outside Git, without pre-reading source bytes.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use sha2::{Digest as _, Sha256};

use crate::{acquire, git_tree::GitTree, seed, tree};

/// A native source tree listed from disk, with identities supplied by its later reads.
#[napi_derive::napi(catch_unwind)]
pub fn filesystem_tree(root: String, dirs: Vec<String>) -> GitTree {
    tree(root, &dirs)
}

pub(crate) fn tree(root: String, dirs: &[String]) -> GitTree {
    let paths = seed::listed_files(root.clone(), dirs);
    let seeds = seed::seed_paths(&root, dirs, &paths);
    source_tree(root, paths, seeds)
}

/// The caller's exact source membership and seeds, with source bytes acquired natively.
#[napi_derive::napi(catch_unwind)]
pub fn source_tree(root: String, mut paths: Vec<String>, seeds: Vec<String>) -> GitTree {
    paths.sort_by(|left, right| crate::order::code_unit(left, right));
    paths.dedup();
    let at = paths.iter().enumerate().map(|(index, path)| (path.clone(), index as u32)).collect::<HashMap<_, _>>();
    let regular = vec![false; paths.len()];
    GitTree {
        root: std::fs::canonicalize(&root).unwrap_or_else(|_| root.clone().into()),
        filesystem_root: Some(root), paths, oids: Arc::new(Vec::new()), at: Arc::new(at), seeds,
        regular: Arc::new(regular), unhashed: Vec::new(), listing: OnceLock::new(),
        stores: std::sync::Mutex::new(None), from_blob: crate::parse_origin::FromBlob::default(),
        store: Arc::new(acquire::TreeObjects::worktree()),
        #[cfg(unix)]
        change: None,
    }
}

/// Only configuration bytes are opened here; acquisition reads source content once.
pub(crate) fn config_digest(root: &str, paths: &[String], mut header: Vec<String>, names: &[String], aliases_unknown: bool) -> String {
    header.push("listed by filesystem".to_owned());
    tree::config_digest(&header, paths, |at| {
        std::fs::read(std::path::Path::new(root).join(&paths[at])).map_or_else(
            |_| "unreadable".to_owned(),
            |bytes| crate::digest::of_sha256(Sha256::digest(bytes).as_slice()),
        )
    }, names, aliases_unknown)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn records(graph: &crate::graph_index::IndexGraph) -> Vec<crate::record::FileRecord> {
        let bytes = graph.encode(Vec::new()).unwrap();
        let layer = crate::compact::Layer::open(bytes.as_ref()).unwrap();
        (0..layer.records.file.len()).map(|row| layer.records.indexed(&layer.stored, row).record).collect()
    }

    #[test]
    fn filesystem_paths_have_membership_without_claiming_a_content_identity() {
        let root = std::env::temp_dir().join(format!("variance-filesystem-tree-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("Cargo.toml"), "[package]\nname = 'plain'\n").unwrap();
        std::fs::write(root.join("package.json"), "{\"name\":\"one\"}").unwrap();
        std::fs::write(root.join("src/lib.rs"), "pub fn call() {}\n").unwrap();
        let listed = tree(root.to_str().unwrap().to_owned(), &["src".to_owned()]);
        assert!(listed.filesystem());
        assert!(listed.has("Cargo.toml".to_owned()));
        assert_eq!(listed.digest("src/lib.rs".to_owned()), None);
        assert_eq!(listed.digests(), vec!["", "", ""]);
        assert_eq!(listed.seeds(), vec!["src/lib.rs"]);
        let config = || listed.config_digest(Vec::new(), vec!["package.json".to_owned()], false);
        let before = config();
        std::fs::write(root.join("package.json"), "{\"name\":\"two\"}").unwrap();
        assert_ne!(config(), before, "configuration bytes participate without Git");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn explicitly_selected_directories_keep_their_files_and_manifests() {
        let root = std::env::temp_dir().join(format!("variance-filesystem-explicit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for directory in ["src", "build", "nested/.git"] {
            std::fs::create_dir_all(root.join(directory)).unwrap();
        }
        for file in ["src/ordinary.ts", "build/entry.ts", "nested/entry.ts"] {
            std::fs::write(root.join(file), "export const value = 1;\n").unwrap();
        }
        for file in ["build/Cargo.toml", "nested/Cargo.toml"] {
            std::fs::write(root.join(file), "[package]\nname = 'explicit'\n").unwrap();
        }
        let listed = tree(root.to_str().unwrap().to_owned(), &["build".to_owned(), "nested".to_owned()]);
        assert_eq!(listed.seeds(), vec!["build/entry.ts", "nested/entry.ts"]);
        assert!(listed.has("build/Cargo.toml".to_owned()));
        assert!(listed.has("nested/Cargo.toml".to_owned()));
        assert!(listed.has("src/ordinary.ts".to_owned()), "the full root still supplies language membership");
        let ordinary = tree(root.to_str().unwrap().to_owned(), &[".".to_owned()]);
        assert_eq!(ordinary.seeds(), vec!["src/ordinary.ts"], "implicit descendants retain the walk's exclusions");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_supplied_tree_keeps_membership_identities_and_the_follow_boundary() {
        let root = std::env::temp_dir().join(format!("variance-supplied-tree-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let root = std::fs::canonicalize(root).unwrap();
        std::fs::write(root.join("a.ts"), "import { b } from './b'; export const a = b;\n").unwrap();
        std::fs::write(root.join("b.ts"), "export const b = 1;\n").unwrap();
        std::fs::write(root.join("unlisted.ts"), "export const hidden = 1;\n").unwrap();
        let paths = vec!["b.ts".to_owned(), "a.ts".to_owned()];
        let tree = source_tree(root.to_str().unwrap().to_owned(), paths, vec!["a.ts".to_owned()]);
        assert_eq!(tree.paths(), vec!["a.ts", "b.ts"]);
        assert!(!tree.has("unlisted.ts".to_owned()));
        for follow in [false, true] {
            let graph = tree.index_graph(crate::graph_index::IndexGraphOptions {
                root: root.to_str().unwrap().to_owned(), seeds: tree.seeds(), largest_file: None,
                readers: None, packs: Some(false), tsconfig: Some(napi::Either::B(false)),
                condition_names: None, remembering: false, aliases: None, builtins: Vec::new(),
                code_extensions: vec![".ts".to_owned()], directories: Vec::new(), stores: None,
                identities: Some(HashMap::from([("a.ts".to_owned(), "v1:caller-a".to_owned()), ("b.ts".to_owned(), "git:caller-b".to_owned())])),
                follow: Some(follow), prior_parses: None,
            }, None).unwrap();
            let rows = records(&graph);
            assert_eq!(rows[0].digest.as_deref(), Some("v1:caller-a"));
            assert!(graph.has_parse(crate::parse_store::key("v1:caller-a", &crate::index::way("a.ts"))));
            assert_eq!(graph.size(), if follow { 2 } else { 1 });
            if follow {
                assert_eq!(rows[1].digest.as_deref(), Some("git:caller-b"));
                assert!(graph.has_parse(crate::parse_store::key("git:caller-b", &crate::index::way("b.ts"))));
                assert!(graph.following().is_empty());
            } else {
                assert_eq!(graph.following(), vec!["b.ts"]);
                assert_eq!(rows[0].edges.as_ref().unwrap()[0].to, "b.ts");
            }
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_supplied_identity_reuses_its_whole_native_parse_without_opening_source() {
        let root = std::env::temp_dir().join(format!("variance-supplied-cache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let root = std::fs::canonicalize(root).unwrap();
        let allocator = oxc_allocator::Allocator::default();
        let read = crate::source_read::SourceRead::read("a.ts", "/** Named doc. */\nexport function named() {}\n", &allocator, true);
        let key = crate::parse_store::key("v1:caller", &crate::index::way("a.ts"));
        let prior = crate::index::parses_only(&[(&key, &read)]);
        let tree = source_tree(root.to_str().unwrap().to_owned(), vec!["a.ts".to_owned()], vec!["a.ts".to_owned()]);
        let graph = tree.index_graph(crate::graph_index::IndexGraphOptions {
            root: root.to_str().unwrap().to_owned(), seeds: tree.seeds(), largest_file: None,
            readers: None, packs: Some(false), tsconfig: Some(napi::Either::B(false)),
            condition_names: None, remembering: false, aliases: None, builtins: Vec::new(),
            code_extensions: vec![".ts".to_owned()], directories: Vec::new(), stores: None,
            identities: Some(HashMap::from([("a.ts".to_owned(), "v1:caller".to_owned())])),
            follow: None, prior_parses: Some(prior.clone().into()),
        }, None).unwrap();
        assert_eq!(graph.parsed(), 0, "the source file does not exist: the caller's cache answers");
        assert_eq!(graph.parse_segment().as_ref(), prior.as_slice(), "a kept row preserves every parse fact");
        let rows = records(&graph);
        assert_eq!(rows[0].digest.as_deref(), Some("v1:caller"));
        assert_eq!(rows[0].unknown, None);
        std::fs::remove_dir_all(root).unwrap();
    }
}
