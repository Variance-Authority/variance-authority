use std::collections::HashMap;
use std::path::Path;

use super::{declined_for_size, open, read_all, read_git, still_too_large, too_large, Answer, Opened, Outcome, TreeObjects};
use crate::git_store::{Objects, STORE_CROSSOVER};
use crate::git_fixture::{git, repository, write};

/// `files`, committed, as `read_git` answers each out of the repository's
/// store under `largest`, with whether its bytes were the blob the index names.
fn wave(name: &str, files: &[(&str, &[u8])], largest: u32, edit: impl FnOnce(&Path)) -> HashMap<String, (Answer, bool)> {
    let root = repository(name, files);
    edit(&root);
    let staged = git(&root, &["ls-files", "-s"]);
    let ids: HashMap<&str, crate::git::Oid> = staged
        .lines()
        .filter_map(|line| {
            let (meta, path) = line.split_once('\t')?;
            Some((path, crate::git::parse_oid(meta.split(' ').nth(1)?.as_bytes())?))
        })
        .collect();
    let paths: Vec<String> = files.iter().map(|(path, _)| (*path).to_owned()).collect();
    let oids = paths.iter().map(|path| ids.get(path.as_str()).copied()).collect();
    let objects = Objects::open(&root);
    let (answers, named) = read_git(objects.as_ref(), root.to_string_lossy().into_owned(), paths.clone(), oids, Some(largest), Some(true), None, true);
    std::fs::remove_dir_all(&root).unwrap();
    paths.into_iter().zip(answers.into_iter().zip(named)).collect()
}

/// A parse as the disk read gives it, to compare a wave's answer against.
fn on_disk(root: &Path, file: &str, largest: u32) -> String {
    let read = read_all(root.to_string_lossy().into_owned(), vec![file.to_owned()], Some(largest), Some(true), None, true);
    serde_json::to_string(&read[0].0).unwrap()
}

#[test]
fn a_wave_reads_each_tracked_blob_out_of_the_store_and_declines_an_oversized_one_by_its_size() {
    let answers = wave("acquire-wave", &[("large.ts", b"export const large = 'xxxxxxxxxxxxxxxx';\n"), ("next.ts", b"export const y = 1;\n")], 32, |_| {});

    let (large, named) = &answers["large.ts"];
    assert_eq!(large.2, Outcome::Declined);
    assert!(large.0.unknown.as_deref().is_some_and(|unknown| declined_for_size("large.ts", unknown)));
    assert!(!named);
    let (next, named) = &answers["next.ts"];
    assert_eq!(next.2, Outcome::Parsed);
    assert!(named, "bytes out of Git's object store are the blob asked for");
    assert!(answers.values().all(|(answer, _)| answer.2 != Outcome::Failed));
}

#[test]
fn a_wave_in_a_repository_with_a_replace_ref_parses_the_bytes_on_disk_not_the_replacement() {
    let mut disk = String::new();
    let answers = wave("acquire-replace", &[("a.ts", b"export const a = 1;\n"), ("b.ts", b"export const b = 2;\n")], 1024, |root| {
        let (a, b) = (git(root, &["rev-parse", "HEAD:a.ts"]), git(root, &["rev-parse", "HEAD:b.ts"]));
        git(root, &["replace", &a, &b]);
        disk = on_disk(root, "a.ts", 1024);
    });

    let (a, named) = &answers["a.ts"];
    assert_eq!(serde_json::to_string(&a.0).unwrap(), disk, "a.ts declares `a`, as its checkout does");
    assert!(named, "the disk's bytes hash to the id the index names");
}

#[test]
fn bytes_that_are_not_utf8_are_declined_and_a_missing_file_failed() {
    let root = std::env::temp_dir().join(format!("sense-acquire-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("latin1.js"), b"export const e = '\xe9';\n").unwrap();

    let outcome = |file| match open(&root, file, 1024, false, None).1 {
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

    let opened = |file, largest| matches!(open(&root, file, largest, false, None).1, Opened::Source(_));
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

    let outcome = |file, largest| match open(&root, file, largest, false, None).1 {
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
    let answers = wave("acquire-lfs-blob", &[("a.ts", POINTER.as_bytes())], 1024, |root| write(root, "a.ts", b"export const a = 1;\n"));

    let ((read, digest, outcome), named) = &answers["a.ts"];
    assert!(!named, "the bytes parsed are the checkout's, not the blob's");
    assert_eq!(*outcome, Outcome::Parsed);
    assert_eq!(*digest, crate::digest::of_string("export const a = 1;\n"), "the content is read, not the pointer");
    assert!(read.unknown.is_none());
}

#[test]
fn a_checkout_holding_an_lfs_pointer_fails_the_file_and_says_why() {
    let root = std::env::temp_dir().join(format!("sense-acquire-lfs-disk-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("a.ts"), POINTER).unwrap();

    let opened = open(&root, "a.ts", 1024, false, None).1;
    std::fs::remove_dir_all(&root).unwrap();

    let Opened::Settled(read, outcome) = opened else { panic!("a pointer is never parsed as source") };
    assert_eq!(outcome, Outcome::Failed, "a `git lfs pull` changes the bytes, not the object a decline is kept by");
    assert!(read.unknown.unwrap().starts_with("a.ts is a git-LFS pointer"));
}

#[test]
fn a_tree_opens_the_store_once_its_scans_have_read_the_crossover_and_keeps_it() {
    let root = repository("acquire-wave-store", &[("a.ts", b"export const a = 1;\n")]);
    let store = TreeObjects::default();

    let short = store.objects(&root, STORE_CROSSOVER - 1).is_some();
    let reached = store.objects(&root, 1);
    let after = store.objects(&root, 1);
    let alone = TreeObjects::default().objects(&root, 10).is_some();
    std::fs::remove_dir_all(&root).unwrap();

    assert!(!short, "scans that have read fewer files than the crossover open no store");
    let (reached, after) = (reached.expect("the read that reaches the crossover comes from the store"), after.unwrap());
    assert!(std::sync::Arc::ptr_eq(&reached, &after), "every later read comes from the store already open");
    assert!(!alone, "a tree whose scans read a few files reads them off the disk");
}
