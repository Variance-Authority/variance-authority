// compass: variance-authority.reach.source-index

use std::collections::HashSet;

use serde_json::{json, Value};

use super::chain;
use crate::generation::{encode_generation, Deleted, Generation};
use crate::held::HeldParse;
use crate::record::Indexed;

/// Every column family, its optional fields both set and left out, and a zero line.
fn full() -> Value {
    let span = json!({ "start": 0, "end": 4, "text": "head" });
    json!({
        "requests": [
            { "value": "./a", "kind": "import", "line": 0, "bindings": [{ "imported": "a", "local": "a", "type": false, "line": 0 }] },
            { "value": "b", "kind": "require", "line": 2, "bindings": [], "guessed": true, "item": true, "republishes": true },
        ],
        "exports": [
            { "exported": "a", "local": "a", "type": false, "line": 0, "signature": span, "doc": { "start": 1, "end": 2 }, "roles": ["testOnly", "production"], "lineText": "export a" },
            { "from": "./c", "imported": "c", "type": true, "line": 3 },
        ],
        "symbols": [
            { "name": "a", "kind": "function", "line": 0, "signature": span, "reach": "module" },
            { "name": "b", "kind": "class", "line": 5 },
        ],
        "harvested": true,
        "declares": ["a"],
        "mocks": { "plus": ["./m"] },
        "members": [{ "request": 1, "name": "x", "line": 0, "throughDefault": true }, { "request": 0, "name": "y", "line": 4 }],
        "memberDeclarations": [{ "name": "m", "line": 0, "on": "b", "doc": span, "lineText": "m()" }, { "name": "n", "line": 1, "on": "b" }],
        "memberUses": [{ "name": "m", "line": 0, "of": "b", "how": "call" }],
        "ownUses": [{ "name": "a", "line": 0 }],
        "nested": [{ "name": "inner", "kind": "function", "line": 0, "signature": span, "holder": "a", "holderLine": 0 }, { "name": "loose", "kind": "variable", "line": 2, "signature": span, "holderLine": 0 }],
        "bindingMembers": [{ "request": 0, "binding": "a", "within": ["p"], "name": "q", "line": 0 }, { "request": 0, "binding": "a", "name": "r", "line": 1 }],
        "unknown": "too large",
        "size": { "bytes": 10, "lines": 0, "blocks": 1 },
        "doc": span,
    })
}

/// Lists present and empty beside lists absent.
fn empty() -> Value {
    json!({ "requests": [], "exports": [], "declares": [] })
}

fn bare() -> Value {
    json!({ "requests": [], "size": { "bytes": 0, "lines": 0 } })
}

fn record(file: &str) -> Value {
    json!({ "record": { "file": file, "digest": "d", "edges": [], "packages": [{ "to": "react", "kind": "import" }] }, "witnesses": ["src"], "targets": [null, "src/b.ts"] })
}

fn segment(config: Option<&str>, parses: &[(&str, Value)], records: &[(&str, Value)], deleted: Deleted) -> Vec<u8> {
    let held: Vec<(&str, HeldParse)> = parses.iter().map(|(key, value)| (*key, serde_json::from_value(value.clone()).unwrap())).collect();
    let indexed: Vec<(&str, Indexed)> = records.iter().map(|(file, value)| (*file, serde_json::from_value(value.clone()).unwrap())).collect();
    let parses: Vec<(&str, &HeldParse)> = held.iter().map(|(key, held)| (*key, held)).collect();
    let records: Vec<(&str, &Indexed)> = indexed.iter().map(|(file, held)| (*file, held)).collect();
    let directories = [("src".to_owned(), "dd".to_owned())];
    encode_generation(&Generation { config, directories: &directories, parses: &parses, records: &records, deleted })
}

fn read_back(chain: &super::Chain, key: &str) -> Value {
    let index = chain.parses.at[key];
    serde_json::from_str(&super::parse_json(chain, chain.parses.order[index].1)).unwrap()
}

#[test]
fn a_parse_crosses_back_as_it_was_held() {
    let segments = vec![segment(Some("c"), &[("a", full()), ("b", empty()), ("c\0way", bare())], &[("src/a.ts", record("src/a.ts"))], Deleted::default())];
    let chain = chain(&segments, &HashSet::new());
    assert_eq!(chain.layers.len(), 1);
    assert_eq!(read_back(&chain, "a"), full());
    assert_eq!(read_back(&chain, "b"), empty());
    assert_eq!(read_back(&chain, "c\0way"), bare());
    let record_at = chain.records.order[0].1;
    assert_eq!(serde_json::from_str::<Value>(&super::record_json(&chain, record_at)).unwrap(), record("src/a.ts"));
    assert_eq!(chain.directories, vec![("src", "dd")]);
}

#[test]
fn a_newer_layer_answers_and_a_damaged_one_ends_the_chain() {
    let deletes = ["b".to_owned()];
    let base = segment(Some("old"), &[("a", bare()), ("b", bare())], &[("x", record("x"))], Deleted::default());
    let over = segment(None, &[("a", empty()), ("z", bare())], &[], Deleted { parses: &deletes, ..Deleted::default() });
    let segments = vec![base.clone(), over.clone()];
    let read = chain(&segments, &HashSet::new());
    assert_eq!(read.layers.len(), 2);
    let keys: Vec<&str> = read.parses.order.iter().map(|(key, _)| key.as_ref()).collect();
    assert_eq!(keys, ["a", "z"]);
    assert_eq!(read_back(&read, "a"), empty());
    assert!(read.layers.last().unwrap().config.is_none());
    let segments = vec![base, b"damaged".to_vec(), over];
    let read = chain(&segments, &HashSet::new());
    assert_eq!(read.layers.len(), 1);
    assert_eq!(read.written, None);
    assert_eq!(read_back(&read, "b"), bare());
}
