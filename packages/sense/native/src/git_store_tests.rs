//! Checkout bytes out of git's object store, against fixture repositories
//! built in a temporary directory: each case is a way the store's blob and the
//! file on disk can differ, and the store must step aside for every one.

use std::process::Command;

use super::Store;
use crate::git_fixture::{commit, git, repository, settle, write};

/// The bytes the store gives for `file` under `root`, or `None` when the file
/// is to be read from the worktree.
fn stored(store: &Store, file: &str) -> Option<Vec<u8>> {
    let blob = store.checked_out(file)?;
    store.reader().checkout_bytes(&blob).map(<[u8]>::to_vec)
}

const A: &[u8] = b"export const a = 1;\n";

#[test]
fn a_tracked_file_unchanged_since_the_index_recorded_it_is_read_from_the_store() {
    let root = repository("git-store-clean", &[("src/a.ts", A), ("src/b.ts", b"export const b = 2;\n")]);
    git(&root, &["gc", "--quiet"]);

    let store = Store::open(&root).expect("a plain repository opens");
    assert_eq!(stored(&store, "src/a.ts").as_deref(), Some(A));
    assert_eq!(stored(&store, "src/b.ts").as_deref(), Some(&b"export const b = 2;\n"[..]));
}

#[test]
fn a_loose_object_is_read_like_a_packed_one() {
    let root = repository("git-store-loose", &[("a.ts", A)]);

    let store = Store::open(&root).unwrap();
    assert_eq!(stored(&store, "a.ts").as_deref(), Some(A), "an id, a fresh stat and an equal size prove the bytes wherever the object lies");
}

#[test]
fn a_file_edited_to_the_same_length_is_read_from_the_worktree() {
    let root = repository("git-store-edited", &[("a.ts", A)]);
    write(&root, "a.ts", b"export const a = 2;\n");

    assert_eq!(stored(&Store::open(&root).unwrap(), "a.ts"), None);
}

#[test]
fn a_file_the_index_does_not_hold_as_a_fresh_regular_file_is_read_from_the_worktree() {
    let root = repository("git-store-entries", &[("plain.ts", A), ("skip.ts", A), ("assumed.ts", A), ("linked-target.ts", A)]);
    std::os::unix::fs::symlink("linked-target.ts", root.join("link.ts")).unwrap();
    write(&root, "sub/inner.ts", A);
    git(&root.join("sub"), &["init", "--quiet"]);
    git(&root.join("sub"), &["add", "-A"]);
    git(&root.join("sub"), &["commit", "--quiet", "-m", "inner"]);
    commit(&root);
    git(&root, &["update-index", "--skip-worktree", "skip.ts"]);
    git(&root, &["update-index", "--assume-unchanged", "assumed.ts"]);
    write(&root, "added.ts", A);
    git(&root, &["add", "-N", "added.ts"]);
    write(&root, "untracked.ts", A);

    let store = Store::open(&root).unwrap();
    assert_eq!(stored(&store, "plain.ts").as_deref(), Some(A));
    for file in ["skip.ts", "assumed.ts", "link.ts", "sub", "sub/inner.ts", "added.ts", "untracked.ts", "missing.ts"] {
        assert_eq!(stored(&store, file), None, "{file}");
    }
}

#[test]
fn a_path_in_conflict_is_read_from_the_worktree() {
    let root = repository("git-store-conflict", &[("a.ts", A)]);
    git(&root, &["checkout", "--quiet", "-b", "other"]);
    write(&root, "a.ts", b"export const a = 'other';\n");
    commit(&root);
    git(&root, &["checkout", "--quiet", "main"]);
    write(&root, "a.ts", b"export const a = 'main';\n");
    commit(&root);
    let merged = Command::new("git")
        .args(["-c", "user.email=test@example.test", "-c", "user.name=Test", "merge", "other"])
        .current_dir(&root)
        .output()
        .unwrap();
    assert!(String::from_utf8_lossy(&merged.stdout).contains("CONFLICT"), "the merge conflicts: {merged:?}");
    git(&root, &["checkout", "--ours", "a.ts"]);
    settle(&root);

    assert_eq!(stored(&Store::open(&root).unwrap(), "a.ts"), None, "only stages 1 to 3 are in the index");
}

#[test]
fn a_checkout_whose_line_endings_an_attribute_since_removed_rewrote_is_read_from_the_worktree() {
    let root = repository("git-store-crlf", &[(".gitattributes", b"* text eol=crlf\n"), ("a.ts", b"one\ntwo\n")]);
    std::fs::remove_file(root.join("a.ts")).unwrap();
    git(&root, &["checkout", "--", "a.ts"]);
    assert_eq!(std::fs::read(root.join("a.ts")).unwrap(), b"one\r\ntwo\r\n");
    settle(&root);
    git(&root, &["update-index", "--refresh"]);
    git(&root, &["rm", "--quiet", ".gitattributes"]);
    git(&root, &["commit", "--quiet", "-m", "no attributes"]);

    assert_eq!(stored(&Store::open(&root).unwrap(), "a.ts"), None, "the blob is shorter than the checkout");
}

