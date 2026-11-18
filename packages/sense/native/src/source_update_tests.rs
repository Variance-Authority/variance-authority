//! Source publication through native Git and filesystem trees.

use super::UpdateOptions;
use crate::git_fixture::{repository, write};

#[path = "source_update_declines_tests.rs"]
mod declines;

#[path = "git_tree_marks_tests.rs"]
mod marks;

fn options(root: &std::path::Path, index: &std::path::Path, config: &str) -> UpdateOptions {
    UpdateOptions {
        root: root.to_str().unwrap().to_owned(), index: index.to_str().unwrap().to_owned(),
        config: config.to_owned(), largest_file: None, readers: None, packs: None, prepare_map: None,
        tsconfig: None, condition_names: None, aliases: None,
        builtins: Vec::new(), code_extensions: vec![".ts".to_owned()], readable: vec![".ts".to_owned()], stores: None,
    }
}

#[test]
fn git_tree_dirty_untracked_and_symbolic_sources_keep_their_worktree_boundary() {
    let root = repository("source-git-overlay-bytes", &[
        ("src/main.ts", b"export const before = 1;\n"),
        ("src/target.ts", b"export const target = 1;\n"),
    ]);
    std::os::unix::fs::symlink("target.ts", root.join("src/link.ts")).unwrap();
    crate::git_fixture::commit(&root);
    write(&root, "src/main.ts", b"import { added } from './new';\nexport const after = added;\n");
    write(&root, "src/new.ts", b"export const added = 2;\n");
    let root_name = root.to_str().unwrap().to_owned();
    let tree = crate::git_tree_for(root_name.clone(), vec!["src".to_owned()]).unwrap();
    tree.store.objects_now(&root).unwrap();
    let files = vec!["src/main.ts".to_owned(), "src/new.ts".to_owned(), "src/link.ts".to_owned()];
    for file in &files { assert!(!tree.regular[*tree.at.get(file).unwrap() as usize]); }
    let batch = tree.scan_batch(root_name.clone(), files, Some(1024), Some(true), None, None, None, None);
    assert_eq!(batch.parsed.as_ref(), &[1, 1, 1], "computed identities need worktree bytes, not missing Git objects");
    assert!(batch.parses[0].contains("after") && !batch.parses[0].contains("before"));
    assert!(batch.parses[1].contains("added"));
    assert!(batch.parses[2].contains("target"));
    let index = root.join("cache/index.bin");
    let update = tree.update_index(options(&root, &index, "overlay")).unwrap().unwrap();
    assert_eq!((update.files, update.parsed), (4, 4));
    let chain = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    let layer = crate::compact::Layer::open(chain.segments.last().unwrap()).unwrap();
    assert_eq!(layer.records.file.len(), 4, "the source update publishes every listed source record");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn cold_publications_are_immutable_bases_and_edits_form_one_working_layer() {
    let root = repository("source-update-base", &[("src/a.ts", b"export const value = 1;\n")]);
    let index = root.join("cache/index.bin");
    let opts = options(&root, &index, "one");
    let root_name = opts.root.clone();
    let tree = || crate::git_tree_for(root_name.clone(), vec!["src".to_owned()]).unwrap();
    let first = tree().update_index(opts.clone()).unwrap().unwrap();
    assert_eq!((first.files, first.parsed), (1, 1));
    let base = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    assert_eq!((base.references.len(), base.working), (2, 0));
    let parses = crate::compact::Layer::open(&base.segments[0]).unwrap();
    let metadata = crate::compact::Layer::open(&base.segments[1]).unwrap();
    assert_eq!((parses.parses.key.len(), parses.records.file.len(), parses.config), (1, 0, None));
    assert_eq!((metadata.parses.key.len(), metadata.records.file.len(), metadata.config), (0, 1, Some("one")));
    write(&root, "src/a.ts", b"export const value = 2;\n");
    tree().update_index(opts).unwrap().unwrap();
    let edited = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    assert_eq!((edited.references.len(), edited.working), (3, 1));
    assert_eq!(edited.segments[..2], base.segments);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_configuration_change_keeps_byte_keyed_parses_without_a_shared_store() {
    let root = repository("source-update-config", &[("src/a.ts", b"export function value() { return 1; }\n")]);
    let index = root.join("cache/index.bin");
    let first = options(&root, &index, "one");
    let tree = crate::git_tree_for(first.root.clone(), vec!["src".to_owned()]).unwrap();
    assert_eq!(tree.update_index(first).unwrap().unwrap().parsed, 1);
    let base = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    let next = tree.update_index(options(&root, &index, "two")).unwrap().unwrap();
    assert_eq!((next.files, next.reread, next.parsed), (1, 1, 0));
    let chain = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    assert_eq!((chain.references.len(), chain.working), (3, 1), "configuration invalidates record reuse, not the immutable base");
    assert_eq!(chain.references[0].digest, base.references[0].digest);
    let layers: Vec<_> = chain.segments.iter().map(|bytes| crate::compact::Layer::open(bytes).unwrap()).collect();
    assert_eq!(layers[0].parses.key.len(), 1, "the base retains the pure parse");
    assert_eq!(layers[2].parses.key.len(), 0, "the working layer reuses that parse");
    assert_eq!(layers[2].config, Some("two"));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_configuration_change_with_narrower_seeds_deletes_old_records_over_the_same_base() {
    let root = repository("source-update-config-scope", &[
        ("src/a.ts", b"export const a = 1;\n"),
        ("other/b.ts", b"export const b = 2;\n"),
    ]);
    let index = root.join("cache/index.bin");
    let first = options(&root, &index, "wide");
    let tree = crate::git_tree_for(first.root.clone(), vec!["src".to_owned(), "other".to_owned()]).unwrap();
    assert_eq!(tree.update_index(first).unwrap().unwrap().files, 2);
    let base = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    let next = options(&root, &index, "narrow");
    let tree = crate::git_tree_for(next.root.clone(), vec!["src".to_owned()]).unwrap();
    let update = tree.update_index(next).unwrap().unwrap();
    assert_eq!((update.files, update.reread, update.parsed), (1, 1, 0));
    let chain = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    assert_eq!((chain.references.len(), chain.working), (3, 1));
    assert_eq!(chain.references[0].digest, base.references[0].digest);
    let layers: Vec<_> = chain.segments.iter().map(|bytes| crate::compact::Layer::open(bytes).unwrap()).collect();
    let files = crate::chain_lookup::fold(&layers);
    assert_eq!(files.len(), 1);
    assert!(files.contains_key("src/a.ts"));
    assert!(!files.contains_key("other/b.ts"), "keeping the base must not keep records outside the new closure");
    assert_eq!(layers[2].records.deleted.len(), 1);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn filesystem_publication_follows_a_closure_outside_the_seed_directories() {
    let root = std::env::temp_dir().join(format!("sense-source-update-filesystem-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    write(&root, "src/a.ts", b"import { value } from '../lib/b';\nexport { value };\n");
    write(&root, "lib/b.ts", b"export const value = 1;\n");
    let root = std::fs::canonicalize(root).unwrap();
    let index = root.join("cache/index.bin");
    let opts = options(&root, &index, "filesystem");
    let tree = crate::filesystem_tree::tree(opts.root.clone(), &["src".to_owned()]);
    let update = tree.update_index(opts).unwrap().unwrap();
    assert_eq!((update.files, update.reread, update.parsed), (2, 2, 2));
    let chain = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    assert_eq!((chain.references.len(), chain.working), (3, 0));
    let layer = crate::compact::Layer::open(chain.segments.last().unwrap()).unwrap();
    assert_eq!(layer.records.file.len(), 2);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn filesystem_updates_reuse_content_keyed_parses_after_reading_unchanged_bytes() {
    let root = repository("source-update-filesystem-parses", &[
        ("src/a.ts", b"import { value } from '../lib/b';\nexport { value };\n"),
        ("lib/b.ts", b"export const value = 1;\n"),
    ]);
    let index = root.join("cache/index.bin");
    let opts = options(&root, &index, "filesystem");
    let tree = crate::filesystem_tree::tree(opts.root.clone(), &["src".to_owned()]);
    let first = tree.update_index(opts.clone()).unwrap().unwrap();
    assert_eq!((first.files, first.reread, first.parsed), (2, 2, 2));
    let next = tree.update_index(opts.clone()).unwrap().unwrap();
    assert_eq!((next.files, next.reread, next.parsed), (2, 2, 0), "reading the same bytes must reuse the native publication's parses");
    assert!(!next.published, "unchanged content and resolution publish nothing");
    write(&root, "lib/b.ts", b"export const value = 2;\n");
    let edited = tree.update_index(opts).unwrap().unwrap();
    assert_eq!((edited.files, edited.reread, edited.parsed), (2, 2, 1), "only changed bytes are parsed");
    assert!(edited.published);
    std::fs::remove_dir_all(root).unwrap();
}

fn only_record(index: &std::path::Path) -> crate::record::FileRecord {
    let chain = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    let layer = crate::compact::Layer::open(&chain.segments[0]).unwrap();
    assert_eq!(layer.records.file.len(), 1);
    assert_eq!(layer.parses.key.len(), 0, "a declined or failed acquisition publishes no parse");
    layer.records.indexed(&layer.stored, 0).record
}

#[test]
fn a_clean_git_blob_decline_keeps_its_identity_and_needs_no_warm_read() {
    let root = repository("source-update-declined-blob", &[("src/a.ts", b"export const value = 'too large';\n")]);
    let index = root.join("cache/index.bin");
    let mut opts = options(&root, &index, "declined");
    opts.largest_file = Some(16);
    let tree = crate::git_tree_for(opts.root.clone(), vec!["src".to_owned()]).unwrap();
    assert!(tree.regular[0]);
    tree.store.objects_now(&root).unwrap();
    let identity = tree.digest("src/a.ts".to_owned()).unwrap();
    let first = tree.update_index(opts.clone()).unwrap().unwrap();
    assert_eq!((first.reread, first.parsed), (1, 0));
    let record = only_record(&index);
    assert!(record.unknown.as_ref().is_some_and(|unknown| crate::acquire::declined_for_size("src/a.ts", unknown)));
    assert_eq!(record.digest, Some(identity.clone()), "the acquired blob is authoritative even when its size declines parsing");
    assert!(!tree.from_blob.shares(&identity, &crate::index::way("src/a.ts")), "a declined blob proves no parsed bytes for sharing");
    std::fs::remove_file(root.join("src/a.ts")).unwrap();
    let next = tree.update_index(opts).unwrap().unwrap();
    assert_eq!((next.reread, next.parsed, next.published), (0, 0, false), "a clean blob's decline needs no checkout metadata");
    assert_eq!(tree.digest("src/a.ts".to_owned()), Some(identity), "the frozen listing still names the same blob");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn legacy_git_identities_are_rebuilt_in_root_and_shared_parse_publications() {
    for shared in [false, true] {
        let root = repository(if shared { "source-update-legacy-store" } else { "source-update-legacy-root" }, &[("src/a.ts", b"export const value = 1;\n")]);
        let index = root.join("cache/index.bin");
        let opts = options(&root, &index, "legacy");
        let tree = crate::git_tree_for(opts.root.clone(), vec!["src".to_owned()]).unwrap();
        assert_eq!(tree.update_index(opts.clone()).unwrap().unwrap().parsed, 1);
        let chain = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
        let mut legacy = chain.segments[0].clone();
        let length = u32::from_le_bytes(legacy[..4].try_into().unwrap()) as usize;
        let text = std::str::from_utf8(&legacy[4..4 + length]).unwrap().trim_end_matches('\0');
        let mut header: serde_json::Value = serde_json::from_str(text).unwrap();
        header["version"] = serde_json::json!(47);
        let encoded = serde_json::to_vec(&header).unwrap();
        assert!(encoded.len() <= length);
        legacy[4..4 + length].fill(0);
        legacy[4..4 + encoded.len()].copy_from_slice(&encoded);
        std::fs::remove_file(&index).unwrap();
        let mut next = opts.clone();
        let path = if shared { root.join("cache/parses.bin") } else { index.clone() };
        std::fs::write(&path, legacy).unwrap();
        if shared { next.stores = Some(vec![path.to_str().unwrap().to_owned()]); }
        let update = tree.update_index(next.clone()).unwrap().unwrap();
        assert_eq!((update.reread, update.parsed), (1, 1), "a legacy git key proves neither the record's bytes nor the parse's bytes");
        assert_eq!(update.was, if shared { "missing" } else { "other-version" });
        assert_eq!(update.written, if shared { None } else { Some(47) });
        let healed = crate::index_chain::read_chain(path.to_str().unwrap()).unwrap().unwrap();
        assert!(healed.segments.iter().all(|bytes| crate::compact::Layer::open(bytes).is_ok()), "the old publication is replaced by readable generations");
        let warm = tree.update_index(next).unwrap().unwrap();
        assert_eq!((warm.reread, warm.parsed, warm.published), (0, 0, false));
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn worktree_size_refusals_keep_only_a_git_named_oversized_regular_file() {
    for dirty in [false, true] {
        let root = repository(if dirty { "source-update-declined-dirty" } else { "source-update-declined-worktree" }, &[("src/a.ts", b"export const value = 'too large';\n")]);
        if dirty { write(&root, "src/a.ts", b"export const value = 'different and too large';\n"); }
        let index = root.join("cache/index.bin");
        let mut opts = options(&root, &index, "declined");
        opts.largest_file = Some(16);
        if !dirty { opts.packs = Some(false); }
        let tree = crate::git_tree_for(opts.root.clone(), vec!["src".to_owned()]).unwrap();
        tree.store.objects_now(&root).unwrap();
        if dirty { assert!(!tree.regular[0]); }
        let first = tree.update_index(opts.clone()).unwrap().unwrap();
        assert_eq!((first.reread, first.parsed), (1, 0));
        let record = only_record(&index);
        assert!(record.unknown.as_ref().is_some_and(|unknown| crate::acquire::declined_for_size("src/a.ts", unknown)));
        assert!(record.digest.is_some(), "the listing names this refusal, while disk-only updates still reacquire it");
        assert_eq!(tree.update_index(opts).unwrap().unwrap().reread, if dirty { 0 } else { 1 });
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn a_failed_git_acquisition_names_no_record_identity() {
    let root = repository("source-update-failed-blob", &[("src/a.ts", b"export const value = 1;\n")]);
    let index = root.join("cache/index.bin");
    let opts = options(&root, &index, "failed");
    let tree = crate::git_tree_for(opts.root.clone(), vec!["src".to_owned()]).unwrap();
    tree.store.objects_now(&root).unwrap();
    let identity = tree.digest("src/a.ts".to_owned()).unwrap();
    let oid = identity.strip_prefix("git:").unwrap();
    std::fs::remove_file(root.join(".git/objects").join(&oid[..2]).join(&oid[2..])).unwrap();
    assert_eq!(tree.update_index(opts).unwrap().unwrap().parsed, 0);
    let record = only_record(&index);
    assert!(record.unknown.as_ref().is_some_and(|unknown| unknown.contains("could not be read from Git")));
    assert_eq!(record.digest, None, "a listed object that could not be acquired proves no identity");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_cold_root_seeds_the_missing_parse_store_with_its_encoded_generation() {
    let root = repository("source-update-store-seed", &[("src/a.ts", b"/** The value. */\nexport const value = 1;\n")]);
    let index = root.join("cache/index.bin");
    let path = root.join("cache/parses.bin");
    let mut opts = options(&root, &index, "seed");
    opts.stores = Some(vec![path.to_str().unwrap().to_owned()]);
    let tree = crate::git_tree_for(opts.root.clone(), vec!["src".to_owned()]).unwrap();
    assert_eq!(tree.update_index(opts.clone()).unwrap().unwrap().parsed, 1);
    let published = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    let shared = crate::index_chain::read_chain(path.to_str().unwrap()).unwrap().unwrap();
    assert_eq!(shared.segments, published.segments[..published.segments.len() - 1], "encoded parse generations are retained verbatim without root metadata");
    assert_eq!(shared.references[0].digest, published.references[0].digest);

    opts.index = root.join("cache/second.bin").to_str().unwrap().to_owned();
    assert_eq!(tree.update_index(opts).unwrap().unwrap().parsed, 0, "root metadata in a store layer does not change parse lookup");
    assert_eq!(crate::parse_store::prune_parse_store(path.to_str().unwrap().to_owned(), vec![index.to_str().unwrap().to_owned()], 0.0).unwrap(), 0);
    assert_eq!(crate::parse_store::prune_parse_store(path.to_str().unwrap().to_owned(), vec![], 0.0).unwrap(), 1);
    let retained = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    assert_eq!(retained.segments, published.segments, "pruning the store leaves the root's own immutable generation intact");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_nonshareable_root_parse_keeps_the_store_on_its_selected_rows() {
    let root = repository("source-update-store-unshared", &[
        ("src/a.ts", b"export const a = 1;\n"),
        ("src/b.ts", b"export const b = 2;\n"),
    ]);
    let index = root.join("cache/index.bin");
    let path = root.join("cache/parses.bin");
    let mut opts = options(&root, &index, "unshared");
    opts.stores = Some(vec![path.to_str().unwrap().to_owned()]);
    let tree = crate::git_tree_for(opts.root.clone(), vec!["src".to_owned()]).unwrap();
    let identity = tree.digest("src/a.ts".to_owned()).unwrap();
    let oid = crate::git::parse_oid(identity.strip_prefix("git:").unwrap().as_bytes()).unwrap();
    tree.from_blob.saw(&oid, "src/a.ts", false);
    assert_eq!(tree.update_index(opts).unwrap().unwrap().parsed, 2);
    let shared = crate::index_chain::read_chain(path.to_str().unwrap()).unwrap().unwrap();
    let layer = crate::compact::Layer::open(&shared.segments[0]).unwrap();
    assert_eq!(layer.records.file.len(), 0, "a generation with an ineligible parse is not seeded whole");
    assert_eq!(layer.parses.key.len(), 1);
    assert_ne!(layer.stored.text(layer.parses.key.at(0)), identity);
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(feature = "grammars")]
#[test]
fn unconsumed_rust_preparations_keep_the_store_on_its_complete_selected_rows() {
    let root = repository("source-update-store-prepared", &[
        ("Cargo.toml", b"[package]\nname = 'fixture'\nversion = '0.1.0'\n"),
        ("src/lib.rs", b"pub struct Reached;\n"),
        ("unused/other.rs", b"pub struct Prepared;\n"),
    ]);
    let index = root.join("cache/index.bin");
    let path = root.join("cache/parses.bin");
    let mut opts = options(&root, &index, "prepared");
    opts.code_extensions = vec![".rs".to_owned()];
    opts.readable = vec![".rs".to_owned()];
    opts.stores = Some(vec![path.to_str().unwrap().to_owned()]);
    let tree = crate::git_tree_for(opts.root.clone(), vec!["src".to_owned()]).unwrap();
    let update = tree.update_index(opts).unwrap().unwrap();
    assert_eq!((update.files, update.parsed), (1, 2));
    let published = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    let root_layer = crate::compact::Layer::open(&published.segments[0]).unwrap();
    assert_eq!(root_layer.parses.key.len(), 1);
    let shared = crate::index_chain::read_chain(path.to_str().unwrap()).unwrap().unwrap();
    let layer = crate::compact::Layer::open(&shared.segments[0]).unwrap();
    assert_eq!(layer.records.file.len(), 0);
    assert_eq!(layer.parses.key.len(), 2, "the store also retains the Rust facts not reached by the root");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn cold_store_and_legacy_reuse_keep_full_facts_and_warm_edits_retire_unused_keys() {
    fn canonical(index: &std::path::Path) -> Vec<u8> {
        let chain = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
        crate::compact::compacted(&chain.segments.iter().map(Vec::as_slice).collect::<Vec<_>>()).unwrap()
    }
    let rich = b"/** Original documentation. */\nexport class Original { /** Work docs. */ work() { return 1; } }\nconst value: Original = new Original(); value.work(); export { value };\n";
    let root = repository("source-slice-lifecycle", &[
        ("src/a.ts", rich), ("src/same.ts", rich),
        ("src/stable.ts", b"/** Stable documentation. */\nexport function stable() { function inner() { return 1; } return inner(); }\n"),
    ]);
    let index = root.join("cache/index.bin");
    let store = root.join("cache/store.bin");
    let mut opts = options(&root, &index, "lifecycle");
    opts.stores = Some(vec![store.to_str().unwrap().to_owned()]);
    let tree = crate::git_tree_for(opts.root.clone(), vec!["src".to_owned()]).unwrap();
    assert_eq!(tree.update_index(opts.clone()).unwrap().unwrap().parsed, 3);
    let original = canonical(&index);
    let layer = crate::compact::Layer::open(&original).unwrap();
    assert_eq!(layer.parses.key.len(), 2);
    assert!(layer.parses.symbol_name.len() > 0);
    let old = tree.digest("src/a.ts".to_owned()).unwrap();

    // A missing root must copy the store's whole view, not its minimal
    // resolver projection. The same applies to a readable standalone legacy
    // generation whose facts can be reused but whose root layers are retired.
    let from_store = root.join("cache/from-store.bin");
    let mut reuse = opts.clone();
    reuse.index = from_store.to_str().unwrap().to_owned();
    assert_eq!(tree.update_index(reuse).unwrap().unwrap().parsed, 0);
    assert_eq!(canonical(&from_store), original);
    let legacy = root.join("cache/legacy.bin");
    std::fs::write(&legacy, &original).unwrap();
    let mut reuse = opts.clone();
    reuse.index = legacy.to_str().unwrap().to_owned();
    reuse.stores = None;
    assert_eq!(tree.update_index(reuse).unwrap().unwrap().parsed, 0);
    assert_eq!(canonical(&legacy), original);

    let base = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    write(&root, "src/a.ts", b"/** Replacement documentation. */\nexport class Replacement { next() { return 2; } }\n");
    std::fs::remove_file(root.join("src/same.ts")).unwrap();
    let next_tree = crate::git_tree_for(opts.root.clone(), vec!["src".to_owned()]).unwrap();
    let update = next_tree.update_index(opts.clone()).unwrap().unwrap();
    assert_eq!((update.files, update.parsed, update.published), (2, 1, true));
    let edited = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    assert_eq!((edited.references.len(), edited.working), (base.references.len() + 1, 1));
    assert_eq!(edited.segments[..base.segments.len()], base.segments);
    let layers: Vec<_> = edited.segments.iter().map(|bytes| crate::compact::Layer::open(bytes).unwrap()).collect();
    assert!(crate::chain_lookup::parse(&layers, &old, &crate::index::way("src/a.ts")).is_none(), "the last user of the original key was removed");
    let edited_identity = crate::chain_lookup::record(&layers, "src/a.ts").map(|(_, (at, row))| layers[at].records.indexed(&layers[at].stored, row).record.digest.unwrap()).unwrap();
    drop(layers);

    std::fs::remove_file(root.join("src/a.ts")).unwrap();
    let last_tree = crate::git_tree_for(opts.root.clone(), vec!["src".to_owned()]).unwrap();
    let update = last_tree.update_index(opts.clone()).unwrap().unwrap();
    assert_eq!((update.files, update.parsed, update.published), (1, 0, true));
    let deleted = crate::index_chain::read_chain(index.to_str().unwrap()).unwrap().unwrap();
    assert_eq!((deleted.references.len(), deleted.working), (base.references.len() + 1, 1), "warm changes replace one working tail");
    let layers: Vec<_> = deleted.segments.iter().map(|bytes| crate::compact::Layer::open(bytes).unwrap()).collect();
    assert!(crate::chain_lookup::parse(&layers, &edited_identity, &crate::index::way("src/a.ts")).is_none());
    assert_eq!(crate::chain_lookup::fold(&layers).len(), 1);
    let fresh = root.join("cache/fresh.bin");
    opts.index = fresh.to_str().unwrap().to_owned();
    assert_eq!(last_tree.update_index(opts).unwrap().unwrap().parsed, 0);
    assert_eq!(canonical(&index), canonical(&fresh), "warm deletion and a fresh native root keep identical full facts");
    std::fs::remove_dir_all(root).unwrap();
}
