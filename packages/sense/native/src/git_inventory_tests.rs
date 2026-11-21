//! The working inventory agrees with Git across index layouts and scan roots.

use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::Path;
use std::process::Command;

use crate::git_fixture::{commit, git, repository, write};

fn agrees(at: &Path, native: bool) -> Vec<String> {
    let checkout = crate::git_store::checkout(at).unwrap();
    let listed = super::read(&checkout).unwrap();
    assert_eq!(listed.index.is_some(), native, "from {}", at.display());
    let actual: Vec<_> = listed.blobs.into_iter().map(|(path, id, link)| (path, id.to_string(), link)).collect();
    let output = Command::new("git")
        .args(["--no-optional-locks", "ls-files", "--stage", "-z", "--", "."])
        .current_dir(at)
        .output()
        .unwrap();
    assert!(output.status.success());
    let expected: Vec<_> = output.stdout.split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .filter_map(|entry| {
            let tab = entry.iter().position(|byte| *byte == b'\t').unwrap();
            let fields = std::str::from_utf8(&entry[..tab]).unwrap().split_whitespace().collect::<Vec<_>>();
            (fields[0] != "160000").then(|| (entry[tab + 1..].to_vec(), fields[1].to_owned(), fields[0] == "120000"))
        })
        .collect();
    assert_eq!(actual, expected, "from {}", at.display());
    actual.into_iter().map(|(path, _, _)| String::from_utf8(path).unwrap()).collect()
}

#[test]
fn indexed_file_kinds_and_byte_order_agree_with_git_at_nested_roots() {
    let root = repository("inventory-kinds", &[
        ("apps/x/a.ts", b"a\n"),
        ("apps/x/a.b", b"b\n"),
        ("apps/x/a/c.ts", b"c\n"),
        ("apps/x/deep/d.ts", b"d\n"),
        ("apps/y/e.ts", b"e\n"),
        ("top.ts", b"top\n"),
    ]);
    symlink("a.ts", root.join("apps/x/link.ts")).unwrap();
    std::fs::set_permissions(root.join("apps/x/a.b"), std::fs::Permissions::from_mode(0o755)).unwrap();
    commit(&root);
    let id = git(&root, &["rev-parse", "HEAD"]);
    git(&root, &["update-index", "--add", "--cacheinfo", &format!("160000,{id},apps/x/sub")]);

    agrees(&root, true);
    assert_eq!(agrees(&root.join("apps/x"), true), ["a.b", "a.ts", "a/c.ts", "deep/d.ts", "link.ts"]);
    assert_eq!(agrees(&root.join("apps/x/deep"), true), ["d.ts"]);
    write(&root, "untracked/new.ts", b"not indexed\n");
    assert!(agrees(&root.join("untracked"), true).is_empty());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_split_index_is_read_natively_with_its_staged_additions_and_deletions() {
    let root = repository("inventory-split", &[("src/a.ts", b"a\n"), ("src/gone.ts", b"gone\n"), ("b.ts", b"b\n")]);
    git(&root, &["update-index", "--split-index"]);
    assert!(!git(&root, &["rev-parse", "--shared-index-path"]).is_empty());
    write(&root, "src/a.ts", b"staged\n");
    write(&root, "src/new.ts", b"new\n");
    git(&root, &["add", "src/a.ts", "src/new.ts"]);
    git(&root, &["rm", "--quiet", "src/gone.ts"]);
    agrees(&root, true);
    assert_eq!(agrees(&root.join("src"), true), ["a.ts", "new.ts"]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn git_expands_a_sparse_index_including_paths_outside_the_checkout_patterns() {
    let root = repository("inventory-sparse", &[("a/x.ts", b"a\n"), ("b/deep/y.ts", b"b\n"), ("top.ts", b"top\n")]);
    git(&root, &["sparse-checkout", "set", "--cone", "--sparse-index", "a"]);
    let checkout = crate::git_store::checkout(&root).unwrap();
    let index = gix_index::File::at(&checkout.index, gix_hash::Kind::Sha1, false, Default::default()).unwrap();
    assert!(index.is_sparse(), "the fixture exercises sparse expansion");
    assert_eq!(agrees(&root, false), ["a/x.ts", "b/deep/y.ts", "top.ts"]);
    assert_eq!(agrees(&root.join("a"), false), ["x.ts"]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn an_unborn_checkout_can_have_no_index_an_empty_index_or_staged_files() {
    let root = repository("inventory-unborn", &[("src/a.ts", b"a\n")]);
    git(&root, &["checkout", "--quiet", "--orphan", "unborn"]);
    git(&root, &["rm", "--quiet", "-r", "--cached", "."]);
    assert!(agrees(&root, true).is_empty());
    let index = crate::git_store::checkout(&root).unwrap().index;
    std::fs::remove_file(index).unwrap();
    assert!(agrees(&root, true).is_empty());
    git(&root, &["add", "src/a.ts"]);
    assert_eq!(agrees(&root, true), ["src/a.ts"]);
    assert_eq!(agrees(&root.join("src"), true), ["a.ts"]);
    std::fs::remove_dir_all(root).unwrap();
}
