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
fn private_word_counts_include_unasked_names_once_and_exclude_exported_locals() {
    let source = "function restartWorker() {}\ninterface unrelatedName {}\nconst unrelatedName = 1;\nfunction publishedLocal() {}\nexport { publishedLocal as renamed };\n";
    let (records, parses) = chain(&[("src/private.ts", "git:a", source), ("src/public.ts", "git:b", "export function restartWorker() {}")]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found = super::private_words(&layers, &crate::chain_lookup::fold(&layers), &["restart".to_owned(), crate::dependency_lexicon::purposes::code_stems("unrelated").into_iter().next().unwrap(), "publish".to_owned()]);
    let rows: Vec<(&str, u32)> = found.iter().map(|row| (row.at.as_str(), row.words)).collect();
    let expected = ["restartWorker", "unrelatedName"].iter().map(|name| crate::help_search::name_terms(name).len() as u32).sum();
    assert_eq!(rows, vec![("src/private.ts", expected), ("src/public.ts", 0)]);
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
    ]);
    let directory = std::env::temp_dir().join(format!("sense-classify-names-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    let index = directory.join("index.bin").to_str().unwrap().to_owned();
    assert!(crate::log::written(&index, crate::log::Over::Nothing, &[], &[&records, &parses], &[], 0).unwrap());
    let words = ["worker_name", "WorkerName", "privateName", "nestedName", "aliasName"].map(str::to_owned).to_vec();
    let answer = crate::classify_areas::classify_names("/no-usable-checkout".to_owned(), words.clone(), 1, index.clone(), "app".to_owned()).unwrap();
    assert!(answer.refused.is_none());
    assert_eq!(answer.named[0].files, vec!["lib/worker_name.ts"]);
    assert_eq!(answer.named[0].count, 2);
    let declarations: Vec<(&str, &str)> = answer.declared.iter().map(|row| (row.name.as_str(), row.at.as_str())).collect();
    assert_eq!(declarations, vec![("WorkerName", "lib/worker_name.ts"), ("WorkerName", "test/worker_name.test.ts"), ("privateName", "lib/worker_name.ts"), ("nestedName", "lib/worker_name.ts")]);
    std::fs::create_dir_all(directory.join("lib")).unwrap();
    std::fs::write(directory.join("lib/worker_name.ts"), "function differentLiveName() {}\n").unwrap();
    std::fs::write(directory.join("package.json"), "invalid live manifest").unwrap();
    let drifted = crate::classify_areas::classify_names(directory.to_str().unwrap().to_owned(), words, 1, index, "app".to_owned()).unwrap();
    assert_eq!(drifted.named[0].files, answer.named[0].files);
    assert_eq!(drifted.named[0].count, answer.named[0].count);
    assert_eq!(drifted.declared.iter().map(|row| (&row.name, &row.at, row.line)).collect::<Vec<_>>(), answer.declared.iter().map(|row| (&row.name, &row.at, row.line)).collect::<Vec<_>>());
    std::fs::remove_dir_all(directory).unwrap();
}
