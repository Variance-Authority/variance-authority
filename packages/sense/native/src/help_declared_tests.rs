//! A name asked of the chain is found in the name table the parse segment
//! carries: the rows whose names and doc words hold it are the only ones read,
//! and a doc is matched by the words the index cut from it, with no file on
//! the disk to read it from.

use oxc_allocator::Allocator;

use super::{candidates, declared, Matching};
use crate::compact::Layer;
use crate::generation::Delta;
use crate::graph_index::merged;
use crate::index::{parses_only, way};
use crate::read::{read_module, Read};

const MOUNT: &str = "/** Mounts the app into a node. */\nfunction start() {}\nexport interface Host {\n  /** Where it mounts. */\n  place: string;\n}\n";
const PLAIN: &str = "function unrelated() {}\n";

/// A records layer naming each file at its digest, and a parse layer written
/// from each file's read: no file is on any disk.
fn chain(files: &[(&str, &str, &str)]) -> (Vec<u8>, Vec<u8>) {
    let records: Vec<String> = files
        .iter()
        .map(|(file, digest, _)| format!(r#"["{file}", {{"record": {{"file": "{file}", "digest": "{digest}"}}, "witnesses": [], "targets": []}}]"#))
        .collect();
    let document = format!(r#"{{"records": [{}], "parses": [], "deletedRecords": [], "deletedParses": []}}"#, records.join(", "));
    let reads: Vec<(String, Read)> = files
        .iter()
        .map(|(file, digest, source)| (crate::parse_store::key(digest, &way(file)), read_module(file, source, &Allocator::default(), true)))
        .collect();
    let mut rows: Vec<(&str, &Read)> = reads.iter().map(|(key, read)| (key.as_str(), read)).collect();
    rows.sort_unstable_by(|left, right| crate::order::code_unit(left.0, right.0));
    (merged(&[], &Delta::of(vec![document]).unwrap()), parses_only(&rows))
}

#[test]
fn a_doc_is_matched_by_the_words_the_index_cut_from_it_with_no_file_to_read() {
    let (records, parses) = chain(&[("src/mount.ts", "git:a", MOUNT), ("src/plain.ts", "git:b", PLAIN)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found = declared("/nonexistent-root", &layers, "mounts", Matching::Containing, None);
    let names: Vec<(&str, &str)> = found.names.iter().map(|name| (name.name.as_str(), name.at.as_str())).collect();
    assert_eq!(names, vec![("start", "src/mount.ts"), ("place", "src/mount.ts")]);
    assert!(found.unread.is_empty());
}

#[test]
fn only_the_rows_whose_names_or_doc_words_hold_the_question_are_candidates() {
    let (_, parses) = chain(&[("src/mount.ts", "git:a", MOUNT), ("src/plain.ts", "git:b", PLAIN)]);
    let layer = Layer::open(&parses).unwrap();
    let picked = candidates(&layer, "mounts", &Matching::Containing, None);
    let rows: Vec<bool> = (0..2).map(|row| picked.parse(row)).collect();
    assert_eq!(rows, vec![true, false]);
    let exact = candidates(&layer, "unrelated", &Matching::Exact, None);
    assert_eq!((0..2).map(|row| exact.parse(row)).collect::<Vec<_>>(), vec![false, true]);
}
