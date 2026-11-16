use std::collections::HashMap;
use std::path::Path;

use super::{declined_for_size, open, read_all, read_git, read_git_kept, still_too_large, too_large, Answer, Opened, Outcome, TreeObjects};
use crate::git_store::Objects;
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

#[cfg(feature = "grammars")]
#[test]
fn acquisition_reads_rust_with_its_grammar_and_keeps_derived_request_flags() {
    let source = "mod other;\nuse crate::other::Named;\npub struct Kept;\n";
    let root = repository("acquire-rust-grammar", &[("src/lib.rs", source.as_bytes())]);
    let read = read_all(root.to_string_lossy().into_owned(), vec!["src/lib.rs".to_owned()], None, Some(true), None, true);
    let answer = serde_json::to_value(&read[0].0).unwrap();
    std::fs::remove_dir_all(root).unwrap();
    assert_eq!(answer["requests"][0]["value"], "self::other");
    assert_eq!(answer["requests"][1]["guessed"], true);
    assert_eq!(answer["symbols"][1]["name"], "Kept");
    assert!(answer.get("unknown").is_none());
}

#[test]
fn a_wave_reads_each_tracked_blob_out_of_the_store_and_declines_an_oversized_one_by_its_size() {
    let answers = wave("acquire-wave", &[("large.ts", b"export const large = 'xxxxxxxxxxxxxxxx';\n"), ("next.ts", b"export const y = 1;\n")], 32, |_| {});

    let (large, named) = &answers["large.ts"];
    assert_eq!(large.2, Outcome::Declined);
    assert!(large.1.is_empty(), "record identity does not change the public byte-digest column of a declined read");
    assert!(large.0.unknown().is_some_and(|unknown| declined_for_size("large.ts", unknown)));
    assert!(!named);
    let (next, named) = &answers["next.ts"];
    assert_eq!(next.2, Outcome::Parsed);
    assert!(named, "bytes out of Git's object store are the blob asked for");
    assert!(answers.values().all(|(answer, _)| answer.2 != Outcome::Failed));
}

