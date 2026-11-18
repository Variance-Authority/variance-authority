//! A carried map consumes metadata from the preparation that published its index.

use super::{carried, git, indexed, Fixture};
use crate::git_tree::GitTree;
use crate::source_update::UpdateOptions;

const MARKED: &str = "packages/ui/ui0/src/index.ts";

fn prepared(name: &str, attributes: &[u8], fail_marks: bool) -> (Fixture, String, String, GitTree) {
    let (fixture, _, index) = indexed(name);
    std::fs::write(fixture.0.join(".gitattributes"), attributes).unwrap();
    let root = std::fs::canonicalize(&fixture.0).unwrap().to_string_lossy().into_owned();
    git(&root, &["init", "-q"]);
    git(&root, &["add", "-A"]);
    let tree = crate::git_tree_for(root.clone(), vec!["packages".to_owned()]).unwrap();
    if fail_marks { std::fs::rename(fixture.0.join(".git"), fixture.0.join("hidden-git")).unwrap(); }
    let update = tree.update_index(UpdateOptions {
        root: root.clone(), index: index.clone(), config: "prepared-map-marks".to_owned(),
        largest_file: None, readers: None, packs: Some(false), prepare_map: Some(true),
        tsconfig: None, condition_names: None, aliases: None, builtins: Vec::new(),
        code_extensions: vec![".ts".to_owned()], readable: vec![".ts".to_owned()], stores: None,
    }).unwrap().unwrap();
    assert!(update.published);
    if fail_marks { std::fs::rename(fixture.0.join("hidden-git"), fixture.0.join(".git")).unwrap(); }
    (fixture, root, index, tree)
}

fn shipped(index: &str) -> Vec<String> {
    crate::orient_map_shipped::orient_shipped(index.to_owned()).unwrap().unwrap().files
}

#[test]
fn a_carried_map_uses_prepared_marks_and_a_new_tree_observes_dirty_attributes() {
    let attributes = format!("{MARKED} linguist-generated\n");
    let (fixture, root, index, tree) = prepared("prepared-map-captured-marks", attributes.as_bytes(), false);
    std::fs::write(fixture.0.join(".gitattributes"), b"").unwrap();
    assert!(!carried(&tree, &root, &index).unwrap().unwrap().unmarked);
    assert!(!shipped(&index).iter().any(|file| file == MARKED), "the map uses the completed preparation, before this attribute edit");
    assert!(tree.take_marks(&root, &index).is_none(), "the map consumed its metadata");

    let fresh = crate::git_tree(root.clone()).unwrap();
    assert!(!carried(&fresh, &root, &index).unwrap().unwrap().unmarked);
    assert!(shipped(&index).iter().any(|file| file == MARKED), "a new tree's dirty attribute identity invalidates the kept map");
}

#[test]
fn a_carried_failed_query_stays_unknown_and_a_successful_empty_answer_is_known() {
    let (_fixture, root, index, tree) = prepared("prepared-map-failed-marks", b"", true);
    assert!(carried(&tree, &root, &index).unwrap().unwrap().unmarked, "a failed preparation is not silently retried against later Git state");

    let (fixture, root, index, tree) = prepared("prepared-map-empty-marks", b"", false);
    std::fs::rename(fixture.0.join(".git"), fixture.0.join("hidden-git")).unwrap();
    assert!(!carried(&tree, &root, &index).unwrap().unwrap().unmarked, "a valid empty preparation does not run a late query");
}

#[test]
fn a_mismatched_missing_index_discards_metadata_before_returning_and_later_queries_are_live() {
    let attributes = format!("{MARKED} linguist-generated\n");
    let (fixture, root, index, tree) = prepared("prepared-map-mismatched-index", attributes.as_bytes(), false);
    let missing = fixture.0.join("absent-index.bin").to_string_lossy().into_owned();
    assert!(carried(&tree, &root, &missing).unwrap().is_none());
    assert!(tree.take_marks(&root, &index).is_none(), "the absent-index early return already consumed the mismatched slot");
    std::fs::write(fixture.0.join(".gitattributes"), b"").unwrap();
    carried(&tree, &root, &index).unwrap().unwrap();
    assert!(shipped(&index).iter().any(|file| file == MARKED));
}

#[test]
fn a_kept_map_still_consumes_unused_prepared_metadata() {
    let (_fixture, root, index, tree) = prepared("prepared-map-kept-consumes-marks", b"", false);
    super::prepare_orient_map(&root, &index, None, false, crate::resolve::Tsconfig::Auto).unwrap().unwrap();
    carried(&tree, &root, &index).unwrap().unwrap();
    assert!(tree.take_marks(&root, &index).is_none(), "keeping the map must not retain metadata for another update");
}
