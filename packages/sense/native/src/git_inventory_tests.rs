//! Membership and byte contracts across Git's index layouts.
use std::path::Path;
use std::process::Command;
use crate::git_fixture::{git, repository, write};

fn check(root: &Path, expected: &[(&str, &[u8], bool)], unhashed: &[&str]) {
    {
        let tree = super::snapshot(root.to_str().unwrap()).unwrap();
        let actual: Vec<_> = tree.paths.iter().zip(&tree.oids).zip(&tree.regular)
            .map(|((path, oid), regular)| (path.as_str(), super::hex(oid), *regular)).collect();
        let mut wanted: Vec<_> = expected.iter().map(|(path, bytes, regular)| {
            (*path, gix_object::compute_hash(gix_hash::Kind::Sha1, gix_object::Kind::Blob, bytes).unwrap().to_string(), *regular)
        }).collect();
        wanted.sort_by(|a, b| crate::order::code_unit(a.0, b.0));
        assert_eq!(actual, wanted, "root={root:?}");
        let mut unknown = tree.unhashed;
        unknown.sort();
        let mut wanted: Vec<_> = unhashed.iter().map(|path| (*path).to_owned()).collect();
        wanted.sort();
        assert_eq!(unknown, wanted);
    }
}

#[test]
fn staged_changes_and_intent_to_add_keep_worktree_bytes_and_dirty_proof() {
    let root = repository("inventory-staged", &[("edit.ts", b"old\n"), ("gone.ts", b"gone\n"), ("move.ts", b"move\n"), ("same.ts", b"same\n"), ("type.ts", b"type\n")]);
    write(&root, "edit.ts", b"staged\n");
    git(&root, &["add", "edit.ts"]);
    write(&root, "edit.ts", b"disk\n");
    git(&root, &["rm", "-q", "gone.ts"]);
    git(&root, &["mv", "move.ts", "moved.ts"]);
    write(&root, "added.ts", b"added\n");
    git(&root, &["add", "added.ts"]);
    write(&root, "empty.ts", b"");
    write(&root, "intent.ts", b"intent\n");
    git(&root, &["add", "-N", "empty.ts", "intent.ts"]);
    std::fs::remove_file(root.join("type.ts")).unwrap();
    std::os::unix::fs::symlink("same.ts", root.join("type.ts")).unwrap();
    git(&root, &["add", "type.ts"]);
    check(&root, &[("edit.ts", b"disk\n", false), ("moved.ts", b"move\n", false), ("same.ts", b"same\n", true), ("type.ts", b"same\n", false), ("added.ts", b"added\n", false), ("empty.ts", b"", false), ("intent.ts", b"intent\n", false)], &[]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn sparse_and_split_indexes_keep_indexed_membership_and_worktree_edits() {
    for (name, args) in [("sparse", vec!["sparse-checkout", "init", "--cone", "--sparse-index"]), ("flat", vec!["sparse-checkout", "init", "--cone", "--no-sparse-index"]), ("split", vec!["update-index", "--split-index"])] {
        let root = repository(&format!("inventory-{name}"), &[("a/x.ts", b"a\n"), ("b/y.ts", b"b\n")]);
        git(&root, &args);
        if name != "split" { git(&root, &["sparse-checkout", "set", "a"]); }
        check(&root, &[("a/x.ts", b"a\n", true), ("b/y.ts", b"b\n", true)], &[]);
        write(&root, "b/y.ts", b"changed\n");
        check(&root, &[("a/x.ts", b"a\n", true), ("b/y.ts", b"changed\n", false)], &[]);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn roots_and_cross_root_renames_keep_only_the_supplied_scope() {
    let root = repository("inventory-root", &[("sub/a.ts", b"a\n"), ("sub/out.ts", b"out\n"), ("beside/in.ts", b"in\n"), ("beside/b.ts", b"b\n")]);
    git(&root, &["mv", "sub/out.ts", "beside/out.ts"]);
    git(&root, &["mv", "beside/in.ts", "sub/in.ts"]);
    check(&root.join("sub"), &[("a.ts", b"a\n", true), ("in.ts", b"in\n", false)], &[]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn conflicts_use_worktree_bytes_instead_of_stage_objects() {
    for (name, initial, ours, theirs) in [("uu", Some(b"base\n".as_slice()), Some(b"ours\n".as_slice()), Some(b"theirs\n".as_slice())), ("aa", None, Some(b"ours\n".as_slice()), Some(b"theirs\n".as_slice())), ("dd", Some(b"base\n".as_slice()), None, None)] {
        let root = repository(&format!("inventory-conflict-{name}"), &[("kept.ts", b"kept\n")]);
        if let Some(bytes) = initial { write(&root, "c.ts", bytes); crate::git_fixture::commit(&root); }
        git(&root, &["checkout", "-q", "-b", "side"]);
        if let Some(bytes) = theirs { write(&root, "c.ts", bytes); } else { git(&root, &["rm", "-q", "c.ts"]); }
        crate::git_fixture::commit(&root);
        git(&root, &["checkout", "-q", "main"]);
        if let Some(bytes) = ours { write(&root, "c.ts", bytes); } else { git(&root, &["rm", "-q", "c.ts"]); }
        crate::git_fixture::commit(&root);
        let result = Command::new("git").args(["-c", "user.email=t@e.test", "-c", "user.name=T", "merge", "--no-edit", "side"]).current_dir(&root).output().unwrap();
        if name == "dd" {
            assert!(result.status.success());
            check(&root, &[("kept.ts", b"kept\n", true)], &[]);
        } else {
            assert!(!result.status.success());
            let bytes = std::fs::read(root.join("c.ts")).unwrap();
            check(&root, &[("kept.ts", b"kept\n", true), ("c.ts", &bytes, false)], &[]);
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn unborn_and_missing_indexes_keep_files_and_linked_worktrees_keep_identity() {
    let root = repository("inventory-missing", &[("a.ts", b"a\n")]);
    std::fs::remove_file(root.join(".git/index")).unwrap();
    check(&root, &[("a.ts", b"a\n", false)], &[]);
    git(&root, &["add", "-A"]);
    let linked = root.with_extension("linked");
    let _ = std::fs::remove_dir_all(&linked);
    git(&root, &["worktree", "add", "-q", "--detach", linked.to_str().unwrap()]);
    check(&linked, &[("a.ts", b"a\n", true)], &[]);
    std::fs::remove_dir_all(linked).unwrap();
    let unborn = root.with_extension("unborn");
    let _ = std::fs::remove_dir_all(&unborn);
    std::fs::create_dir_all(&unborn).unwrap();
    git(&unborn, &["init", "-q"]);
    write(&unborn, "a.ts", b"a\n");
    git(&unborn, &["add", "a.ts"]);
    check(&unborn, &[("a.ts", b"a\n", false)], &[]);
    std::fs::remove_dir_all(root).unwrap();
    std::fs::remove_dir_all(unborn).unwrap();
}

#[test]
fn nul_records_preserve_tabs_and_newlines() {
    let root = repository("inventory-names", &[("with\ttab.ts", b"tab\n"), ("with\nline.ts", b"line\n")]);
    crate::git_fixture::commit(&root);
    check(&root, &[("with\ttab.ts", b"tab\n", true), ("with\nline.ts", b"line\n", true)], &[]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn alternate_index_keeps_its_files_and_uses_current_worktree_bytes() {
    if let Some(root) = std::env::var_os("SENSE_INVENTORY_ALTERNATE") {
        let root = std::path::PathBuf::from(root);
        check(&root, &[("a.ts", b"a\n", true), ("added.ts", b"added\n", false)], &[]);
        return;
    }
    let root = repository("inventory-alternate", &[("a.ts", b"a\n")]);
    let alternate = root.join(".git/alternate");
    std::fs::copy(root.join(".git/index"), &alternate).unwrap();
    write(&root, "added.ts", b"added\n");
    assert!(Command::new("git").args(["add", "added.ts"]).env("GIT_INDEX_FILE", &alternate).current_dir(&root).status().unwrap().success());
    let result = Command::new(std::env::current_exe().unwrap()).args(["--exact", "git::inventory_tests::alternate_index_keeps_its_files_and_uses_current_worktree_bytes", "--nocapture"]).env("SENSE_INVENTORY_ALTERNATE", &root).env("GIT_INDEX_FILE", &alternate).output().unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stdout));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn an_unmerged_delete_has_no_conflict_side_identity() {
    use std::io::Write;
    let root = repository("inventory-conflict-delete", &[("c.ts", b"base\n"), ("kept.ts", b"kept\n")]);
    let oid = git(&root, &["rev-parse", "HEAD:c.ts"]);
    git(&root, &["update-index", "--force-remove", "c.ts"]);
    let mut command = Command::new("git").args(["update-index", "--index-info"]).current_dir(&root).stdin(std::process::Stdio::piped()).spawn().unwrap();
    command.stdin.take().unwrap().write_all(format!("100644 {oid} 1\tc.ts\n").as_bytes()).unwrap();
    assert!(command.wait().unwrap().success());
    std::fs::remove_file(root.join("c.ts")).unwrap();
    assert!(git(&root, &["status", "--porcelain=v1"]).contains("DD c.ts"));
    check(&root, &[("kept.ts", b"kept\n", true)], &[]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn inventory_records_preserve_byte_paths_and_only_stage_zero_files() {
    let oid = "0123456789abcdef0123456789abcdef01234567";
    let mut bytes = format!("100644 {oid} 0\tsub/a\ttab\nline.ts\0").into_bytes();
    bytes.extend_from_slice(format!("120000 {oid} 0\tsub/raw-").as_bytes());
    bytes.extend_from_slice(b"\xff.ts\0");
    for (mode, stage, path) in [("100644", "1", "conflict.ts"), ("100644", "2", "conflict.ts"), ("100644", "3", "conflict.ts"), ("160000", "0", "module")] {
        bytes.extend_from_slice(format!("{mode} {oid} {stage}\tsub/{path}\0").as_bytes());
    }
    let (listed, links) = super::inventory(&bytes, b"sub/").unwrap();
    assert_eq!(listed.iter().map(|(path, _)| path.as_slice()).collect::<Vec<_>>(), [b"a\ttab\nline.ts".as_slice(), b"raw-\xff.ts".as_slice()]);
    assert_eq!(links.into_iter().collect::<Vec<_>>(), [b"raw-\xff.ts".to_vec()]);
}

#[test]
fn incomplete_or_unknown_inventory_records_decline_the_whole_answer() {
    let oid = "0123456789abcdef0123456789abcdef01234567";
    for record in [format!("100644 {oid} 0\tsub/a.ts"), format!("100644 {oid} 4\tsub/a.ts\0"), format!("040000 {oid} 0\tsub/a.ts\0"), format!("100644 {oid} 0 extra\tsub/a.ts\0"), format!("100644 {oid} 0\tbeside/a.ts\0"), format!("100644 {oid} 0\tsub/\0"), format!("100644 {oid}{oid} 0\tsub/a.ts\0"), "\0".to_owned()] {
        assert!(super::inventory(record.as_bytes(), b"sub/").is_none(), "{record:?}");
    }
    assert!(super::inventory(&[], b"sub/").unwrap().0.is_empty());
}
