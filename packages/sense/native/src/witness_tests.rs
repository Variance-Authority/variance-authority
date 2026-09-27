//! Each helper against what Node answers, and the rule against `witness.test.ts`'s cases.

use std::collections::HashSet;

use super::{dirname, join, normalize, replace_star, witnesses_of, AliasTable};

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
fn a_wildcard_is_substituted_as_replace_substitutes_it() {
    assert_eq!(replace_star("x/$$/*", "m"), "x/$$/m");
    assert_eq!(replace_star("pre/*/post*", "$$|$&|$`|$'|$1|$"), "pre/$|*|pre/|/post*|$1|$/post*");
    assert_eq!(replace_star("no-star", "m"), "no-star");
}

fn table(json: &str) -> AliasTable {
    serde_json::from_str(json).unwrap()
}

#[test]
fn a_relative_request_witnesses_its_directory_and_the_candidate() {
    let directories: HashSet<String> = ["src", "src/button"].iter().map(|value| (*value).to_owned()).collect();
    let found = witnesses_of(
        "src/panel.ts",
        ["./button", "~./x?raw", "react"],
        ["src/button/index.ts"],
        &directories,
        None,
    );
    assert_eq!(found, ["src", "src/button"]);
}

#[test]
fn a_request_outside_the_repository_witnesses_nothing() {
    let found = witnesses_of("a.ts", ["../outside"], [], &HashSet::new(), None);
    assert!(found.is_empty());
}

#[test]
fn an_alias_names_its_substituted_targets_after_its_bases() {
    let aliases = table(
        r#"{"bases":["lib"],"mappings":[
            {"prefix":"@app/","suffix":"","targets":["src/*","gen/*/index"]},
            {"prefix":"exact","targets":["one/two.ts"]}]}"#,
    );
    assert_eq!(
        aliases.candidates_for("@app/x"),
        ["lib/@app/x", "src/x", "gen/x/index"],
    );
    assert_eq!(aliases.candidates_for("exact"), ["lib/exact", "one/two.ts"]);
    let directories: HashSet<String> = ["src/x", "gen/x"].iter().map(|value| (*value).to_owned()).collect();
    let found = witnesses_of("a/b.ts", ["@app/x"], [], &directories, Some(&aliases));
    assert_eq!(found, ["gen/x", "lib/@app", "src", "src/x"]);
}

#[test]
fn witnesses_sort_by_code_unit() {
    let found = witnesses_of("f.ts", [], ["\u{ffff}/a", "\u{10000}/a", "Z/a", "a/a"], &HashSet::new(), None);
    assert_eq!(found, ["Z", "a", "\u{10000}", "\u{ffff}"]);
}
