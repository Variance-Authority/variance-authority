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
fn indexed_blob_bytes_need_no_worktree_file_and_distinguish_lfs_from_missing_objects() {
    let pointer = b"version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 20\n";
    let root = repository("git-store-owned-blob", &[("a.ts", A), ("pointer.bin", pointer)]);
    git(&root, &["gc", "--quiet"]);
    let id = |name: &str| crate::git::parse_oid(git(&root, &["rev-parse", name]).as_bytes()).unwrap();
    let (plain, pointer, tree) = (id("HEAD:a.ts"), id("HEAD:pointer.bin"), id("HEAD^{tree}"));
    let objects = super::Objects::open(&root).unwrap();
    std::fs::remove_file(root.join("a.ts")).unwrap();
    for _ in 0..2 {
        assert_eq!(objects.blob_bytes(&plain).unwrap().as_deref(), Some(A));
        assert!(objects.blob_bytes(&pointer).unwrap().is_none(), "only LFS requests transformed content");
    }
    assert_eq!(objects.blob_bytes(&[0xff; 20]).unwrap_err().kind(), std::io::ErrorKind::NotFound);
    assert_eq!(objects.blob_bytes(&tree).unwrap_err().kind(), std::io::ErrorKind::InvalidData);
}

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
}

#[test]
fn a_loose_replace_ref_seen_from_a_linked_worktree_keeps_the_store_shut() {
    let root = repository("git-store-replace-loose", &[("a.ts", A), ("b.ts", b"export const b = 2;\n")]);
    let linked = root.with_file_name("git-store-replace-loose-linked");
    let _ = std::fs::remove_dir_all(&linked);
    git(&root, &["worktree", "add", "-q", "--detach", linked.to_str().unwrap()]);
    assert!(super::Objects::open(&linked).is_some());

    let a = git(&root, &["rev-parse", "HEAD:a.ts"]);
    let b = git(&root, &["rev-parse", "HEAD:b.ts"]);
    git(&root, &["replace", &a, &b]);

    assert!(Store::open(&linked).is_none());
    assert!(super::Objects::open(&linked).is_none());
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
fn fragmented_source_reads_use_buffered_git_while_native_lookups_wait_for_a_multi_pack_index() {
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
    assert!(super::Objects::open(&root).is_some(), "the scan admits the limit");

    write(&root, "over.ts", A);
    git(&root, &["add", "-A"]);
    git(&root, &["commit", "--quiet", "-m", "over"]);
    git(&root, &["repack", "-d", "-q"]);
    assert!(Store::open(&root).is_none(), "one pack over it");
    assert!(super::Objects::open(&root).is_some(), "fragmentation changes the Git engine, not the source of indexed bytes");

    let oid = git(&root, &["rev-parse", "HEAD:a.ts"]);
    let files = vec!["a.ts".to_owned()];
    let oids = vec![crate::git::parse_oid(oid.as_bytes())];
    std::fs::remove_file(root.join("a.ts")).unwrap();
    let scan = crate::acquire::TreeObjects::default();
    let objects = scan.objects_now(&root);
    assert!(objects.is_some(), "a fragmented scan opens buffered Git");
    let staged = git(&root, &["ls-files", "-s"]);
    let ids: std::collections::HashMap<&str, crate::git::Oid> = staged.lines().map(|line| {
        let (meta, path) = line.split_once('\t').unwrap();
        (path, crate::git::parse_oid(meta.split(' ').nth(1).unwrap().as_bytes()).unwrap())
    }).collect();
    let paths = ["p49.ts", "p1.ts", "p20.ts", "p2.ts", "a.ts", "p1.ts"];
    let mut requested: Vec<_> = paths.iter().map(|path| ids[path]).collect();
    requested.push([0xff; 20]);
    for largest in [64, 20, 64] {
        let read = objects.as_ref().unwrap().blobs_with_readers(&requested, largest, 6);
        assert_eq!(read.len(), requested.len());
        for (path, read) in paths.iter().zip(&read) {
            let expected = if *path == "a.ts" { A.to_vec() } else {
                format!("export const p = {};\n", path.strip_prefix('p').unwrap().strip_suffix(".ts").unwrap()).into_bytes()
            };
            match read.as_ref().unwrap() {
                crate::commit_text::PackedBlob::Bytes(bytes) => {
                    assert_eq!(bytes, &expected);
                    assert!(bytes.len() as u64 <= largest, "the limit is checked before requesting a body");
                }
                crate::commit_text::PackedBlob::Large(size) => assert_eq!((*size, *size > largest), (expected.len() as u64, true)),
            }
        }
        assert!(read.last().unwrap().is_err(), "a missing indexed identity keeps its ordered error");
    }
    // Configuration readers share one lazy byte owner while parsing in Rayon.
    let packed = std::sync::Arc::clone(objects.as_ref().unwrap());
    let (send, receive) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        use rayon::prelude::*;
        let pool = rayon::ThreadPoolBuilder::new().num_threads(1).build().unwrap();
        let bytes = std::sync::OnceLock::new();
        let count: usize = pool.install(|| (0..16).into_par_iter().map(|_| {
            bytes.get_or_init(|| packed.blob_bytes_many(&requested)).len()
        }).sum());
        send.send(count).unwrap();
    });
    assert_eq!(receive.recv_timeout(std::time::Duration::from_secs(5)).expect("a lazy configuration acquisition must finish without re-entering its owner"), 16 * (paths.len() + 1));
    worker.join().unwrap();
    let (read, named) = crate::acquire::read_git(objects.as_deref(), root.to_string_lossy().into_owned(),
        files, oids, Some(1024), Some(true), None, true);
    assert_eq!(read[0].2, crate::acquire::Outcome::Parsed, "a fragmented scan has no need for its file on disk");
    assert_eq!(named, [true]);

    git(&root, &["multi-pack-index", "write"]);
    assert!(Store::open(&root).is_some(), "a multi-pack index answers a miss in one lookup");
    assert!(super::Objects::open(&root).is_some(), "the scan uses the multi-pack index");
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
