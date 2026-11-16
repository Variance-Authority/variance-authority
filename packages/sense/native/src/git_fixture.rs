//! Repositories built in a temporary directory for the tests that read git's
//! object store against the worktree, with every entry the index records fresh.

use std::path::{Path, PathBuf};
use std::process::Command;

/// A git command's trimmed output in `at`, which must succeed.
pub(crate) fn git(at: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(["-c", "user.email=test@example.test", "-c", "user.name=Test", "-c", "commit.gpgsign=false"])
        .args(["-c", "protocol.file.allow=always", "-c", "init.defaultBranch=main"])
        .args(args)
        .current_dir(at)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

pub(crate) fn write(root: &Path, path: &str, bytes: &[u8]) {
    let at = root.join(path);
    std::fs::create_dir_all(at.parent().unwrap()).unwrap();
    std::fs::write(at, bytes).unwrap();
}

/// The mtime of every file written since the last settle put a year back, so
/// no entry the next index write records is racy: a racy entry is read from the
/// disk, and would pass every case that expects the disk. A file settled before
/// is left alone: a touch moves its ctime, which the index then holds stale,
/// since git compares whole seconds and the store nanoseconds too.
pub(crate) fn settle(root: &Path) {
    let status = Command::new("find")
        .args([".", "-name", ".git", "-prune", "-o", "-type", "f", "-newermt", "2025-01-02"])
        .args(["-exec", "touch", "-t", "202501010000", "{}", "+"])
        .current_dir(root)
        .status()
        .unwrap();
    assert!(status.success());
}

/// A repository holding `files`, committed, in a directory named for `name`
/// and this process.
pub(crate) fn repository(name: &str, files: &[(&str, &[u8])]) -> PathBuf {
    let root = std::env::temp_dir().join(format!("sense-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let root = std::fs::canonicalize(root).unwrap();
    git(&root, &["init", "--quiet"]);
    for (path, bytes) in files {
        write(&root, path, bytes);
    }
    commit(&root);
    root
}

/// Every change in `root` settled and committed.
pub(crate) fn commit(root: &Path) {
    settle(root);
    git(root, &["add", "-A"]);
    git(root, &["commit", "--quiet", "--allow-empty", "-m", "step"]);
}
