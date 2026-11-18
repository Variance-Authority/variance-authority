//! The overlay against a checkout on disk, through `snapshot`, which is what
//! the addon's `gitTree` calls.

use std::path::{Path, PathBuf};
use std::process::Command;

use super::{hex, snapshot, snapshot_of};
use crate::git_fixture;

fn git(at: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(["-c", "user.email=test@example.test", "-c", "user.name=Test", "-c", "commit.gpgsign=false"])
        .args(["-c", "advice.addEmbeddedRepo=false"])
        .args(args)
        .current_dir(at)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

fn write(root: &Path, path: &str, text: &str) {
    let at = root.join(path);
    std::fs::create_dir_all(at.parent().unwrap()).unwrap();
    std::fs::write(at, text).unwrap();
}

fn checkout(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("sense-git-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::canonicalize(root).unwrap()
}

fn digest_of(tree: &super::Snapshot, path: &str) -> Option<String> {
    let at = tree.paths.iter().position(|held| held == path)?;
    Some(hex(&tree.oids[at]))
}

#[test]
fn an_edited_file_keeps_its_digest_beside_paths_that_are_not_files() {
    let root = checkout("not-files");
    write(&root, "src/a.ts", "export const a = 1;\n");
    write(&root, "lib/x.ts", "export const x = 1;\n");
    write(&root, "vendor/sub/readme.md", "one\n");
    git(&root.join("vendor/sub"), &["init", "--quiet"]);
    git(&root.join("vendor/sub"), &["add", "-A"]);
    git(&root.join("vendor/sub"), &["commit", "--quiet", "-m", "one"]);
    git(&root, &["init", "--quiet"]);
    git(&root, &["add", "-A"]);
    git(&root, &["commit", "--quiet", "-m", "base"]);

    // A submodule at a commit other than the recorded one: `status` prints it
    // as ` M vendor/sub`, with no trailing slash to say it is a directory.
    git(&root.join("vendor/sub"), &["commit", "--quiet", "--allow-empty", "-m", "two"]);
    write(&root, "src/a.ts", "export const a = 2;\n");
    std::os::unix::fs::symlink("lib", root.join("linked")).unwrap();
    std::os::unix::fs::symlink("nowhere", root.join("dangling")).unwrap();

    let tree = snapshot(root.to_str().unwrap()).unwrap();

    assert_eq!(digest_of(&tree, "src/a.ts"), Some(git(&root, &["hash-object", "src/a.ts"])));
    assert_eq!(digest_of(&tree, "lib/x.ts"), Some(git(&root, &["rev-parse", "HEAD:lib/x.ts"])));
    let mut unhashed = tree.unhashed.clone();
    unhashed.sort();
    assert_eq!(unhashed, ["dangling", "linked", "vendor/sub"]);
    for path in &unhashed {
        assert!(!tree.paths.contains(path), "{path} is listed with a digest");
    }
    let _ = std::fs::remove_dir_all(&root);
}

/// Whether the working tree was compared in-process, rather than handed to `status`.
fn compared(root: &Path) -> bool {
    let head = crate::git_store::head(root).unwrap();
    let config = crate::git::worktree_status::config_of(&crate::git::git_porcelain::configured(root.to_str().unwrap()));
    head.blobs().is_some() && crate::git::worktree_status::walk(&head, &config).is_some()
}

/// The snapshot compared in-process is the one `status` answers, path for path.
fn agrees(root: &Path) {
    let root = root.to_str().unwrap();
    let (known, printed) = (snapshot_of(root, true).unwrap(), snapshot_of(root, false).unwrap());
    let digests = |tree: &super::Snapshot| -> Vec<(String, String, bool)> {
        tree.paths.iter().zip(&tree.oids).zip(&tree.regular).map(|((path, oid), regular)| (path.clone(), hex(oid), *regular)).collect()
    };
    assert_eq!(digests(&known), digests(&printed));
    let sorted = |tree: &super::Snapshot| {
        let mut unhashed = tree.unhashed.clone();
        unhashed.sort();
        unhashed
    };
    assert_eq!(sorted(&known), sorted(&printed));
}

fn executable(root: &Path, path: &str) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(root.join(path), std::fs::Permissions::from_mode(0o755)).unwrap();
}

#[test]
fn every_kind_of_edit_is_compared_in_process_as_status_answers_it() {
    let root = git_fixture::repository(
        "status-edits",
        &[
            ("a.ts", b"a\n"),
            ("b.ts", b"b\n"),
            ("gone.ts", b"gone\n"),
            ("moved.ts", b"moved\n"),
            ("same.ts", b"same\n"),
            ("run.sh", b"run\n"),
            ("staged.ts", b"staged\n"),
            (".gitignore", b"*.log\nbuild/\n"),
            ("deep/kept.ts", b"kept\n"),
        ],
    );
    std::os::unix::fs::symlink("a.ts", root.join("link")).unwrap();
    git_fixture::commit(&root);

    git_fixture::write(&root, "a.ts", b"a, edited\n");
    git_fixture::write(&root, "staged.ts", b"staged, edited\n");
    git_fixture::git(&root, &["add", "staged.ts"]);
    git_fixture::write(&root, "added.ts", b"added\n");
    git_fixture::git(&root, &["add", "added.ts"]);
    std::fs::remove_file(root.join("gone.ts")).unwrap();
    git_fixture::git(&root, &["mv", "moved.ts", "renamed.ts"]);
    executable(&root, "run.sh");
    // Touched, not changed: the stat moves and the bytes do not.
    git_fixture::write(&root, "same.ts", b"same\n");
    std::fs::remove_file(root.join("link")).unwrap();
    std::os::unix::fs::symlink("b.ts", root.join("link")).unwrap();
    git_fixture::write(&root, "new.ts", b"new\n");
    git_fixture::write(&root, "fresh/one.ts", b"one\n");
    git_fixture::write(&root, "fresh/deeper/two.ts", b"two\n");
    git_fixture::write(&root, "trace.log", b"ignored\n");
    git_fixture::write(&root, "build/out.ts", b"ignored\n");
    std::os::unix::fs::symlink("deep", root.join("untracked-link")).unwrap();

    assert!(compared(&root));
    agrees(&root);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_root_below_the_top_compares_only_what_lies_under_it() {
    let root = git_fixture::repository("status-prefix", &[("sub/a.ts", b"a\n"), ("sub/gone.ts", b"g\n"), ("beside/b.ts", b"b\n")]);
    git_fixture::write(&root, "sub/a.ts", b"a, edited\n");
    std::fs::remove_file(root.join("sub/gone.ts")).unwrap();
    git_fixture::write(&root, "sub/new/n.ts", b"n\n");
    git_fixture::write(&root, "beside/b.ts", b"b, edited\n");
    git_fixture::write(&root, "beside/new.ts", b"new\n");
    git_fixture::git(&root, &["mv", "beside/b.ts", "sub/b.ts"]);

    assert!(compared(&root.join("sub")));
    agrees(&root.join("sub"));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_conflict_a_nested_repository_and_global_excludes_are_compared_as_status_answers_them() {
    let root = git_fixture::repository("status-conflict", &[("c.ts", b"base\n"), ("d.ts", b"d\n")]);
    git_fixture::git(&root, &["checkout", "--quiet", "-b", "side"]);
    git_fixture::write(&root, "c.ts", b"the side branch\n");
    git_fixture::commit(&root);
    git_fixture::git(&root, &["checkout", "--quiet", "main"]);
    git_fixture::write(&root, "c.ts", b"main, longer than base\n");
    git_fixture::commit(&root);
    let merged = Command::new("git").args(["-c", "user.email=t@e.test", "-c", "user.name=T", "merge", "--quiet", "side"]).current_dir(&root).output().unwrap();
    assert!(!merged.status.success(), "the merge conflicts");

    git_fixture::write(&root, "nested/inner.ts", b"inner\n");
    git_fixture::git(&root.join("nested"), &["init", "--quiet"]);
    let excludes = root.with_extension("excludes");
    std::fs::write(&excludes, "*.tmp\n").unwrap();
    git_fixture::git(&root, &["config", "core.excludesFile", excludes.to_str().unwrap()]);
    git_fixture::write(&root, "scratch.tmp", b"excluded\n");
    git_fixture::write(&root, "kept.ts", b"kept\n");

    assert!(compared(&root));
    agrees(&root);
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_file(&excludes);
}

#[test]
fn a_gitlink_under_the_root_hands_the_comparison_to_status() {
    let module = git_fixture::repository("status-module", &[("m.ts", b"m\n")]);
    let root = git_fixture::repository("status-gitlink", &[("a.ts", b"a\n")]);
    git_fixture::git(&root, &["-c", "protocol.file.allow=always", "submodule", "add", "--quiet", module.to_str().unwrap(), "vendor/module"]);
    git_fixture::commit(&root);
    git_fixture::write(&root, "a.ts", b"a, edited\n");

    assert!(!compared(&root));
    agrees(&root);
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&module);
}


/// A sparse checkout without a sparse index flags the paths outside its
/// patterns skip-worktree, which gix-status passes over; one written back to
/// disk is edited all the same, so `status` answers.
#[test]
fn a_skip_worktree_entry_hands_the_comparison_to_status() {
    let root = git_fixture::repository("status-sparse", &[("a/x.ts", b"a\n"), ("b/y.ts", b"b\n")]);
    git_fixture::git(&root, &["sparse-checkout", "set", "--no-cone", "a/"]);
    git_fixture::write(&root, "b/y.ts", b"b, edited\n");

    assert!(!compared(&root));
    agrees(&root);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_root_whose_path_holds_a_newline_never_keeps_a_committed_digest_for_an_edit() {
    let root = git_fixture::repository("status-newline", &[("with\nline/a.ts", b"a\n")]);
    git_fixture::write(&root, "with\nline/a.ts", b"a, edited\n");
    let tree = snapshot(root.join("with\nline").to_str().unwrap()).unwrap();
    let edited = gix_object::compute_hash(gix_hash::Kind::Sha1, gix_object::Kind::Blob, b"a, edited\n").unwrap();
    let held = tree.paths.iter().position(|path| path == "a.ts").map(|at| hex(&tree.oids[at]));
    assert!(held.as_ref().is_none_or(|held| *held == edited.to_string()), "a.ts carries {held:?}");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn an_excludes_file_under_the_git_prefix_hands_the_comparison_to_status() {
    let root = git_fixture::repository("status-excludes-prefix", &[("a.ts", b"a\n")]);
    git_fixture::git(&root, &["config", "core.excludesFile", "%(prefix)/.va-ignore"]);
    git_fixture::write(&root, "b.ts", b"b\n");
    assert!(!compared(&root));
    agrees(&root);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn an_empty_xdg_config_home_reads_the_excludes_under_home_as_git_does() {
    let env = |empty: &'static str| move |name: &str| match name {
        "XDG_CONFIG_HOME" => Some(std::ffi::OsString::from(empty)),
        "HOME" => Some(std::ffi::OsString::from("/h")),
        _ => None,
    };
    let read = |xdg| crate::git::worktree_status::user_excludes(&mut env(xdg));
    assert_eq!(read(""), Some(std::path::PathBuf::from("/h/.config/git/ignore")));
    assert_eq!(read("/x"), Some(std::path::PathBuf::from("/x/git/ignore")));
}

#[test]
fn an_excludes_file_in_another_users_home_hands_the_comparison_to_status() {
    let root = git_fixture::repository("status-excludes-user", &[("a.ts", b"a\n")]);
    git_fixture::git(&root, &["config", "core.excludesFile", "~root/.va-ignore"]);
    git_fixture::write(&root, "b.ts", b"b\n");
    assert!(!compared(&root));
    agrees(&root);
    let _ = std::fs::remove_dir_all(&root);
}

/// Every spelling git accepts for a boolean reads as git reads it, so the
/// in-process comparison never runs under a setting it misread.
#[test]
fn a_boolean_setting_reads_as_git_reads_it() {
    let root = checkout("booleans");
    git(&root, &["init", "-q"]);
    for spelling in ["true", "yes", "On", "1", "2", "-1", "1k", "0x10", "false", "NO", "off", "0", "00", "0x0", "-0X00k", ""] {
        for key in ["core.ignorecase", "core.filemode", "core.symlinks", "core.trustctime", "core.precomposeunicode"] {
            git(&root, &["config", key, spelling]);
            let config = crate::git::worktree_status::config_of(&crate::git::git_porcelain::configured(root.to_str().unwrap()));
            let read = match key {
                "core.ignorecase" => config.ignore_case,
                "core.filemode" => config.file_mode,
                "core.symlinks" => config.symlinks,
                "core.trustctime" => config.trust_ctime,
                _ => config.precompose_unicode,
            };
            assert_eq!(read.to_string(), git(&root, &["config", "--type=bool", key]), "{key} = {spelling:?}");
            git(&root, &["config", "--unset", key]);
        }
        // The untracked settings read the same listing, and by the same rule.
        for key in ["core.untrackedcache", "feature.manyfiles"] {
            git(&root, &["config", key, spelling]);
            let settings = crate::git::git_porcelain::settings_of(&crate::git::git_porcelain::configured(root.to_str().unwrap()));
            assert_eq!(settings.cached.to_string(), git(&root, &["config", "--type=bool", key]), "{key} = {spelling:?}");
            git(&root, &["config", "--unset", key]);
        }
    }
    let _ = std::fs::remove_dir_all(&root);
}

/// `git rm --cached` leaves a path staged away and back on disk untracked;
/// git lists it both ways, and the snapshot lists its bytes.
#[test]
fn a_path_unstaged_but_kept_on_disk_is_listed_with_its_bytes() {
    let root = git_fixture::repository("status-unstaged", &[("a.ts", b"a\n"), ("b.ts", b"b\n")]);
    git_fixture::commit(&root);
    git_fixture::git(&root, &["rm", "--cached", "-q", "a.ts"]);

    assert!(compared(&root));
    agrees(&root);
    let _ = std::fs::remove_dir_all(&root);
}

/// An index holding git's untracked cache is git's to answer: the cache lets
/// `status` skip the walk this comparison makes.
#[test]
fn an_untracked_cache_hands_the_comparison_to_status() {
    let root = git_fixture::repository("status-untracked-cache", &[("a.ts", b"a\n")]);
    git_fixture::commit(&root);
    git_fixture::git(&root, &["-c", "core.untrackedCache=true", "update-index", "--untracked-cache"]);
    git_fixture::write(&root, "new.ts", b"new\n");

    assert!(!compared(&root));
    agrees(&root);
    let _ = std::fs::remove_dir_all(&root);
}
