//! The questions published in a manifest ride every write, keep on disk what
//! they were read over, and let it go once a publish or a fold no longer needs
//! it.

use super::{folded, publish, publish_workspace, written, LogSegment, Over};
use crate::index_chain::{workspace_of, Workspace};
use sha2::{Digest, Sha256};

fn named(bytes: &[u8]) -> LogSegment {
    LogSegment { digest: crate::digest::of_sha256(Sha256::digest(bytes).as_slice()), length: bytes.len() as i64 }
}

/// A fresh chain of `one` and `two` at `<temp>/<name>/index.bin`, its directory, and where each digest's file lies.
fn chain(name: &str) -> (std::path::PathBuf, String) {
    let directory = std::env::temp_dir().join(format!("va-log-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("index.bin").to_str().unwrap().to_owned();
    publish(&path, &[], &[b"one", b"two"], &[]).unwrap();
    (directory, path)
}

fn on_disk(path: &str, bytes: &[u8]) -> bool {
    std::path::Path::new(&format!("{path}.segments/{}.bin", named(bytes).digest.replacen(':', "-", 1))).exists()
}

fn questions(path: &str) -> Option<Workspace> {
    workspace_of(&std::fs::read(path).unwrap())
}

fn digests(of: &[&[u8]]) -> Vec<String> {
    of.iter().map(|bytes| named(bytes).digest).collect()
}

#[test]
fn questions_ride_a_write_and_keep_the_segment_it_replaced_until_they_are_published_again() {
    let (directory, path) = chain("questions-ride");
    assert!(publish_workspace(&path, b"store", &digests(&[b"one", b"two"]), false).unwrap());
    let held = questions(&path).unwrap();
    assert_eq!((held.digest.clone(), held.length, held.over.clone(), held.given), (named(b"store").digest, 5, digests(&[b"one", b"two"]), false));

    let read = std::fs::read(&path).unwrap();
    assert!(written(&path, Over::Published(&read), &[named(b"one")], &[b"three"], &[named(b"two")], 1).unwrap());
    assert_eq!(questions(&path), Some(held));
    assert!(on_disk(&path, b"two"), "the questions were read over it");

    assert!(publish_workspace(&path, b"later", &digests(&[b"one", b"three"]), true).unwrap());
    assert_eq!(questions(&path).map(|held| (held.over, held.given)), Some((digests(&[b"one", b"three"]), true)));
    assert!(!on_disk(&path, b"two") && !on_disk(&path, b"store"), "only the questions it replaced named them");
    assert!(on_disk(&path, b"one") && on_disk(&path, b"three") && on_disk(&path, b"later"));
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn questions_over_a_segment_no_longer_on_disk_or_a_chain_never_published_are_not_published() {
    let (directory, path) = chain("questions-gone");
    let read = std::fs::read(&path).unwrap();
    assert!(!publish_workspace(&path, b"store", &digests(&[b"one", b"gone"]), false).unwrap());
    assert_eq!(std::fs::read(&path).unwrap(), read);
    assert!(!on_disk(&path, b"store"));
    assert!(!publish_workspace(&format!("{path}.never"), b"store", &[], false).unwrap());
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn a_fold_of_the_chain_the_questions_read_is_what_they_are_read_over_from_then_on() {
    let (directory, path) = chain("questions-folded");
    assert!(publish_workspace(&path, b"store", &digests(&[b"one", b"two"]), false).unwrap());
    let read = std::fs::read(&path).unwrap();
    assert!(folded(&path, Over::Published(&read), b"onetwo", &[named(b"one"), named(b"two")]).unwrap());
    assert_eq!(questions(&path).map(|held| held.over), Some(digests(&[b"onetwo"])));
    assert!(!on_disk(&path, b"one") && !on_disk(&path, b"two") && on_disk(&path, b"store"));
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn a_fold_of_a_chain_the_questions_did_not_read_leaves_them_what_they_read() {
    let (directory, path) = chain("questions-behind");
    assert!(publish_workspace(&path, b"store", &digests(&[b"one"]), false).unwrap());
    let read = std::fs::read(&path).unwrap();
    assert!(folded(&path, Over::Published(&read), b"onetwo", &[named(b"one"), named(b"two")]).unwrap());
    assert_eq!(questions(&path).map(|held| held.over), Some(digests(&[b"one"])));
    assert!(on_disk(&path, b"one") && !on_disk(&path, b"two"));
    std::fs::remove_dir_all(directory).unwrap();
}
