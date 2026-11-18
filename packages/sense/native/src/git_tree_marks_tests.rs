//! Metadata completed by the source update belongs to that tree preparation.

use std::path::PathBuf;
use std::sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc};
use std::time::Duration;

use super::options;
use crate::git_fixture::{repository, write};
use crate::git_tree::{while_marks, GitTree};

struct Fixture(PathBuf);

impl Drop for Fixture {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

fn fixture(name: &str, attributes: &[u8]) -> (Fixture, PathBuf, GitTree) {
    let root = repository(name, &[
        (".gitattributes", attributes),
        ("src/plain.ts", b"export const plain = 1;\n"),
        ("src/generated.ts", b"export const generated = 2;\n"),
        ("src/vendor.ts", b"export const vendor = 3;\n"),
    ]);
    let index = root.join("cache/index.bin");
    let tree = crate::git_tree_for(root.to_string_lossy().into_owned(), vec!["src".to_owned()]).unwrap();
    (Fixture(root), index, tree)
}

const ATTRIBUTES: &[u8] = b"src/generated.ts linguist-generated\nsrc/vendor.ts linguist-vendored\n";

#[test]
fn an_opted_in_update_completes_marks_before_returning_and_the_answer_is_taken_once() {
    let (root, index, tree) = fixture("source-prepared-marks", ATTRIBUTES);
    let mut opts = options(&root.0, &index, "marks");
    opts.prepare_map = Some(true);
    assert!(tree.update_index(opts).unwrap().unwrap().published);
    write(&root.0, ".gitattributes", b"");
    let answer = tree.take_marks(root.0.to_str().unwrap(), index.to_str().unwrap());
    assert_eq!(answer, Some(Some(b"src/generated.ts\0src/vendor.ts\0".to_vec())), "later attribute edits do not replace this preparation's metadata");
    assert!(tree.take_marks(root.0.to_str().unwrap(), index.to_str().unwrap()).is_none());
}

#[test]
fn an_opted_out_warm_update_clears_the_same_trees_unused_preparation() {
    let (root, index, tree) = fixture("source-prepared-marks-reset", ATTRIBUTES);
    let mut opts = options(&root.0, &index, "marks");
    opts.prepare_map = Some(true);
    assert!(tree.update_index(opts.clone()).unwrap().unwrap().published);
    opts.prepare_map = None;
    assert!(!tree.update_index(opts).unwrap().unwrap().published);
    assert!(tree.take_marks(root.0.to_str().unwrap(), index.to_str().unwrap()).is_none());
}

#[test]
fn an_opted_out_first_update_and_a_filesystem_tree_prepare_no_git_marks() {
    let (root, index, tree) = fixture("source-prepared-marks-opt-out", ATTRIBUTES);
    assert!(tree.update_index(options(&root.0, &index, "marks")).unwrap().unwrap().published);
    assert!(tree.take_marks(root.0.to_str().unwrap(), index.to_str().unwrap()).is_none());
    let filesystem = crate::filesystem_tree::tree(root.0.to_string_lossy().into_owned(), &["src".to_owned()]);
    let other = root.0.join("cache/filesystem.bin");
    let mut opts = options(&root.0, &other, "marks");
    opts.prepare_map = Some(true);
    assert!(filesystem.update_index(opts).unwrap().unwrap().published);
    assert!(filesystem.take_marks(root.0.to_str().unwrap(), other.to_str().unwrap()).is_none());
}

#[test]
fn an_empty_success_and_a_failed_marks_query_are_distinct() {
    let (root, index, tree) = fixture("source-prepared-marks-empty", b"");
    let mut opts = options(&root.0, &index, "marks");
    opts.prepare_map = Some(true);
    tree.update_index(opts).unwrap().unwrap();
    assert_eq!(tree.take_marks(root.0.to_str().unwrap(), index.to_str().unwrap()), Some(Some(Vec::new())));

    let (root, index, tree) = fixture("source-prepared-marks-failed", ATTRIBUTES);
    std::fs::rename(root.0.join(".git"), root.0.join("hidden-git")).unwrap();
    let mut opts = options(&root.0, &index, "marks");
    opts.prepare_map = Some(true);
    opts.packs = Some(false);
    assert!(tree.update_index(opts).unwrap().unwrap().published);
    assert_eq!(tree.take_marks(root.0.to_str().unwrap(), index.to_str().unwrap()), Some(None));
}

#[test]
fn a_root_or_index_mismatch_discards_the_unused_preparation() {
    for mismatch_root in [false, true] {
        let name = if mismatch_root { "source-marks-root-mismatch" } else { "source-marks-index-mismatch" };
        let (root, index, tree) = fixture(name, ATTRIBUTES);
        let mut opts = options(&root.0, &index, "marks");
        opts.prepare_map = Some(true);
        tree.update_index(opts).unwrap().unwrap();
        let other_root = root.0.join("elsewhere");
        let other_index = root.0.join("cache/elsewhere.bin");
        let asked_root = if mismatch_root { &other_root } else { &root.0 };
        let asked_index = if mismatch_root { &index } else { &other_index };
        assert!(tree.take_marks(asked_root.to_str().unwrap(), asked_index.to_str().unwrap()).is_none());
        assert!(tree.take_marks(root.0.to_str().unwrap(), index.to_str().unwrap()).is_none(), "a mismatched consumer cannot leave stale metadata for another call");
    }
}

#[test]
fn an_update_root_different_from_the_trees_root_prepares_no_marks() {
    let (root, index, tree) = fixture("source-marks-update-root-mismatch", ATTRIBUTES);
    let alternate = root.0.join("src/..");
    let mut opts = options(&alternate, &index, "marks");
    opts.prepare_map = Some(true);
    assert!(tree.update_index(opts).unwrap().unwrap().published);
    assert!(tree.take_marks(alternate.to_str().unwrap(), index.to_str().unwrap()).is_none());
}

#[test]
fn a_declined_or_refused_update_discards_prepared_marks() {
    let (root, index, tree) = fixture("source-marks-declined", ATTRIBUTES);
    let mut opts = options(&root.0, &index, "marks");
    opts.prepare_map = Some(true);
    tree.update_index(opts.clone()).unwrap().unwrap();
    opts.aliases = Some("invalid json".to_owned());
    assert!(tree.update_index(opts).unwrap().is_none());
    assert!(tree.take_marks(root.0.to_str().unwrap(), index.to_str().unwrap()).is_none());

    write(&root.0, "blocked", b"not a directory");
    let blocked = root.0.join("blocked/index.bin");
    let mut opts = options(&root.0, &blocked, "marks");
    opts.prepare_map = Some(true);
    assert!(tree.update_index(opts).unwrap().unwrap().refused.is_some());
    assert!(tree.take_marks(root.0.to_str().unwrap(), blocked.to_str().unwrap()).is_none());
}

fn signal<T>(receiver: &mpsc::Receiver<T>) -> T {
    // A missing signal fails this test instead of hanging a serialized implementation.
    receiver.recv_timeout(Duration::from_secs(5)).expect("the scoped marks/update signal did not arrive")
}

#[test]
fn the_marks_job_overlaps_source_work_and_is_drained_before_return() {
    let (started, start) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let finished = Arc::new(AtomicBool::new(false));
    let worker_finished = Arc::clone(&finished);
    let (value, marks) = while_marks(move || {
        started.send(std::thread::current().id()).unwrap();
        signal(&released);
        worker_finished.store(true, Ordering::SeqCst);
        Some(b"made\0".to_vec())
    }, || {
        assert_ne!(signal(&start), std::thread::current().id());
        release.send(()).unwrap();
        Err::<(), _>("source refused")
    });
    assert_eq!(value, Err("source refused"));
    assert_eq!(marks, Some(b"made\0".to_vec()));
    assert!(finished.load(Ordering::SeqCst));
}

#[test]
fn source_unwinding_still_drains_the_scoped_marks_job() {
    let (started, start) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let finished = Arc::new(AtomicBool::new(false));
    let worker_finished = Arc::clone(&finished);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| while_marks(move || {
        started.send(()).unwrap();
        signal(&released);
        worker_finished.store(true, Ordering::SeqCst);
        Some(Vec::new())
    }, || {
        signal(&start);
        release.send(()).unwrap();
        panic!("source panic");
    })));
    assert!(result.is_err());
    assert!(finished.load(Ordering::SeqCst));
}

#[test]
fn a_marks_worker_panic_is_an_unknown_optional_answer() {
    let (value, marks) = while_marks(|| panic!("marks failed"), || 7);
    assert_eq!(value, 7);
    assert!(marks.is_none());
}
