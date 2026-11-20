// compass: variance-authority.report.agent-surface

use std::collections::HashMap;

use super::*;

#[test]
fn the_nearest_readme_wins_even_when_it_does_not_name_the_name() {
    let held: HashMap<String, Option<Readme>> = [
        ("a/b/README.md", None),
        ("a/README.md", Some(Readme { from: "a/README.md".to_owned(), text: "near".encode_utf16().collect() })),
        ("README.md", Some(Readme { from: "README.md".to_owned(), text: "`name`".encode_utf16().collect() })),
    ]
    .into_iter()
    .map(|(from, readme)| (from.to_owned(), readme))
    .collect();
    let found = nearest(&held, "a/b/file.ts").unwrap();
    assert_eq!(found.from, "a/README.md");
    assert_eq!(mention(found, "name"), None);
    assert_eq!(candidates("file.ts").collect::<Vec<_>>(), vec!["README.md"]);
}

#[test]
fn a_readme_that_is_there_and_does_not_read_refuses() {
    let root = std::env::temp_dir().join(format!("help-mention-unreadable-{}", std::process::id()));
    std::fs::create_dir_all(root.join("a/README.md")).unwrap();
    let read = readmes(&root, ["a/file.ts"].into_iter());
    std::fs::remove_dir_all(&root).unwrap();
    assert!(read.is_err_and(|refused| refused.starts_with("a/README.md is there and could not be read")));
}

#[test]
fn a_readme_farther_than_the_nearest_is_not_read() {
    let root = std::env::temp_dir().join(format!("help-mention-farther-{}", std::process::id()));
    std::fs::create_dir_all(root.join("README.md")).unwrap();
    std::fs::create_dir_all(root.join("a")).unwrap();
    std::fs::write(root.join("a/README.md"), "`name`").unwrap();
    let read = readmes(&root, ["a/file.ts"].into_iter());
    std::fs::remove_dir_all(&root).unwrap();
    let held = read.unwrap();
    assert_eq!(nearest(&held, "a/file.ts").map(|readme| readme.from.as_str()), Some("a/README.md"));
}
