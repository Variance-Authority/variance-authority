//! Rows written in runs side by side and joined give the bytes one pass in
//! order gives, and a text heap held in parts the bytes of one buffer.

use super::{Heap, ParseColumns, PART};
use crate::generation::key_parts;
use crate::held::HeldParse;
use crate::segment::{encode, u32s, u8s, Collected, Strings};

/// Row `n`: every list a parse holds, kept texts among them, or nothing at all
/// every third row, so runs start and end on empty lists too.
fn row(n: usize) -> String {
    if n % 3 == 2 {
        return r#"{"requests": []}"#.to_owned();
    }
    format!(
        r#"{{"requests": [{{"value": "./m{n}", "kind": "imports", "line": {n},
              "bindings": [{{"imported": "B{n}", "local": "b", "type": true}}, {{"imported": "C", "local": "c"}}]}},
            {{"value": "./n", "kind": "exports", "republishes": true}}],
          "exports": [{{"exported": "E{n}", "local": "e", "line": 2, "lineText": "export const e{n} = 1;",
              "signature": {{"start": 1, "end": 9, "text": "const e{n}"}}, "doc": {{"start": 0, "end": 1}}}}, {{"from": "./n"}}],
          "symbols": [{{"name": "s{n}", "kind": "function", "reach": "exported", "doc": {{"start": 3, "end": 4, "text": "Does {n}."}}}}],
          "harvested": true, "declares": ["D{n}"], "mocks": {{"minus": ["./x"], "plus": ["./y{n}"]}},
          "members": [{{"request": 0, "name": "m{n}", "throughDefault": true}}],
          "memberDeclarations": [{{"name": "md", "on": "O{n}", "lineText": "md() {{", "doc": {{"start": 5, "end": 6, "text": "M{n}"}}}}],
          "memberUses": [{{"name": "u", "of": "o{n}", "how": "call"}}], "ownUses": [{{"name": "own{n}", "line": 3}}],
          "nested": [{{"name": "n{n}", "kind": "class", "holder": "h", "holderLine": 1, "signature": {{"start": 7, "end": 8, "text": "class n{n}"}}}}],
          "bindingMembers": [{{"request": 0, "binding": "b", "name": "bm{n}", "within": ["w{n}", "v"]}}, {{"binding": "c", "name": "cm"}}],
          "unknown": "why {n}", "doc": {{"start": 0, "end": 2, "text": "File {n}."}}}}"#
    )
}

#[test]
fn rows_written_in_runs_join_to_the_bytes_of_one_pass() {
    let keys: Vec<String> = (0..10).map(|n| format!("git:{n:02}\u{0}.ts\u{0}+")).collect();
    let parses: Vec<HeldParse> = (0..10).map(|n| serde_json::from_str(&row(n)).unwrap()).collect();
    let rows: Vec<(&str, &HeldParse)> = keys.iter().map(String::as_str).zip(&parses).collect();
    let mut values = Collected::default();
    for (key, parse) in &rows {
        let (digest, way) = key_parts(key);
        values.insert(digest);
        values.insert(way);
        crate::parse_columns::ParseRow::strings(*parse, &mut values);
    }
    let strings = Strings::of(values);
    let bytes = |run: usize| encode(ParseColumns::in_runs(&rows, &strings, run).columns([u32s("a", vec![]), u32s("b", vec![])]));
    let whole = bytes(rows.len());
    for run in [1, 2, 3, 4, 7] {
        assert!(bytes(run) == whole, "runs of {run} differ from one pass");
    }
}

#[test]
fn a_text_heap_past_one_part_gives_the_bytes_of_one_buffer() {
    let texts: Vec<String> = (b'a'..b'f').map(|letter| char::from(letter).to_string().repeat(PART / 3)).collect();
    let mut heap = Heap::default();
    let ids: Vec<u32> = texts.iter().map(|text| heap.push(Some(text))).collect();
    assert_eq!(ids, [0, 1, 2, 3, 4]);
    assert!(!heap.parts.is_empty(), "the texts fit one part, so no part was closed");
    let ends = texts.iter().scan(0, |end, text| {
        *end += text.len() as u32;
        Some(*end)
    });
    let one = [u8s("texts.blob", texts.concat().into_bytes()), u32s("texts.off", std::iter::once(0).chain(ends).collect())];
    assert!(encode(heap.columns().into()) == encode(one.into()), "the parts differ from one buffer");
}

#[test]
fn heaps_past_one_part_joined_give_the_bytes_of_one_heap() {
    let texts: Vec<String> = (b'a'..b's').map(|letter| char::from(letter).to_string().repeat(PART / 3)).collect();
    let heap_of = |texts: &[String]| {
        let mut heap = Heap::default();
        texts.iter().for_each(|text| {
            heap.push(Some(text));
        });
        heap
    };
    let mut runs = texts.chunks(6).map(heap_of);
    let mut joined = runs.next().unwrap();
    for (run, heap) in runs.enumerate() {
        assert!(!heap.parts.is_empty(), "a run fits one part, so its held bytes are not exercised");
        assert_eq!(joined.append(heap) as usize, 6 * (run + 1));
    }
    let whole = heap_of(&texts);
    assert!(encode(joined.columns().into()) == encode(whole.columns().into()), "the joined heaps differ from one heap");
}
