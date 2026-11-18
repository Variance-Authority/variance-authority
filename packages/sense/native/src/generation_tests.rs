//! The generation's framing and dictionary. What its columns mean is held by
//! the JavaScript reader: `source-index.test.ts` decodes every save it makes.

use super::{encode_generation, encode_generation_carrying, Deleted, Delta, Generation};
use crate::held::HeldParse;
use crate::record::Indexed;

fn header(bytes: &[u8]) -> serde_json::Value {
    let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    let text = std::str::from_utf8(&bytes[4..4 + length]).unwrap().trim_end_matches('\0');
    serde_json::from_str(text).unwrap()
}

#[test]
fn every_column_the_decoder_names_is_written_in_its_order() {
    let delta: Delta = serde_json::from_str(
        r#"{"config":"v1:c","directories":[["src","v1:d"]],
            "records":[["src/a.css",{"record":{"file":"src/a.css","digest":"git:a"},"witnesses":["src"],"targets":[null,"src/b.css"]}]],
            "parses":[["git:a\u0000.css\u0000+",{"requests":[{"value":"./b.css","kind":"imports","bindings":[]}],"exports":[]}]]}"#,
    )
    .unwrap();
    let parses: Vec<(&str, &HeldParse)> = delta.parses.iter().map(|(key, parse)| (key.as_str(), parse)).collect();
    let records: Vec<(&str, &Indexed)> = delta.records.iter().map(|(file, held)| (file.as_str(), held)).collect();
    let bytes = encode_generation(&Generation {
        config: delta.config.as_deref(),
        directories: &delta.directories,
        parses: &parses,
        records: &records,
        deleted: Deleted::default(),
    });
    let header = header(&bytes);
    assert_eq!(header["format"], "variance-authority-source-index");
    let names: Vec<&str> = header["sections"].as_array().unwrap().iter().map(|section| section["name"].as_str().unwrap()).collect();
    assert_eq!(names[..3], ["strings.blob", "strings.off", "index.config"]);
    assert_eq!(names.iter().position(|name| *name == "parses.deleted"), Some(8));
    assert_eq!(names.last(), Some(&"packages.kind"));
    let path = names.iter().position(|name| *name == "targets.path").unwrap();
    assert_eq!(names[path + 1..path + 4], ["targets.reverse-to", "targets.reverse", "targets.reverse-row"]);
    assert_eq!(names.len(), 139);
}

#[test]
fn a_listing_encoded_with_the_generation_is_the_segment_it_would_be_carried_into() {
    let delta: Delta = serde_json::from_str(
        r#"{"config":"v1:c","directories":[["src","v1:d"]],
            "records":[["src/a.css",{"record":{"file":"src/a.css","digest":"git:a"},"witnesses":["src"],"targets":[null,"src/b.css"]}]],
            "parses":[["git:a\u0000.css\u0000+",{"requests":[{"value":"./b.css","kind":"imports","bindings":[]}],"exports":[]}]]}"#,
    )
    .unwrap();
    let parses: Vec<(&str, &HeldParse)> = delta.parses.iter().map(|(key, parse)| (key.as_str(), parse)).collect();
    let records: Vec<(&str, &Indexed)> = delta.records.iter().map(|(file, held)| (file.as_str(), held)).collect();
    let generation = Generation { config: delta.config.as_deref(), directories: &delta.directories, parses: &parses, records: &records, deleted: Deleted::default() };
    let listing = || vec![crate::segment::u8s("listing.paths", b"src/a.css\0src/b.css".to_vec()), crate::segment::u8s("listing.meta", b"{}".to_vec())];
    let carried = crate::held_listing::carried(&encode_generation(&generation), listing()).unwrap();
    // A segment read back and written again keeps its sections in the order it laid them out, empty ones included.
    assert_eq!(crate::held_listing::carried(&encode_generation(&generation), Vec::new()).unwrap(), encode_generation(&generation));
    assert_eq!(encode_generation_carrying(&generation, listing()), carried);
    assert_eq!(encode_generation_carrying(&generation, Vec::new()), encode_generation(&generation));
}

#[test]
fn a_kept_text_is_read_back_from_the_heap_and_never_enters_the_dictionary() {
    let delta: Delta = serde_json::from_str(
        r#"{"parses":[["git:a\u0000.ts\u0000+",{"requests":[],"exports":[{"exported":"open","local":"open","line":2,
            "signature":{"start":10,"end":30,"text":"export function open()"},
            "doc":{"start":0,"end":9,"text":"Opens the door nobody looks up."},
            "lineText":"export function open() {"}]}]]}"#,
    )
    .unwrap();
    let parses: Vec<(&str, &HeldParse)> = delta.parses.iter().map(|(key, parse)| (key.as_str(), parse)).collect();
    let bytes = encode_generation(&Generation { config: None, directories: &[], parses: &parses, records: &[], deleted: Deleted::default() });
    let stored = crate::stored::Stored::open(&bytes).unwrap();
    let kept = |column: &str| stored.kept(stored.u32s(column).unwrap().at(0));
    assert_eq!(kept("exports.signature-text"), Some("export function open()"));
    assert_eq!(kept("exports.doc-text"), Some("Opens the door nobody looks up."));
    assert_eq!(kept("exports.line-text"), Some("export function open() {"));
    let dictionary = String::from_utf8_lossy(stored.u8s("strings.blob").unwrap());
    assert!(!dictionary.contains("nobody looks up") && !dictionary.contains("function"), "{dictionary}");
}

#[test]
fn documents_join_into_one_generation_in_the_order_they_were_written() {
    let delta = Delta::of(vec![
        r#"{"config":"v1:c","deletedRecords":["gone.ts"]}"#.to_owned(),
        r#"{"records":[["a.ts",{"record":{"file":"a.ts"},"witnesses":[]}]]}"#.to_owned(),
        r#"{"records":[["b.ts",{"record":{"file":"b.ts"},"witnesses":[]}]],"directories":[["src","v1:d"]]}"#.to_owned(),
    ])
    .unwrap();
    assert_eq!(delta.config.as_deref(), Some("v1:c"));
    let files: Vec<&str> = delta.records.iter().map(|(file, _)| file.as_str()).collect();
    assert_eq!(files, ["a.ts", "b.ts"]);
    assert_eq!(delta.directories, [("src".to_owned(), "v1:d".to_owned())]);
    assert_eq!(delta.deleted_records, ["gone.ts"]);
}

#[test]
fn a_document_that_does_not_parse_refuses_the_whole_generation() {
    assert!(Delta::of(vec!["{}".to_owned(), "{\"records\":".to_owned()]).is_err());
}