#[test]
fn a_blob_over_the_largest_the_store_inflates_is_read_from_the_worktree() {
    let large = vec![b'a'; super::STORE_LARGEST as usize + 1];
    let fits = vec![b'a'; super::STORE_LARGEST as usize];
    let root = repository("git-store-large", &[("large.txt", &large), ("fits.txt", &fits)]);

    let store = Store::open(&root).unwrap();
    assert_eq!(stored(&store, "large.txt"), None);
    assert_eq!(stored(&store, "fits.txt"), Some(fits));
}

#[test]
fn a_blob_that_is_an_lfs_pointer_is_read_from_the_worktree() {
    let pointer = b"version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 20\n";
    let root = repository("git-store-lfs", &[("a.bin", pointer)]);

    assert_eq!(stored(&Store::open(&root).unwrap(), "a.bin"), None);
}

#[test]
fn an_object_whose_pack_is_gone_from_under_the_store_is_read_from_the_worktree() {
    let root = repository("git-store-repacked", &[("a.ts", A)]);
    git(&root, &["gc", "--quiet"]);
    let store = Store::open(&root).unwrap();
    let blob = store.checked_out("a.ts").expect("fresh");
    for entry in std::fs::read_dir(root.join(".git/objects/pack")).unwrap() {
        std::fs::remove_file(entry.unwrap().path()).unwrap();
    }

    assert_eq!(store.reader().checkout_bytes(&blob), None);
}

#[test]
fn a_root_below_the_top_of_the_checkout_names_its_files_from_itself() {
    let root = repository("git-store-nested", &[("src/a.ts", b"export const top = 1;\n"), ("apps/x/src/a.ts", A)]);

    let store = Store::open(&root.join("apps/x")).unwrap();
    assert_eq!(stored(&store, "src/a.ts").as_deref(), Some(A));
}

#[test]
fn a_linked_worktree_and_a_split_index_read_from_the_store() {
    let root = repository("git-store-linked", &[("a.ts", A)]);
    let linked = root.with_file_name(format!("{}-wt", root.file_name().unwrap().to_str().unwrap()));
    let _ = std::fs::remove_dir_all(&linked);
    git(&root, &["worktree", "add", "--quiet", linked.to_str().unwrap()]);
    settle(&linked);
    git(&linked, &["update-index", "--refresh"]);
    git(&root, &["update-index", "--split-index"]);
    settle(&root);
    git(&root, &["update-index", "--refresh"]);

    assert_eq!(stored(&Store::open(&linked).unwrap(), "a.ts").as_deref(), Some(A));
    assert_eq!(stored(&Store::open(&root).unwrap(), "a.ts").as_deref(), Some(A));
    std::fs::remove_dir_all(&linked).unwrap();
}

#[test]
fn a_replace_ref_even_packed_keeps_the_store_shut() {
    let root = repository("git-store-replace", &[("a.ts", A), ("b.ts", b"export const b = 2;\n")]);
    let a = git(&root, &["rev-parse", "HEAD:a.ts"]);
    let b = git(&root, &["rev-parse", "HEAD:b.ts"]);
    git(&root, &["replace", &a, &b]);
    git(&root, &["pack-refs", "--all"]);

    assert!(Store::open(&root).is_none());
    assert!(super::Objects::open(&root).is_none(), "the scan's reader refuses it too");
    assert!(super::head(&root).is_some_and(|head| head.committed(None).is_none()), "the listing leaves it to `ls-tree`");
}

#[test]
fn a_loose_replace_ref_seen_from_a_linked_worktree_keeps_the_store_shut() {
    let root = repository("git-store-replace-loose", &[("a.ts", A), ("b.ts", b"export const b = 2;\n")]);
    let linked = root.with_file_name("git-store-replace-loose-linked");
    let _ = std::fs::remove_dir_all(&linked);
    git(&root, &["worktree", "add", "-q", "--detach", linked.to_str().unwrap()]);
    assert!(super::Objects::open(&linked).is_some());
    assert!(super::head(&linked).is_some_and(|head| head.committed(None).is_some()));

    let a = git(&root, &["rev-parse", "HEAD:a.ts"]);
    let b = git(&root, &["rev-parse", "HEAD:b.ts"]);
    git(&root, &["replace", &a, &b]);

    assert!(Store::open(&linked).is_none());
    assert!(super::Objects::open(&linked).is_none());
    assert!(super::head(&linked).is_some_and(|head| head.committed(None).is_none()));
    std::fs::remove_dir_all(&linked).unwrap();
}

