//! A file's top level read off the chain: each declaration with its line and
//! whether an export binds it, a container's members under it, and every cut
//! the line budget makes counted where it was made.

use oxc_allocator::Allocator;

use super::{declarations_of, FileDeclarations};
use crate::compact::Layer;
use crate::generation::Delta;
use crate::graph_index::merged;
use crate::index::{parses_only, way};
use crate::read::{read_module, Read};

const BASKET: &str = "/** The sum. */\nexport function total() {}\n\nexport class Basket {\n  lines = [];\n  add() {}\n}\n\nconst limit = 10;\n";

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

fn rows(found: &FileDeclarations) -> Vec<String> {
    let mut rows = Vec::new();
    for declaration in &found.declarations {
        rows.push(format!("{} {} {} {:?} +{}", declaration.line, declaration.kind, declaration.name, declaration.exported, declaration.more_members));
        rows.extend(declaration.members.iter().map(|member| format!("  {} {}", member.line, member.name)));
    }
    rows
}

#[test]
fn each_declaration_has_its_line_and_whether_an_export_binds_it_with_a_class_members_under_it() {
    let (records, parses) = chain(&[("src/basket.ts", "git:a", BASKET)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found = declarations_of(&layers, &["src/basket.ts".to_owned(), "src/gone.ts".to_owned()], 40);
    assert_eq!(found.len(), 1, "a file the chain does not hold is left out");
    assert!(found[0].read);
    assert_eq!(rows(&found[0]), vec![
        "2 function total Some(true) +0",
        "4 class Basket Some(true) +0",
        "  5 lines",
        "  6 add",
        "9 const limit Some(false) +0",
    ]);
}

#[test]
fn the_budget_shows_top_level_declarations_first_and_counts_the_members_and_declarations_it_cut() {
    let (records, parses) = chain(&[("src/basket.ts", "git:a", BASKET)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found = declarations_of(&layers, &["src/basket.ts".to_owned()], 4);
    assert_eq!(rows(&found[0]), vec!["2 function total Some(true) +0", "4 class Basket Some(true) +1", "  5 lines", "9 const limit Some(false) +0"]);
    assert_eq!(found[0].more, 0);
    let cut = declarations_of(&layers, &["src/basket.ts".to_owned()], 2);
    assert_eq!(rows(&cut[0]), vec!["2 function total Some(true) +0", "4 class Basket Some(true) +2"]);
    assert_eq!(cut[0].more, 1);
}
