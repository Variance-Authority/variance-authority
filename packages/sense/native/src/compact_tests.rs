//! A compaction against the encoder: the chain folded into one generation is
//! the generation the fold's result would have been encoded as. That the
//! encoder's bytes mean what JavaScript meant is `source-index.test.ts`'s.

use super::compacted;
use crate::generation::Delta;
use crate::graph_index::merged;

fn encoded(document: &str) -> Vec<u8> {
    merged(&[], &Delta::of(vec![document.to_owned()]).unwrap())
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
      "members": [{"request": 0, "name": "render", "line": 9}], "unknown": "a reason"}],
    ["git:b\u0000.css\u0000+", {"requests": [], "exports": []}],
    ["git:c", {"requests": []}]
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
      "parses": [["git:d", {"requests": [], "declares": []}]],
      "deletedParses": ["git:a", "git:b\u0000.css\u0000+"]
    }"#);
    let expected = encoded(r#"{
      "directories": [["src", "v1:d"], ["test", "v1:t"]],
      "records": [["src/b.ts", {"record": {"file": "src/b.ts", "digest": "git:b2"}, "witnesses": ["src"]}],
                  ["src/c.ts", {"record": {"file": "src/c.ts"}, "witnesses": []}]],
      "parses": [["git:c", {"requests": []}], ["git:d", {"requests": [], "declares": []}]]
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