#[test]
fn a_custom_smudge_filter_keeps_the_store_shut_and_lfs_does_not() {
    let root = repository("git-store-filter", &[("a.ts", A)]);
    git(&root, &["config", "filter.lfs.clean", "git-lfs clean -- %f"]);
    git(&root, &["config", "filter.lfs.smudge", "git-lfs smudge -- %f"]);
    git(&root, &["config", "filter.lfs.process", "git-lfs filter-process"]);
    assert!(Store::open(&root).is_some(), "git-lfs smudges into the bytes a pointer stands for, which the pointer check refuses");

    git(&root, &["config", "filter.same.smudge", "tr a b"]);
    assert!(Store::open(&root).is_none(), "a smudge that keeps the length is caught by nothing per file");
}

#[test]
fn a_custom_clean_filter_alone_keeps_the_store_shut() {
    let root = repository("git-store-clean-filter", &[("a.ts", A)]);
    git(&root, &["config", "filter.canonical.clean", "tr b a"]);
    assert!(Store::open(&root).is_none(), "a clean filter commits other bytes than the checkout holds, at the same length");
}

#[test]
fn a_working_tree_encoding_anywhere_keeps_the_store_shut() {
    // `中中a\n` is eight bytes in UTF-8 and in UTF-16LE: the size proves nothing.
    let utf16: Vec<u8> = "中中a\n".encode_utf16().flat_map(u16::to_le_bytes).collect();
    assert_eq!(utf16.len(), "中中a\n".len());
    let root = repository("git-store-encoding", &[(".gitattributes", b"a.ts working-tree-encoding=UTF-16LE\n"), ("a.ts", &utf16)]);
    assert!(Store::open(&root).is_none(), "a checked-in attribute");

    let root = repository("git-store-encoding-info", &[("a.ts", A)]);
    write(&root, ".git/info/attributes", b"*.ts working-tree-encoding=UTF-16LE\n");
    assert!(Store::open(&root).is_none(), "the repository's own attributes");

    // Git reads a relative `core.attributesFile` from the top of the worktree,
    // whatever directory asked: here neither this process's nor the root's.
    let root = repository("git-store-encoding-global", &[("apps/x/a.ts", A)]);
    write(&root, "attrs", b"*.ts working-tree-encoding=UTF-16LE\n");
    git(&root, &["config", "core.attributesFile", "attrs"]);
    assert!(Store::open(&root.join("apps/x")).is_none(), "a relative global attributes file");
}

#[test]
fn a_blob_holding_an_id_under_an_ident_attribute_is_read_from_the_worktree() {
    // Checkout writes `$Id: <the blob's id> $` over whatever `$Id: … $` the
    // blob holds, at the same length when the blob holds forty characters there.
    let root = repository("git-store-ident", &[(".gitattributes", b"*.txt ident\n"), ("a.txt", b"$Id$ x\n"), ("b.txt", b"plain\n")]);

    let store = Store::open(&root).unwrap();
    assert_eq!(stored(&store, "a.txt"), None);
    assert_eq!(stored(&store, "b.txt").as_deref(), Some(&b"plain\n"[..]), "a blob holding no id");
}

