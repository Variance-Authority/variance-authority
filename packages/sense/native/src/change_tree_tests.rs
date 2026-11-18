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
