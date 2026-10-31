use std::io::Cursor;
use std::path::Path;

use oxc_allocator::AllocatorPool;

use super::{declined_for_size, open, read_blob, still_too_large, too_large, Opened, Outcome};

#[test]
fn an_oversized_blob_is_declined_and_drained_without_losing_the_next_answer() {
    let mut stream = Cursor::new(b"one blob 4\nxxxx\ntwo blob 19\nexport const y = 1\n\n");
    let arenas = AllocatorPool::new(1);

    let (oversized, _, outcome) = read_blob(Path::new("."), "large.ts", &mut stream, 1, false, &arenas, true);
    let (_, _, next) = read_blob(Path::new("."), "next.ts", &mut stream, 1024, false, &arenas, true);

    assert_eq!(outcome, Outcome::Declined);
    assert!(oversized.unknown.is_some());
    assert_eq!(next, Outcome::Parsed);
}

#[test]
fn bytes_that_are_not_utf8_are_declined_and_a_missing_file_failed() {
    let root = std::env::temp_dir().join(format!("sense-acquire-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("latin1.js"), b"export const e = '\xe9';\n").unwrap();

    let outcome = |file| match open(&root, file, 1024, false).1 {
        Opened::Settled(read, outcome) => (outcome, read.unknown),
        Opened::Source(_) => (Outcome::Parsed, None),
    };
    let (latin1, missing) = (outcome("latin1.js"), outcome("missing.js"));
    std::fs::remove_dir_all(&root).unwrap();

    assert_eq!(latin1.0, Outcome::Declined);
    assert!(latin1.1.unwrap().starts_with("latin1.js is not UTF-8"));
    assert_eq!(missing.0, Outcome::Failed);
}

#[test]
fn a_file_of_exactly_the_limit_is_opened_and_so_is_an_empty_one() {
    let root = std::env::temp_dir().join(format!("sense-acquire-limit-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("exact.js"), b"export const e = 1;\n").unwrap();
    std::fs::write(root.join("empty.js"), b"").unwrap();

    let opened = |file, largest| matches!(open(&root, file, largest, false).1, Opened::Source(_));
    let (exact, over, empty) = (opened("exact.js", 20), opened("exact.js", 19), opened("empty.js", 20));
    std::fs::remove_dir_all(&root).unwrap();

    assert!(exact);
    assert!(!over);
    assert!(empty);
}

#[cfg(unix)]
#[test]
fn a_refusal_reached_through_a_link_failed_and_names_nothing() {
    let root = std::env::temp_dir().join(format!("sense-acquire-link-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("target.js"), b"export const t = 1;\n").unwrap();
    std::fs::write(root.join("latin1.js"), b"export const e = '\xe9';\n").unwrap();
    std::os::unix::fs::symlink(root.join("target.js"), root.join("large.js")).unwrap();
    std::os::unix::fs::symlink(root.join("latin1.js"), root.join("linked.js")).unwrap();

    let outcome = |file, largest| match open(&root, file, largest, false).1 {
        Opened::Settled(_, outcome) => outcome,
        Opened::Source(_) => Outcome::Parsed,
    };
    let (plain, large, linked) = (outcome("target.js", 1), outcome("large.js", 1), outcome("linked.js", 1024));
    std::fs::remove_dir_all(&root).unwrap();

    assert_eq!(plain, Outcome::Declined);
    assert_eq!(large, Outcome::Failed);
    assert_eq!(linked, Outcome::Failed);
}

#[test]
fn a_decline_for_size_is_told_by_its_reason_and_held_while_the_file_is_over() {
    let root = std::env::temp_dir().join(format!("sense-acquire-size-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("a.css"), b".a { color: red; }\n").unwrap();

    let (over, fits, gone) =
        (still_too_large(&root, "a.css", 8), still_too_large(&root, "a.css", 19), still_too_large(&root, "b.css", 8));
    std::fs::remove_dir_all(&root).unwrap();

    assert!(declined_for_size("a.css", &too_large("a.css", 19, 8)));
    assert!(!declined_for_size("b.css", &too_large("a.css", 19, 8)));
    assert!(!declined_for_size("a.css", "a.css is not UTF-8, so this scan does not parse it: stream"));
    assert!((over, fits, gone) == (true, false, false));
}

const POINTER: &str = "version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 20\n";

#[test]
fn a_blob_git_holds_as_an_lfs_pointer_is_read_from_the_checkout_that_smudged_it() {
    let root = std::env::temp_dir().join(format!("sense-acquire-lfs-blob-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("a.ts"), b"export const a = 1;\n").unwrap();
    let mut stream = Cursor::new(format!("oid blob {}\n{POINTER}\n", POINTER.len()).into_bytes());
    let arenas = AllocatorPool::new(1);

    let (read, digest, outcome) = read_blob(&root, "a.ts", &mut stream, 1024, true, &arenas, true);
    std::fs::remove_dir_all(&root).unwrap();

    assert_eq!(outcome, Outcome::Parsed);
    assert_eq!(digest, crate::digest::of_string("export const a = 1;\n"), "the content is read, not the pointer");
    assert!(read.unknown.is_none());
}

#[test]
fn a_checkout_holding_an_lfs_pointer_fails_the_file_and_says_why() {
    let root = std::env::temp_dir().join(format!("sense-acquire-lfs-disk-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("a.ts"), POINTER).unwrap();

    let opened = open(&root, "a.ts", 1024, false).1;
    std::fs::remove_dir_all(&root).unwrap();

    let Opened::Settled(read, outcome) = opened else { panic!("a pointer is never parsed as source") };
    assert_eq!(outcome, Outcome::Failed, "a `git lfs pull` changes the bytes, not the object a decline is kept by");
    assert!(read.unknown.unwrap().starts_with("a.ts is a git-LFS pointer"));
}