#[test]
fn a_root_outside_any_sha1_repository_opens_nothing() {
    let plain = std::env::temp_dir().join(format!("sense-git-store-none-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&plain);
    std::fs::create_dir_all(&plain).unwrap();
    assert!(Store::open(&plain).is_none());

    let sha256 = std::env::temp_dir().join(format!("sense-git-store-sha256-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&sha256);
    std::fs::create_dir_all(&sha256).unwrap();
    git(&sha256, &["init", "--quiet", "--object-format=sha256"]);
    write(&sha256, "a.ts", A);
    commit(&sha256);
    assert!(Store::open(&sha256).is_none());
    assert!(super::Objects::open(&sha256).is_none() && super::Objects::open(&plain).is_none());
}

#[test]
fn an_entry_not_older_than_the_index_is_read_from_the_worktree() {
    let root = repository("git-store-racy", &[("a.ts", A)]);
    write(&root, "b.ts", A);
    // Ahead of the index whatever the clock says: a same-size write after the
    // index did would match the entry's stat and still differ.
    assert!(Command::new("touch").args(["-t", "203001010000", "b.ts"]).current_dir(&root).status().unwrap().success());
    git(&root, &["add", "b.ts"]);

    let store = Store::open(&root).unwrap();
    assert_eq!(stored(&store, "a.ts").as_deref(), Some(A));
    assert_eq!(stored(&store, "b.ts"), None, "a racy entry proves nothing");
}

#[test]
fn more_packs_than_the_limit_keep_the_store_shut_until_a_multi_pack_index_covers_them() {
    let root = repository("git-store-packs", &[("a.ts", A)]);
    git(&root, &["config", "gc.auto", "0"]);
    git(&root, &["config", "maintenance.auto", "false"]);
    for at in 0..super::PACK_LIMIT {
        write(&root, &format!("p{at}.ts"), format!("export const p = {at};\n").as_bytes());
        git(&root, &["add", "-A"]);
        git(&root, &["commit", "--quiet", "-m", "pack"]);
        git(&root, &["repack", "-d", "-q"]);
    }
    let packs = std::fs::read_dir(root.join(".git/objects/pack")).unwrap();
    assert_eq!(packs.flatten().filter(|entry| entry.path().extension().is_some_and(|ext| ext == "pack")).count(), super::PACK_LIMIT);
    assert!(Store::open(&root).is_some(), "at the limit");

    write(&root, "over.ts", A);
    git(&root, &["add", "-A"]);
    git(&root, &["commit", "--quiet", "-m", "over"]);
    git(&root, &["repack", "-d", "-q"]);
    assert!(Store::open(&root).is_none(), "one pack over it");

    git(&root, &["multi-pack-index", "write"]);
    assert!(Store::open(&root).is_some(), "a multi-pack index answers a miss in one lookup");
}

#[test]
fn any_git_call_that_failed_keeps_the_store_shut() {
    let root = repository("git-store-asked", &[("a.ts", A)]);
    assert!(Store::answered(&root, super::Answers::asked(&root)).is_some());

    for failed in ["located", "unfiltered", "replaced", "attributes"] {
        let mut answers = super::Answers::asked(&root);
        match failed {
            "located" => answers.located = None,
            "unfiltered" => answers.unfiltered = None,
            "replaced" => answers.replaced = None,
            _ => answers.attributes = None,
        }
        assert!(Store::answered(&root, answers).is_none(), "{failed}");
    }
}

/// `ls-tree -r -z HEAD -- .` run in `at`, as `(path, object, mode)` with the path from `at`.
fn ls_tree(at: &std::path::Path) -> Vec<(Vec<u8>, String, String)> {
    let out = Command::new("git").args(["ls-tree", "-r", "-z", "HEAD", "--", "."]).current_dir(at).output().unwrap().stdout;
    out.split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .filter_map(|entry| {
            let tab = entry.iter().position(|byte| *byte == b'\t')?;
            let head = String::from_utf8_lossy(&entry[..tab]).into_owned();
            let mut fields = head.split(' ');
            let (mode, kind, object) = (fields.next()?.to_owned(), fields.next()?, fields.next()?.to_owned());
            (kind == "blob").then(|| (entry[tab + 1..].to_vec(), object, mode))
        })
        .collect()
}

#[test]
fn the_blobs_of_head_are_listed_as_ls_tree_lists_them_from_the_root() {
    let root = repository(
        "git-store-head-blobs",
        &[("apps/x/a.ts", A), ("apps/x/a.b", A), ("apps/x/a/c.ts", A), ("apps/x/deep/er/d.ts", A), ("apps/y/e.ts", A), ("top.ts", A)],
    );
    std::os::unix::fs::symlink("a.ts", root.join("apps/x/link.ts")).unwrap();
    std::fs::set_permissions(root.join("apps/x/a.b"), std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    commit(&root);
    // A gitlink is a commit in the tree, not a blob, and neither lister descends into it.
    let commit_id = git(&root, &["rev-parse", "HEAD"]);
    git(&root, &["update-index", "--add", "--cacheinfo", &format!("160000,{},apps/x/sub", commit_id.trim())]);
    git(&root, &["commit", "--quiet", "-m", "gitlink"]);

    for at in [root.clone(), root.join("apps/x"), root.join("apps/x/deep")] {
        let listed = super::head(&at).and_then(|head| head.committed(None)).map(|committed| committed.blobs).expect("a tree HEAD holds is listed");
        let ours: Vec<(Vec<u8>, String, String)> = listed
            .into_iter()
            .map(|(path, id, link)| (path, id.to_string(), if link { "120000".to_owned() } else { String::new() }))
            .collect();
        let theirs: Vec<(Vec<u8>, String, String)> =
            ls_tree(&at).into_iter().map(|(path, id, mode)| (path, id, if mode == "120000" { mode } else { String::new() })).collect();
        assert_eq!(ours, theirs, "from {}", at.display());
    }
}

#[test]
fn a_root_head_does_not_hold_lists_nothing() {
    let root = repository("git-store-head-absent", &[("a.ts", A)]);
    write(&root, "new/b.ts", A);

    let at = root.join("new");
    assert_eq!(super::head(&at).and_then(|head| head.committed(None)).map(|committed| committed.blobs), Some(Vec::new()));
}
