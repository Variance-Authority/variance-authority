//! Each helper against what Node answers, and the rule against `witness.test.ts`'s cases.

use std::collections::HashSet;

use super::{dirname, join, normalize, witnesses_of};

#[test]
fn normalize_and_dirname_are_nodes() {
    for (path, normalized, parent) in [
        ("", ".", "."),
        ("/", "/", "/"),
        ("//", "/", "/"),
        ("a//b", "a/b", "a/"),
        ("/a", "/a", "/"),
        ("a/", "a/", "."),
        ("./", "./", "."),
        ("../a/./b/../../..", "../..", "../a/./b/../.."),
        ("/../a", "/a", "/.."),
        ("a/b/..", "a", "a/b"),
        ("./a/", "a/", "."),
        ("..", "..", "."),
        ("a/../..", "..", "a/.."),
        ("//a//b/", "/a/b/", "//a/"),
    ] {
        assert_eq!(normalize(path), normalized, "normalize {path:?}");
        assert_eq!(dirname(path), parent, "dirname {path:?}");
    }
}

#[test]
fn join_is_nodes() {
    assert_eq!(join(&["", ""]), ".");
    assert_eq!(join(&["a", "../../b"]), "../b");
    assert_eq!(join(&["", "./x/"]), "x/");
    assert_eq!(join(&["/a", "b"]), "/a/b");
}

#[test]
fn a_relative_request_witnesses_its_directory_and_the_candidate() {
    let directories: HashSet<String> = ["src", "src/button"].iter().map(|value| (*value).to_owned()).collect();
    let found = witnesses_of(
        "src/panel.ts",
        ["./button", "~./x?raw", "react"],
        ["src/button/index.ts"],
        &directories,
        [],
    );
    assert_eq!(found, ["src", "src/button"]);
}

#[test]
fn a_request_outside_the_repository_witnesses_nothing() {
    let found = witnesses_of("a.ts", ["../outside"], [], &HashSet::new(), []);
    assert!(found.is_empty());
}

#[test]
fn resolver_candidates_keep_missing_parent_and_existing_directory() {
    let directories = HashSet::from(["src/x".to_owned()]);
    assert_eq!(witnesses_of("a.ts", [], [], &directories, ["src/x", "generated/missing"]), ["generated", "src", "src/x"]);
}

#[test]
fn witnesses_sort_by_code_unit() {
    let found = witnesses_of("f.ts", [], ["\u{ffff}/a", "\u{10000}/a", "Z/a", "a/a"], &HashSet::new(), []);
    assert_eq!(found, ["Z", "a", "\u{10000}", "\u{ffff}"]);
}
