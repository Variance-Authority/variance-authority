// compass: variance-authority.reach.source-index

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
            { "name": "a", "kind": "function", "line": 0, "endLine": 3, "signature": span, "reach": "module" },
            { "name": "b", "kind": "class", "line": 5, "endLine": 9 },
        ],
        "harvested": true,
        "declares": ["a"],
        "mocks": { "plus": ["./m"] },
        "members": [{ "request": 1, "name": "x", "line": 0, "throughDefault": true }, { "request": 0, "name": "y", "line": 4 }],
        "memberDeclarations": [{ "name": "m", "kind": "method", "line": 0, "endLine": 2, "on": "b", "doc": span, "lineText": "m()" }, { "name": "n", "kind": "property", "line": 1, "endLine": 1, "on": "b" }],
        "memberUses": [{ "name": "m", "line": 0, "of": "b", "how": "call" }],
        "ownUses": [{ "name": "a", "line": 0 }],
        "nested": [{ "name": "inner", "kind": "function", "line": 0, "endLine": 1, "signature": span, "holder": "a", "holderLine": 0 }, { "name": "loose", "kind": "variable", "line": 2, "endLine": 2, "signature": span, "holderLine": 0 }],
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
    serde_json::from_str(&chain.parse_json(chain.parse_at(key).unwrap())).unwrap()
}

fn keys(chain: &super::Chain) -> Vec<String> {
    chain.parses().iter().map(|&at| chain.parse_key(at)).collect()
}

#[test]
fn a_parse_crosses_back_as_it_was_held() {
    let segments = vec![segment(Some("c"), &[("a", full()), ("b", empty()), ("c\0way", bare())], &[("src/a.ts", record("src/a.ts"))], Deleted::default())];
    let chain = chain(&segments);
    assert_eq!(chain.layers.len(), 1);
    assert_eq!(read_back(&chain, "a"), full());
    assert_eq!(read_back(&chain, "b"), empty());
    assert_eq!(read_back(&chain, "c\0way"), bare());
    let record_at = chain.records()[0];
    assert_eq!(serde_json::from_str::<Value>(&chain.record_json(record_at)).unwrap(), record("src/a.ts"));
    assert_eq!(chain.directories, vec![("src", "dd")]);
}

#[test]
fn a_newer_layer_answers_and_a_damaged_one_ends_the_chain() {
    let deletes = ["b".to_owned()];
    let base = segment(Some("old"), &[("a", bare()), ("b", bare())], &[("x", record("x"))], Deleted::default());
    let over = segment(None, &[("a", empty()), ("z", bare())], &[], Deleted { parses: &deletes, ..Deleted::default() });
    let segments = vec![base.clone(), over.clone()];
    let read = chain(&segments);
    assert_eq!(read.layers.len(), 2);
    assert_eq!(keys(&read), ["a", "z"]);
    assert_eq!(read_back(&read, "a"), empty());
    assert!(read.layers.last().unwrap().config.is_none());
    let segments = vec![base, b"damaged".to_vec(), over];
    let read = chain(&segments);
    assert_eq!(read.layers.len(), 1);
    assert_eq!(read.written, None);
    assert_eq!(read_back(&read, "b"), bare());
}

#[test]
fn a_layer_that_puts_and_deletes_one_key_ends_the_chain_there() {
    let deletes = ["a".to_owned()];
    let base = segment(None, &[("a", bare())], &[], Deleted::default());
    let both = segment(None, &[("a", empty())], &[], Deleted { parses: &deletes, ..Deleted::default() });
    let segments = vec![base, both];
    let read = chain(&segments);
    assert_eq!(read.layers.len(), 1);
    assert_eq!(keys(&read), ["a"]);
    assert_eq!(read_back(&read, "a"), bare());
}

#[test]
fn a_walk_goes_in_code_unit_order_of_its_keys() {
    // U+FF61 sorts before U+1F600 by code point, after it by UTF-16 code unit;
    // the encoder takes its keys sorted, and a walk across layers answers in that order.
    let base = segment(None, &[("b", bare()), ("\u{1F600}", bare())], &[], Deleted::default());
    let over = segment(None, &[("b\0w", bare()), ("\u{FF61}", bare())], &[], Deleted::default());
    let segments = vec![base, over];
    let read = chain(&segments);
    assert_eq!(keys(&read), ["b", "b\0w", "\u{1F600}", "\u{FF61}"]);
}


#[test]
fn a_segment_whose_text_heap_is_not_utf8_ends_the_chain_there() {
    let base = segment(None, &[("b", empty())], &[], Deleted::default());
    let good = segment(None, &[("a", full())], &[], Deleted::default());
    let stored = crate::stored::Stored::open(&good).unwrap();
    let columns = stored.columns().into_iter().map(|(name, width, bytes)| {
        let mut bytes = bytes.to_vec();
        if name == "texts.blob" {
            bytes[0] = 0xff;
        }
        crate::segment::column(name.to_owned(), width, bytes)
    });
    let segments = vec![base, crate::segment::encode(columns.collect())];
    let chain = chain(&segments);
    assert_eq!(chain.layers.len(), 1);
    assert_eq!(chain.written, None);
    assert_eq!(chain.parse_at("a"), None);
    assert_eq!(read_back(&chain, "b"), empty());
}

#[test]
fn a_segments_version_is_read_off_its_header_alone() {
    let dir = std::env::temp_dir().join(format!("variance-segment-version-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let at = |name: &str, bytes: &[u8]| {
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path.to_string_lossy().into_owned()
    };
    let whole = segment(None, &[], &[], Deleted::default());
    let length = u32::from_le_bytes(whole[..4].try_into().unwrap()) as usize;
    // The header alone, everything behind it cut off, still names its version.
    assert_eq!(super::segment_version(at("header", &whole[..4 + length])), Some(u32::from(crate::segment::VERSION)));
    assert_eq!(super::segment_version(at("cut", &whole[..4 + length - 1])), None);
    assert_eq!(super::segment_version(at("junk", &[7; 64])), None);
    assert_eq!(super::segment_version(dir.to_string_lossy().into_owned()), None);
    assert_eq!(super::segment_version(dir.join("missing").to_string_lossy().into_owned()), None);
    std::fs::remove_dir_all(&dir).unwrap();
}
