//! A compaction against the encoder: the chain folded into one generation is
//! the generation the fold's result would have been encoded as. That the
//! encoder's bytes mean what JavaScript meant is `source-index.test.ts`'s.

use super::{compacted, merged};
use crate::generation::Delta;

fn encoded(document: &str) -> Vec<u8> {
    crate::graph_index::merged(&[], &Delta::of(vec![document.to_owned()]).unwrap())
}

/// Every column a row can fill, and each list both present-and-empty and absent.
const FULL: &str = r#"{
  "config": "v1:c",
  "directories": [["src", "v1:d"], ["lib", "v1:e"]],
  "records": [
    ["src/a.ts", {"record": {"file": "src/a.ts", "digest": "git:a",
      "edges": [{"to": "src/b.ts", "kind": "imports"}], "packages": [{"to": "react", "kind": "imports"}],
      "declares": ["A"], "unresolved": ["./gone"], "unknown": "src/a.ts — why"},
      "witnesses": ["src"], "targets": ["src/b.ts", null]}],
    ["src/b.ts", {"record": {"file": "src/b.ts", "edges": []}, "witnesses": []}]
  ],
  "parses": [
    ["git:a", {"requests": [{"value": "./b", "kind": "imports", "line": 3,
        "bindings": [{"imported": "B", "local": "Bee", "type": true, "line": 3}]}],
      "exports": [{"exported": "A", "local": "a", "type": false, "line": 5,
        "signature": {"start": 10, "end": 20}, "doc": {"start": 2, "end": 8}}, {"from": "./c", "line": 6}],
      "symbols": [{"name": "a", "kind": "function", "line": 5, "signature": {"start": 10, "end": 20}}],
      "harvested": true, "declares": ["A"], "mocks": {"minus": ["./b"], "plus": ["./fake"]},
      "members": [{"request": 0, "name": "render", "line": 9}],
      "memberDeclarations": [{"name": "resolve", "line": 12, "on": "Scanner"}, {"name": "render", "line": 14, "on": "a class"}],
      "unknown": "a reason"}],
    ["git:b\u0000.css\u0000+", {"requests": [], "exports": []}],
    ["git:c", {"requests": [], "memberDeclarations": [{"name": "resolve", "line": 4, "on": "Held"}]}]
  ]
}"#;

#[test]
fn one_generation_compacts_to_its_own_bytes() {
    let bytes = encoded(FULL);
    assert_eq!(compacted(&[&bytes]).unwrap(), bytes);
}

#[test]
fn a_later_layer_deletes_and_replaces_and_its_configuration_wins_even_when_absent() {
    let first = encoded(FULL);
    let second = encoded(r#"{
      "directories": [["test", "v1:t"]],
      "deletedDirectories": ["lib"],
      "records": [["src/b.ts", {"record": {"file": "src/b.ts", "digest": "git:b2"}, "witnesses": ["src"]}],
                  ["src/c.ts", {"record": {"file": "src/c.ts"}, "witnesses": []}]],
      "deletedRecords": ["src/a.ts"],
      "parses": [["git:d", {"requests": [], "declares": [],
        "memberDeclarations": [{"name": "resolve", "line": 7, "on": "Scanner"}, {"name": "only-in-d", "line": 9, "on": "Later"}]}]],
      "deletedParses": ["git:a", "git:b\u0000.css\u0000+"]
    }"#);
    // `git:a`'s declarations go with it; `git:c`'s survive from the older layer
    // and `git:d`'s arrive with the newer one, each re-interned into the fold's
    // strings. `resolve` on `Scanner` moves from line 12 to line 7.
    let expected = encoded(r#"{
      "directories": [["src", "v1:d"], ["test", "v1:t"]],
      "records": [["src/b.ts", {"record": {"file": "src/b.ts", "digest": "git:b2"}, "witnesses": ["src"]}],
                  ["src/c.ts", {"record": {"file": "src/c.ts"}, "witnesses": []}]],
      "parses": [["git:c", {"requests": [], "memberDeclarations": [{"name": "resolve", "line": 4, "on": "Held"}]}],
                 ["git:d", {"requests": [], "declares": [],
                   "memberDeclarations": [{"name": "resolve", "line": 7, "on": "Scanner"}, {"name": "only-in-d", "line": 9, "on": "Later"}]}]]
    }"#);
    assert_eq!(compacted(&[&first, &second]).unwrap(), expected);
}

