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
fn exact_declarations_keep_live_shared_paths_in_order_and_report_unread_files() {
    let source = "function start() {}\nfunction holder() {\n  function start() {}\n}\n";
    let (records, parses) = chain(&[("src/z.ts", "git:a", source), ("src/gone.ts", "git:b", MOUNT)]);
    let (shared, _) = chain(&[("src/a.ts", "git:a", source), ("src/unread-z.ts", "git:c", PLAIN), ("src/unread-a.ts", "git:d", PLAIN)]);
    let changes = Delta::of(vec![r#"{"deletedRecords":["src/gone.ts"]}"#.to_owned()]).unwrap();
    let removed = merged(&[], &changes);
    let layers = [&records, &parses, &shared, &removed].map(|bytes| Layer::open(bytes).unwrap());
    let found = declared("/nonexistent-root", &layers, "start", Matching::Exact, None);
    let sites: Vec<_> = found.names.iter().map(|name| (name.at.as_str(), name.line)).collect();
    assert_eq!(sites, [("src/a.ts", 1), ("src/a.ts", 3), ("src/z.ts", 1), ("src/z.ts", 3)]);
    assert_eq!(found.unread, ["src/unread-a.ts", "src/unread-z.ts"]);
}

#[test]
fn a_declaration_a_newer_layer_replaced_deleted_or_unparsed_is_not_found_and_what_is_left_unread_is_named() {
    let (records, parses) = chain(&[
        ("src/keep.ts", "git:k", MOUNT), ("src/swap.ts", "git:s", MOUNT), ("src/gone.ts", "git:g", MOUNT), ("src/dropped.ts", "git:p", MOUNT),
    ]);
    let (swapped, _) = chain(&[("src/swap.ts", "git:t", PLAIN)]);
    let (_, plain) = chain(&[("src/swap.ts", "git:t", PLAIN)]);
    let key = crate::parse_store::key("git:h", &way("src/half.ts"));
    let half_records = merged(&[], &Delta::of(vec![
        r#"{"records": [["src/half.ts", {"record": {"file": "src/half.ts", "digest": "git:h"}, "witnesses": [], "targets": []}]]}"#.to_owned(),
    ]).unwrap());
    let unharvested = read_module("src/half.ts", MOUNT, &Allocator::default(), false);
    let half = parses_only(&[(key.as_str(), &unharvested)]);
    let dropped = crate::parse_store::key("git:p", &way("src/dropped.ts")).replace('\0', "\\u0000");
    let deletes = merged(&[], &Delta::of(vec![
        format!(r#"{{"deletedRecords": ["src/gone.ts"], "deletedParses": ["{dropped}"]}}"#),
    ]).unwrap());
    let layers = [&records, &parses, &swapped, &plain, &half_records, &half, &deletes].map(|bytes| Layer::open(bytes).unwrap());
    let found = declared("/nonexistent-root", &layers, "start", Matching::Exact, None);
    let sites: Vec<_> = found.names.iter().map(|name| name.at.as_str()).collect();
    assert_eq!(sites, ["src/keep.ts"]);
    assert_eq!(found.unread, ["src/dropped.ts", "src/half.ts"]);
}

#[test]
fn a_file_described_by_its_name_alone_still_counts_the_words_of_its_module_doc() {
    let source = "/** Starts the app. */\n\nexport const x = 1;\n";
    let (records, parses) = chain(&[("src/mount.ts", "git:a", source)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let asked = Matching::Described { stems: vec!["mount".to_owned()], query: "mount".to_owned() };
    let found = declared("/nonexistent-root", &layers, "mount", asked, None);
    let files: Vec<(&str, Option<u32>)> = found.files.iter().map(|file| (file.at.as_str(), file.doc_length)).collect();
    assert_eq!(files, vec![("src/mount.ts", Some("starts the app.".len() as u32))]);
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
    let marked = candidates(&layer, "a\u{0}b", &Matching::Exact, None);
    assert_eq!((0..2).map(|row| marked.parse(row)).collect::<Vec<_>>(), vec![true, true]);
}

#[test]
fn private_words_include_unasked_names_once_and_exclude_exported_locals() {
    let source = "function restartWorker() {}\ninterface unrelatedName {}\nconst unrelatedName = 1;\nfunction publishedLocal() {}\nexport { publishedLocal as renamed };\n";
    let (records, parses) = chain(&[("src/private.ts", "git:a", source), ("src/public.ts", "git:b", "export function restartWorker() {}")]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found = super::private_words(&layers, &["restart".to_owned(), crate::dependency_lexicon::purposes::code_stems("unrelated").into_iter().next().unwrap(), "publish".to_owned()]);
    let rows: Vec<(&str, bool)> = found.iter().map(|row| (row.at.as_str(), row.declares)).collect();
    assert_eq!(rows, vec![("src/private.ts", true), ("src/public.ts", false)]);
    assert_eq!(found[0].named, vec![0, 1]);
    assert!(found[1].named.is_empty());
    let unmatched = declared("/nonexistent-root", &layers, "notDeclaredAnywhere", Matching::Exact, None);
    assert!(unmatched.names.is_empty());
}

#[test]
fn classifier_names_come_only_from_the_published_workspace() {
    let (records, parses) = chain(&[
        ("app/lib/worker_name.ts", "git:a", "export function WorkerName() {}\nfunction privateName() { function nestedName() {} }\nfunction localName() {}\nexport { localName as aliasName };\n"),
        ("app/test/worker_name.test.ts", "git:b", "function WorkerName() {}"),
        ("outside/worker_name.ts", "git:c", "function WorkerName() {}"),
        ("worker_name.ts", "git:d", "function RootName() {}"),
    ]);
    let directory = std::env::temp_dir().join(format!("sense-classify-names-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    let index = directory.join("index.bin").to_str().unwrap().to_owned();
    assert!(crate::log::written(&index, crate::log::Over::Nothing, &[], &[&records, &parses], &[], 0).unwrap());
    let words = ["worker_name", "WorkerName", "privateName", "nestedName", "aliasName"].map(str::to_owned).to_vec();
    let answer = crate::classify_areas::classify_names(words.clone(), 1, index.clone(), "app".to_owned()).unwrap();
    assert!(answer.refused.is_none());
    assert_eq!(answer.named[0].files, vec!["lib/worker_name.ts"]);
    assert_eq!(answer.named[0].count, 2);
    let declarations: Vec<(&str, &str)> = answer.declared.iter().map(|row| (row.name.as_str(), row.at.as_str())).collect();
    assert_eq!(declarations, vec![("WorkerName", "lib/worker_name.ts"), ("WorkerName", "test/worker_name.test.ts"), ("privateName", "lib/worker_name.ts"), ("nestedName", "lib/worker_name.ts")]);
    std::fs::create_dir_all(directory.join("lib")).unwrap();
    std::fs::write(directory.join("lib/worker_name.ts"), "function differentLiveName() {}\n").unwrap();
    std::fs::write(directory.join("package.json"), "invalid live manifest").unwrap();
    let drifted = crate::classify_areas::classify_names(words, 1, index, "app".to_owned()).unwrap();
    assert_eq!(drifted.named[0].files, answer.named[0].files);
    assert_eq!(drifted.named[0].count, answer.named[0].count);
    assert_eq!(drifted.declared.iter().map(|row| (&row.name, &row.at, row.line)).collect::<Vec<_>>(), answer.declared.iter().map(|row| (&row.name, &row.at, row.line)).collect::<Vec<_>>());
    let spelled = ["lib/worker_name.ts", "./test/worker_name.test.ts", "./worker_name.ts", "../lib/worker_name.ts", "/lib/worker_name.ts", "worker_name.test.ts", "worker_name.ts", "app/lib/worker_name.ts", "outside/worker_name.ts", "ib/worker_name.ts", "lib/worker_name", "name.ts", "worker_name.t"];
    let found = crate::classify_areas::classify_names(spelled.map(str::to_owned).to_vec(), 1, directory.join("index.bin").to_str().unwrap().to_owned(), "app".to_owned()).unwrap();
    let files: Vec<(&str, &str, u32)> = found.named.iter().map(|one| (one.name.as_str(), one.files[0].as_str(), one.count)).collect();
    assert_eq!(files, vec![("lib/worker_name.ts", "lib/worker_name.ts", 1), ("./test/worker_name.test.ts", "test/worker_name.test.ts", 1), ("worker_name.test.ts", "test/worker_name.test.ts", 1), ("worker_name.ts", "lib/worker_name.ts", 1)]);
    let shared = crate::classify_areas::classify_names(vec!["worker_name.ts".to_owned()], 1, directory.join("index.bin").to_str().unwrap().to_owned(), String::new()).unwrap();
    assert_eq!((shared.named[0].files.as_slice(), shared.named[0].count), (["worker_name.ts".to_owned()].as_slice(), 3));
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn private_file_eligibility_requires_a_searchable_top_level_name() {
    let (records, parses) = chain(&[
        ("src/short.ts", "git:a", "const x = 1; const a_b = 2; const é = 3;"),
        ("src/astral.ts", "git:b", "function 𐐀() {}"),
        ("src/alias.ts", "git:c", "function searchableLocal() {} export { searchableLocal as x };"),
        ("src/empty.ts", "git:d", "export {};"),
        ("src/nested.ts", "git:e", "function x() { function searchableNested() {} }"),
    ]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found = super::private_words(&layers, &[]);
    let eligible: std::collections::BTreeSet<&str> = found.iter().filter(|row| row.declares).map(|row| row.at.as_str()).collect();
    assert_eq!(eligible, ["src/astral.ts"].into_iter().collect());
}
