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
