//! The tree an update of a directory git does not list is made against.

// compass: variance-authority.reach.source-index

use super::disk_tree;

/// A directory asked for by name is walked, even when it holds a repository
/// of its own, which a walk of the whole root steps over; and what it seeds
/// is in the listing the languages that resolve over the tree ask about.
#[test]
fn a_directory_asked_for_is_seeded_even_when_it_is_a_repository_of_its_own() {
    let root = std::env::temp_dir().join(format!("sense-disk-tree-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    for (path, contents) in [("pkg/.git/HEAD", "ref: refs/heads/main\n"), ("pkg/a.ts", "export const a = 1;\n"), ("b.ts", "")] {
        let file = root.join(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, contents).unwrap();
    }
    let tree = disk_tree(root.to_string_lossy().into_owned(), vec!["pkg".to_owned()]);
    std::fs::remove_dir_all(&root).unwrap();
    assert_eq!(tree.seeds, ["pkg/a.ts"]);
    let (at, listed) = tree.disk.as_ref().unwrap();
    assert!(at.contains_key("pkg/a.ts") && listed.iter().any(|path| path == "pkg/a.ts"), "{listed:?}");
}

/// The repository a directory asked for sits in is listed as a directory that
/// holds none would be, manifests included, so a crate's index and a Python
/// project's roots are read; a repository nobody asked for is still stepped over.
#[test]
fn a_repository_asked_for_lists_its_manifests() {
    let root = std::env::temp_dir().join(format!("sense-disk-tree-manifests-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    for path in ["pkg/.git/HEAD", "pkg/Cargo.toml", "pkg/pyproject.toml", "pkg/src/lib.rs", "pkg/tests/it.rs", "other/.git/HEAD", "other/Cargo.toml"] {
        let file = root.join(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, "").unwrap();
    }
    let listed = |dirs: &[&str]| disk_tree(root.to_string_lossy().into_owned(), dirs.iter().map(|dir| (*dir).to_owned()).collect()).disk.unwrap().1;
    let whole = listed(&["pkg"]);
    let inner = listed(&["pkg/tests"]);
    std::fs::remove_dir_all(&root).unwrap();
    let expected = ["pkg/Cargo.toml", "pkg/pyproject.toml", "pkg/src/lib.rs", "pkg/tests/it.rs"];
    assert_eq!(whole, expected);
    assert_eq!(inner, expected);
}

/// With the clock on, the listing of a repository the object store reads names
/// the parts that ran in-process, and neither of git's fallbacks. The clock is
/// read once per process, so the listing runs in a child: this test binary
/// again, with the variable set and only this test selected.
#[cfg(unix)]
#[test]
fn with_the_clock_on_the_listing_line_names_the_parts_that_ran() {
    const CHILD: &str = "VARIANCE_AUTHORITY_TEST_LISTING_CHILD";
    if std::env::var_os(CHILD).is_some() {
        let root = crate::git_fixture::repository("listing-line", &[("a.ts", b"export const a = 1;\n"), ("b/c.ts", b"")]);
        let index = root.join("index").to_string_lossy().into_owned();
        assert!(super::change_tree(root.to_string_lossy().into_owned(), index, Vec::new()).is_some());
        let _ = std::fs::remove_dir_all(&root);
        return;
    }
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["change_tree::tests::with_the_clock_on_the_listing_line_names_the_parts_that_ran", "--exact", "--nocapture", "--test-threads=1"])
        .env("VARIANCE_AUTHORITY_INDEX_STAGES", "1")
        .env(CHILD, "1")
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{stderr}");
    let line = stderr.lines().find(|line| line.starts_with("variance stage listing:")).unwrap_or_else(|| panic!("no listing line in {stderr}"));
    let parts = line.split_once('(').map_or("", |(_, parts)| parts.trim_end_matches(')'));
    let named = |part: &str| parts.split(", ").any(|entry| entry.strip_prefix(part).and_then(|rest| rest.strip_prefix(' ')).and_then(|rest| rest.strip_suffix(" s")).is_some_and(|seconds| seconds.parse::<f64>().is_ok()));
    for part in ["locate", "inventory", "worktree", "overlay", "merge", "seeds", "assemble"] {
        assert!(named(part), "{part} is not on {line}");
    }
    for fallback in ["git ls-files", "git status"] {
        assert!(!line.contains(fallback), "{fallback} is on {line}");
    }
}