#[test]
fn a_known_blob_that_is_missing_does_not_substitute_worktree_bytes() {
    let root = repository("acquire-known-missing", &[("a.ts", b"export const worktree = 1;\n")]);
    let objects = Objects::open(&root).unwrap();
    let (read, named) = read_git(Some(&objects), root.to_string_lossy().into_owned(),
        vec!["a.ts".to_owned()], vec![Some([0xff; 20])], Some(1024), Some(true), None, true);
    assert_eq!(read[0].2, Outcome::Failed, "the listed identity is missing even though its path exists");
    assert!(read[0].0.unknown().unwrap().contains("Git"));
    assert_eq!(named, [false]);
    std::fs::remove_dir_all(root).unwrap();
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
        Opened::Settled(read, outcome) => (outcome, read.unknown().map(str::to_owned)),
        Opened::Source(_) => (Outcome::Parsed, None),
        Opened::DeclinedBlob(..) => panic!("a worktree open acquired no Git blob"),
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

#[test]
fn a_size_refusal_wins_over_invalid_utf8_in_the_bounded_prefix() {
    let root = std::env::temp_dir().join(format!("sense-acquire-utf8-limit-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let unicode = "export const value = '🦀';\n";
    let limit = unicode.find('🦀').unwrap() as u64;
    for (file, source, largest) in [
        ("split.js", unicode.as_bytes(), limit),
        ("binary.js", b"\xffxxxxx".as_slice(), 2),
    ] {
        std::fs::write(root.join(file), source).unwrap();
        let Opened::Settled(read, outcome) = open(&root, file, largest, false, None).1 else {
            panic!("an oversized file is never source");
        };
        assert_eq!(outcome, Outcome::Declined);
        assert_eq!(read.unknown(), Some(too_large(file, source.len() as u64, largest).as_str()));
    }
    std::fs::write(root.join("exact.js"), unicode).unwrap();
    let Opened::Source(source) = open(&root, "exact.js", unicode.len() as u64, false, None).1 else {
        panic!("a complete UTF-8 scalar at the byte limit is source");
    };
    assert_eq!(source, unicode);
    std::fs::write(root.join("empty.js"), b"").unwrap();
    assert!(matches!(open(&root, "empty.js", 0, false, None).1, Opened::Source(source) if source.is_empty()));
    std::fs::remove_dir_all(root).unwrap();
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
        Opened::DeclinedBlob(..) => panic!("a worktree open acquired no Git blob"),
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
    assert!(read.unknown().is_none());
}

#[test]
fn an_lfs_pointer_over_the_source_limit_still_reads_small_worktree_content() {
    let answers = wave("acquire-lfs-small-limit", &[("a.ts", POINTER.as_bytes())], 16,
        |root| write(root, "a.ts", b"const a=1;"));
    let ((read, digest, outcome), named) = &answers["a.ts"];
    assert_eq!(*outcome, Outcome::Parsed, "the source limit applies to the smudged content, not its Git pointer");
    assert!(read.unknown().is_none());
    assert_eq!(*digest, crate::digest::of_string("const a=1;"));
    assert!(!named, "worktree bytes do not gain their pointer's identity");
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
    assert!(read.unknown().unwrap().starts_with("a.ts is a git-LFS pointer"));
}

#[test]
fn a_worktree_only_tree_reads_the_checkout() {
    let root = repository("acquire-worktree-only", &[("a.ts", b"export const committed = 1;\n")]);
    let oid = git(&root, &["rev-parse", "HEAD:a.ts"]);
    write(&root, "a.ts", b"export const edited = 2;\n");
    let store = TreeObjects::worktree();
    let objects = store.objects_now(&root);
    assert!(objects.is_none(), "an explicit worktree read never opens the object store");
    let (read, named) = read_git(objects.as_deref(), root.to_string_lossy().into_owned(), vec!["a.ts".into()],
        vec![crate::git::parse_oid(oid.as_bytes())], Some(1024), Some(true), None, true);
    assert_eq!(read[0].0.module().unwrap().symbols[0].name, "edited");
    assert_eq!(read[0].1, crate::digest::of_string("export const edited = 2;\n"));
    assert_eq!(named, [false]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_tree_opens_one_store_for_all_its_scans() {
    let root = repository("acquire-wave-store", &[("a.ts", b"export const a = 1;\n")]);
    let store = TreeObjects::default();
    let first = store.objects_now(&root).unwrap();
    let after = store.objects_now(&root).unwrap();
    assert!(std::sync::Arc::ptr_eq(&first, &after));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn an_untracked_content_hit_keeps_its_place_beside_a_git_blob() {
    let root = repository("acquire-content-hit", &[("tracked.ts", b"export const tracked = 1;\n")]);
    let source = "export const loose = 2;\n";
    write(&root, "loose.ts", source.as_bytes());
    let cached = read_all(root.to_str().unwrap().to_owned(), vec!["loose.ts".to_owned()], None, Some(true), None, true).remove(0);
    let oid = crate::git::parse_oid(git(&root, &["rev-parse", "HEAD:tracked.ts"]).as_bytes()).unwrap();
    let objects = Objects::open(&root).unwrap();
    let lookups = std::cell::Cell::new(0);
    let kept = |identity: &str, file: &str| {
        lookups.set(lookups.get() + 1);
        if file == "tracked.ts" { return None; }
        assert_eq!((identity, file), (cached.1.as_str(), "loose.ts"));
        Some(cached.0.clone())
    };
    let (read, named, reused) = read_git_kept(Some(&objects), root.to_str().unwrap().to_owned(),
        vec!["tracked.ts".to_owned(), "loose.ts".to_owned()], vec![Some(oid), None], None, Some(true), None, true, &kept, None);
    assert_eq!(lookups.get(), 2);
    assert_eq!(named.into_iter().map(super::Origin::parsed_blob).collect::<Vec<_>>(), [true, false]);
    assert_eq!(reused, [false, true]);
    assert_eq!(read[0].0.module().unwrap().symbols[0].name, "tracked");
    assert_eq!(read[1].1, cached.1);
    assert_eq!(serde_json::to_value(&read[1].0).unwrap(), serde_json::to_value(&cached.0).unwrap());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn an_unsized_tracked_hit_and_untracked_hit_keep_whole_parses_in_input_order() {
    let root = repository("acquire-mixed-unsized", &[("tracked.css", b"a { color: red; }\n")]);
    write(&root, "loose.css", b"b { color: blue; }\n");
    let cached = read_all(root.to_str().unwrap().to_owned(), vec!["loose.css".into(), "tracked.css".into()], None, Some(true), None, true);
    assert!(cached.iter().all(|row| row.0.size().is_none()));
    let oid = crate::git::parse_oid(git(&root, &["rev-parse", "HEAD:tracked.css"]).as_bytes()).unwrap();
    let objects = Objects::open(&root).unwrap();
    std::fs::remove_file(root.join("tracked.css")).unwrap();
    let kept = |identity: &str, file: &str| {
        let at = usize::from(file == "tracked.css");
        let expected = if at == 1 { crate::git::spell(&oid) } else { cached[0].1.clone() };
        assert_eq!(identity, expected);
        Some(cached[at].0.clone())
    };
    let (read, named, reused) = read_git_kept(Some(&objects), root.to_str().unwrap().to_owned(),
        vec!["loose.css".into(), "tracked.css".into()], vec![None, Some(oid)], None, Some(true), None, true, &kept, Some(&[false, true]));
    assert_eq!(reused, [true, true]);
    assert_eq!(named.into_iter().map(super::Origin::parsed_blob).collect::<Vec<_>>(), [false, true]);
    for (read, cached) in read.iter().zip(cached) {
        assert_eq!(serde_json::to_value(&read.0).unwrap(), serde_json::to_value(&cached.0).unwrap());
        assert_eq!(read.2, Outcome::Parsed);
    }
    std::fs::remove_dir_all(root).unwrap();
}