#[test]
fn a_later_put_replaces_the_whole_row_and_a_later_delete_hides_it() {
    let first = encoded(FULL);
    let second = encoded(r#"{"config": "v1:c2", "records": [["src/a.ts",
      {"record": {"file": "src/a.ts"}, "witnesses": []}]], "deletedRecords": ["src/b.ts"]}"#);
    let mut expected: serde_json::Value = serde_json::from_str(FULL).unwrap();
    expected["config"] = "v1:c2".into();
    expected["records"] = serde_json::json!([["src/a.ts", {"record": {"file": "src/a.ts"}, "witnesses": []}]]);
    assert_eq!(compacted(&[&first, &second]).unwrap(), encoded(&expected.to_string()));
}

#[test]
fn a_layer_that_is_not_a_generation_is_refused_with_its_place() {
    let good = encoded(FULL);
    let error = compacted(&[&good, b"not a segment"]).unwrap_err();
    assert!(error.starts_with("layer 1:"), "{error}");
}

#[test]
fn a_working_layer_writes_no_row_the_base_already_holds() {
    let base = encoded(FULL);
    // Everything again, as an update that read every file writes it: one record
    // changed, and one parse read again without its harvest. A parse is keyed by
    // the bytes it was read from, so the base's row under its key is that parse.
    let mut again: serde_json::Value = serde_json::from_str(FULL).unwrap();
    again["records"][1][1] = serde_json::json!({"record": {"file": "src/b.ts", "digest": "git:b2"}, "witnesses": ["src"]});
    again["parses"][0][1] = serde_json::json!({"requests": []});
    let expected = encoded(r#"{
      "config": "v1:c",
      "records": [["src/b.ts", {"record": {"file": "src/b.ts", "digest": "git:b2"}, "witnesses": ["src"]}]]
    }"#);
    assert_eq!(merged(&[&base], &[&encoded(&again.to_string())]).unwrap(), expected);
}

#[test]
fn a_harvested_parse_is_written_over_the_one_the_base_holds_without_it() {
    let base = encoded(r#"{"parses": [["git:a", {"requests": []}]]}"#);
    let harvested = encoded(r#"{"parses": [["git:a", {"requests": [], "harvested": true, "declares": ["A"]}]]}"#);
    assert_eq!(merged(&[&base], &[&harvested]).unwrap(), harvested);
}

#[test]
fn a_row_put_back_as_the_base_holds_it_leaves_neither_the_row_nor_its_delete() {
    let base = encoded(FULL);
    let under = encoded(r#"{"config": "v1:c", "deletedRecords": ["src/a.ts"], "deletedDirectories": ["lib"]}"#);
    assert_eq!(merged(&[&base], &[&under, &encoded(FULL)]).unwrap(), encoded(r#"{"config": "v1:c"}"#));
}

#[test]
fn a_row_the_base_deleted_after_holding_it_is_written_again() {
    // The base is two segments, oldest first; the later one deletes a row of each kind the earlier holds.
    let deletes = encoded(r#"{"config": "v1:c", "deletedRecords": ["src/a.ts"], "deletedParses": ["git:c"], "deletedDirectories": ["lib"]}"#);
    let full: serde_json::Value = serde_json::from_str(FULL).unwrap();
    let expected = serde_json::json!({
      "config": "v1:c",
      "directories": [full["directories"][1]],
      "records": [full["records"][0]],
      "parses": [full["parses"][2]],
    });
    assert_eq!(merged(&[&encoded(FULL), &deletes], &[&encoded(FULL)]).unwrap(), encoded(&expected.to_string()));
}

#[test]
fn a_base_segment_that_is_not_a_generation_is_refused_with_its_place() {
    let layer = encoded(FULL);
    let error = merged(&[&layer, b"not a segment"], &[&layer]).unwrap_err();
    assert!(error.starts_with("base segment 1:"), "{error}");
}
