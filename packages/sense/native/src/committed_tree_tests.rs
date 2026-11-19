//! HEAD's tree held by the id it was read from, against fixture repositories:
//! a listing made from what is held is the listing a fresh read makes, byte for
//! byte, and reads only the trees whose ids it does not hold.

use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};

use super::Committed;
use crate::git_fixture::{commit, git, repository, write};

const A: &[u8] = b"export const a = 1;\n";

/// HEAD's tree below `at`, from what `held` holds when it is given, which is then written back.
fn listed(at: &Path, held: Option<&Path>) -> Committed {
    crate::git_store::head(at).and_then(|head| head.committed(held)).expect("a tree HEAD holds is listed")
}

#[test]
fn an_unchanged_tree_id_reads_no_tree_object_and_lists_what_a_fresh_read_lists() {
    let root = repository("committed-unchanged", &[("apps/x/a.ts", A), ("apps/x/deep/b.ts", A), ("apps/y/c.ts", A), ("top.ts", A)]);
    symlink("a.ts", root.join("apps/x/link.ts")).unwrap();
    commit(&root);
    write(&root, "absent/new.ts", A);

    for (place, at) in [root.clone(), root.join("apps/x"), root.join("apps/x/deep"), root.join("absent")].into_iter().enumerate() {
        let held = root.join(format!(".git/committed-{place}"));
        let fresh = listed(&at, None);
        assert!(fresh.read > 0);
        listed(&at, Some(&held));
        let again = listed(&at, Some(&held));
        assert_eq!(again.read, 0, "from {}", at.display());
        assert_eq!(again.blobs, fresh.blobs, "from {}", at.display());
        assert_eq!(again.encode(), fresh.encode(), "from {}", at.display());
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_record_that_does_not_decode_is_read_as_nothing_held() {
    let root = repository("committed-damaged", &[("a/b.ts", A), ("c.ts", A)]);
    let held = root.join(".git/committed");
    std::fs::write(&held, b"not a record").unwrap();
    let fresh = listed(&root, None);
    let read = listed(&root, Some(&held));
    assert_eq!((read.read, read.encode()), (fresh.read, fresh.encode()));
    assert_eq!(listed(&root, Some(&held)).read, 0, "the record written over it is read");
    let _ = std::fs::remove_dir_all(&root);
}

fn executable(root: &Path, path: &str) {
    std::fs::set_permissions(root.join(path), std::fs::Permissions::from_mode(0o755)).unwrap();
}

#[test]
fn a_changed_tree_id_reads_only_the_trees_that_moved_and_lists_what_a_fresh_read_lists() {
    let root = repository("committed-advance", &[
        ("apps/x/package.json", MANIFEST),
        ("apps/x/a.ts", A),
        ("apps/x/deep/b.ts", A),
        ("apps/y/c.ts", A),
        ("lib/d.ts", A),
        ("top.ts", A),
    ]);
    let places: Vec<PathBuf> = vec![root.clone(), root.join("apps"), root.join("apps/x")];
    let held = |place: usize| root.join(format!(".git/committed-{place}"));
    for (place, at) in places.iter().enumerate() {
        listed(at, Some(&held(place)));
    }

    // Each step commits, and every place lists from what the step before it left held.
    let steps: Vec<(&str, Box<dyn Fn(&Path)>)> = vec![
        ("an added file", Box::new(|root| write(root, "apps/x/deep/new.ts", A))),
        ("a package nested in another", Box::new(|root| write(root, "apps/x/deep/package.json", MANIFEST))),
        ("a package around a held one", Box::new(|root| write(root, "apps/package.json", MANIFEST))),
        ("a package's manifest gone", Box::new(|root| std::fs::remove_file(root.join("apps/x/package.json")).unwrap())),
        ("a package's own file changed", Box::new(|root| write(root, "apps/x/deep/b.ts", b"edited\n"))),
        ("a deleted directory", Box::new(|root| std::fs::remove_file(root.join("apps/y/c.ts")).unwrap())),
        ("a rename", Box::new(|root| std::fs::rename(root.join("lib/d.ts"), root.join("lib/e.ts")).unwrap())),
        ("an executable bit", Box::new(|root| executable(root, "top.ts"))),
        ("a symbolic link", Box::new(|root| symlink("../top.ts", root.join("apps/link.ts")).unwrap())),
        ("a link become a file", Box::new(|root| {
            std::fs::remove_file(root.join("apps/link.ts")).unwrap();
            write(root, "apps/link.ts", A);
        })),
        ("a directory become a file", Box::new(|root| {
            std::fs::remove_dir_all(root.join("lib")).unwrap();
            write(root, "lib", A);
        })),
        ("a file become a directory", Box::new(|root| {
            std::fs::remove_file(root.join("lib")).unwrap();
            write(root, "lib/f.ts", A);
        })),
        // A repository inside the checkout is added as the commit it holds.
        ("a gitlink", Box::new(|root| {
            let sub = root.join("apps/x/sub");
            std::fs::create_dir_all(&sub).unwrap();
            git(&sub, &["init", "--quiet"]);
            write(&sub, "s.ts", A);
            commit(&sub);
        })),
        // The roots stay on disk, out of the tree, so that git is asked from them.
        ("the prefix gone", Box::new(|root| {
            std::fs::remove_dir_all(root.join("apps")).unwrap();
            write(root, ".gitignore", b"apps/\n");
            write(root, "apps/x/ignored.ts", A);
        })),
        ("the prefix back", Box::new(|root| std::fs::remove_file(root.join(".gitignore")).unwrap())),
    ];
    for (step, change) in &steps {
        change(&root);
        commit(&root);
        for (place, at) in places.iter().enumerate() {
            let fresh = listed(at, None);
            let advanced = listed(at, Some(&held(place)));
            assert_eq!(advanced.encode(), fresh.encode(), "{step}, from {}", at.display());
        }
    }
    let _ = std::fs::remove_dir_all(&root);
}

/// The directories `held` keys, as text.
fn keys(held: &Committed) -> Vec<String> {
    held.dirs.iter().map(|dir| String::from_utf8(dir.path.clone()).unwrap()).collect()
}

const MANIFEST: &[u8] = b"{ \"name\": \"p\" }\n";

#[test]
fn the_record_keys_a_package_root_and_no_directory_below_or_between() {
    let root = repository("committed-keys", &[
        ("package.json", MANIFEST),
        ("apps/x/package.json", MANIFEST),
        ("apps/x/deep/b.ts", A),
        ("apps/x/inner/package.json", MANIFEST),
        ("apps/x/inner/c.ts", A),
        ("apps/y/c.ts", A),
        ("lib/d.ts", A),
        ("vendor/node_modules/z/package.json", MANIFEST),
    ]);
    // The root is the chain's; each package below it is its own key, a nested one too,
    // and a manifest the package owner declines is none.
    assert_eq!(keys(&listed(&root, None)), ["apps/x/", "apps/x/inner/"]);
    assert_eq!(keys(&listed(&root.join("apps/x"), None)), ["inner/"]);
    assert_eq!(keys(&listed(&root.join("lib"), None)), Vec::<String>::new());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn an_advance_reads_the_trees_on_the_changed_path_on_both_sides_and_no_other() {
    let root = repository("committed-counted", &[
        ("apps/x/package.json", MANIFEST),
        ("apps/x/a.ts", A),
        ("apps/x/deep/b.ts", A),
        ("apps/y/package.json", MANIFEST),
        ("apps/y/c.ts", A),
        ("lib/d.ts", A),
        ("top.ts", A),
    ]);
    let held = root.join(".git/committed");
    let under = root.join(".git/committed-apps");
    assert_eq!(listed(&root, Some(&held)).read, 6);

    write(&root, "apps/x/deep/new.ts", A);
    commit(&root);
    // The top, `apps`, `apps/x` and `apps/x/deep`, each new and as held; `apps/y`
    // and `lib` are taken by the ids both sides name, though only `apps/y` is a package.
    assert_eq!(listed(&root, Some(&held)).read, 8);

    write(&root, "lib/e.ts", A);
    commit(&root);
    // The top and `lib`, on both sides; `apps` is taken whole.
    assert_eq!(listed(&root, Some(&held)).read, 4);
    listed(&root.join("apps"), Some(&under));

    write(&root, "lib/f.ts", A);
    commit(&root);
    // The top only, whose `apps` is the one held.
    assert_eq!(listed(&root.join("apps"), Some(&under)).read, 1);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_tree_that_shares_no_history_with_the_one_held_is_advanced_to_by_its_ids() {
    let root = repository("committed-unrelated", &[("apps/x/a.ts", A), ("lib/package.json", MANIFEST), ("lib/d.ts", A)]);
    let held = root.join(".git/committed");
    listed(&root, Some(&held));
    git(&root, &["checkout", "--quiet", "--orphan", "other"]);
    git(&root, &["rm", "--quiet", "-r", "--cached", "apps"]);
    std::fs::remove_dir_all(root.join("apps")).unwrap();
    write(&root, "other/b.ts", A);
    commit(&root);
    let (fresh, advanced) = (listed(&root, None), listed(&root, Some(&held)));
    assert_eq!(advanced.encode(), fresh.encode());
    // The top on both sides and `other`; `lib` is the tree both hold.
    assert_eq!((fresh.read, advanced.read), (3, 3));
    git(&root, &["checkout", "--quiet", "main"]);
    assert_eq!(listed(&root, Some(&held)).encode(), listed(&root, None).encode());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_held_tree_the_store_has_dropped_is_read_new_and_whole_but_for_the_packages_held() {
    let root = repository("committed-dropped", &[
        ("apps/x/package.json", MANIFEST),
        ("apps/x/a.ts", A),
        ("apps/y/c.ts", A),
        ("lib/d.ts", A),
    ]);
    let held = root.join(".git/committed");
    listed(&root, Some(&held));
    // The commit replaced, and every tree only it named pruned from the store.
    write(&root, "apps/y/c.ts", b"edited\n");
    git(&root, &["add", "-A"]);
    git(&root, &["commit", "--quiet", "--amend", "--no-edit"]);
    git(&root, &["reflog", "expire", "--expire=now", "--all"]);
    git(&root, &["gc", "--quiet", "--prune=now"]);
    let (fresh, advanced) = (listed(&root, None), listed(&root, Some(&held)));
    assert_eq!(advanced.encode(), fresh.encode());
    // The top, `apps`, `apps/y` and `lib`, new; `apps/x` is the package held.
    assert_eq!((fresh.read, advanced.read), (5, 4));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_package_whose_old_tree_the_store_still_has_is_diffed_though_the_tree_above_it_was_dropped() {
    let root = repository("committed-kept-package", &[
        ("apps/x/package.json", MANIFEST),
        ("apps/x/deep/b.ts", A),
        ("apps/x/one/e.ts", A),
        ("apps/x/two/e.ts", A),
        ("apps/x/three/e.ts", A),
        ("apps/y/c.ts", A),
        ("lib/d.ts", A),
    ]);
    let held = root.join(".git/committed");
    listed(&root, Some(&held));
    // A tag keeps the package's old tree, and every tree above it only the replaced commit named is pruned.
    git(&root, &["tag", "keep", "HEAD:apps/x"]);
    write(&root, "apps/x/deep/b.ts", b"edited\n");
    write(&root, "apps/y/c.ts", b"edited\n");
    git(&root, &["add", "-A"]);
    git(&root, &["commit", "--quiet", "--amend", "--no-edit"]);
    git(&root, &["reflog", "expire", "--expire=now", "--all"]);
    git(&root, &["gc", "--quiet", "--prune=now"]);
    let (fresh, advanced) = (listed(&root, None), listed(&root, Some(&held)));
    assert_eq!(advanced.encode(), fresh.encode());
    // New: the top, `apps`, `apps/x`, `apps/x/deep`, `apps/y` and `lib`. Old: `apps/x` by
    // the id the record keys it by, and `apps/x/deep`; `one`, `two` and `three` are taken.
    assert_eq!((fresh.read, advanced.read), (9, 8));
    let _ = std::fs::remove_dir_all(&root);
}

/// The snapshot of `root`, path for path, with its digests.
fn digests(snapshot: &crate::git::Snapshot) -> (Vec<(String, [u8; 20], bool)>, Vec<String>) {
    let paths = snapshot.paths.iter().zip(&snapshot.oids).zip(&snapshot.regular).map(|((path, oid), regular)| (path.clone(), *oid, *regular)).collect();
    (paths, snapshot.unhashed.clone())
}

#[test]
fn a_snapshot_from_the_held_tree_is_the_snapshot_git_lists_in_every_state_of_the_working_tree() {
    let root = repository("committed-snapshot", &[("a.ts", A), ("b/c.ts", A), ("b/d.ts", A), ("e/f.ts", A)]);
    let held = root.join(".git/committed");
    let at = root.to_str().unwrap();
    let agrees = |state: &str| {
        let fresh = crate::git::snapshot(at).unwrap();
        let first = crate::git::snapshot_against(at, &held).unwrap();
        let again = crate::git::snapshot_against(at, &held).unwrap();
        assert_eq!(digests(&first), digests(&fresh), "{state}");
        assert_eq!(digests(&again), digests(&fresh), "{state}, held");
    };
    agrees("committed");
    write(&root, "b/c.ts", b"edited\n");
    agrees("unstaged");
    git(&root, &["add", "b/c.ts"]);
    agrees("staged");
    write(&root, "b/c.ts", b"edited again\n");
    agrees("staged and edited again");
    write(&root, "new/g.ts", A);
    agrees("untracked");
    std::fs::remove_file(root.join("e/f.ts")).unwrap();
    agrees("deleted");
    executable(&root, "a.ts");
    agrees("an executable bit");
    commit(&root);
    agrees("advanced");
    git(&root, &["mv", "b/d.ts", "b/moved.ts"]);
    agrees("a staged rename");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_held_record_never_answers_for_another_root_an_unborn_branch_or_a_replace_ref() {
    let root = repository("committed-snapshot-held", &[("a.ts", A), ("b/c.ts", A), ("b/d/e.ts", A)]);
    let held = root.join(".git/committed");
    let agrees = |at: &Path, state: &str| {
        let at = at.to_str().unwrap();
        let fresh = crate::git::snapshot(at).unwrap();
        assert_eq!(digests(&crate::git::snapshot_against(at, &held).unwrap()), digests(&fresh), "{state}");
        assert_eq!(digests(&crate::git::snapshot_against(at, &held).unwrap()), digests(&fresh), "{state}, held");
    };
    agrees(&root, "the root");
    agrees(&root.join("b"), "a directory below, from the root's record");
    agrees(&root.join("b/d"), "deeper still");
    agrees(&root, "the root again, from the directory's record");
    write(&root, "b/c.ts", b"export const c = 3;\n");
    commit(&root);
    agrees(&root, "advanced");
    let a = git(&root, &["rev-parse", "HEAD:a.ts"]);
    let c = git(&root, &["rev-parse", "HEAD:b/c.ts"]);
    git(&root, &["replace", &a, &c]);
    agrees(&root, "a replace ref");
    git(&root, &["replace", "-d", &a]);
    agrees(&root, "the replace ref gone");
    git(&root, &["checkout", "-q", "--orphan", "unborn"]);
    agrees(&root, "an unborn branch, its index staged");
    git(&root, &["rm", "-q", "-r", "--cached", "b"]);
    agrees(&root, "an unborn branch, part unstaged");
    let _ = std::fs::remove_dir_all(&root);
}
