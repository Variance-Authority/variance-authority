//! The overlay against a checkout on disk, through `snapshot`, which is what
//! the addon's `gitTree` calls.

use std::path::{Path, PathBuf};
use std::process::Command;

use super::{hex, snapshot};

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
