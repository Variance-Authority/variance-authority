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
        rows.push(format!("{} {} {} {:?}", declaration.line, declaration.kind, declaration.name, declaration.exported));
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
        "2 function total Some(true)",
        "4 class Basket Some(true)",
        "  5 lines",
        "  6 add",
        "9 const limit Some(false)",
    ]);
}

#[test]
fn the_budget_shows_top_level_declarations_first_and_counts_the_members_and_declarations_it_cut() {
    let (records, parses) = chain(&[("src/basket.ts", "git:a", BASKET)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let cut = |budget: usize| {
        let found = declarations_of(&layers, &["src/basket.ts".to_owned()], budget).remove(0);
        (rows(&found), found.more, found.more_members)
    };
    assert_eq!(cut(4), (vec!["2 function total Some(true)".to_owned(), "4 class Basket Some(true)".to_owned(), "  5 lines".to_owned(), "9 const limit Some(false)".to_owned()], 0, 1));
    assert_eq!(cut(2), (vec!["2 function total Some(true)".to_owned(), "4 class Basket Some(true)".to_owned()], 1, 2));
    // The members of a declaration the budget cut are counted with the rest.
    assert_eq!(cut(1), (vec!["2 function total Some(true)".to_owned()], 2, 2));
}

#[test]
fn a_member_on_its_container_line_is_listed_as_symbol_lists_it() {
    let (records, parses) = chain(&[("src/id.ts", "git:b", "export type Id = { id: string; at: number };\n")]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found = declarations_of(&layers, &["src/id.ts".to_owned()], 40);
    assert_eq!(rows(&found[0]), vec!["1 type Id Some(true)", "  1 id", "  1 at"]);
}

#[test]
fn the_budget_spends_one_line_on_members_that_share_a_line_and_counts_the_lines_it_cut() {
    let source = "export type Id = { id: string; at: number };\nexport interface Box {\n  a: string; b: string; c: string;\n  d: number;\n}\n";
    let (records, parses) = chain(&[("src/box.ts", "git:c", source)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let cut = |budget: usize| {
        let found = declarations_of(&layers, &["src/box.ts".to_owned()], budget).remove(0);
        (rows(&found).len(), found.more, found.more_members)
    };
    // Two declarations and three member lines: five lines fit five.
    assert_eq!(cut(5), (8, 0, 0), "every member is shown and nothing is counted as cut");
    assert_eq!(cut(4), (7, 0, 1), "the last member line is the one cut");
    // Two lines cut, four members on them, counted as the two lines.
    assert_eq!(cut(3), (4, 0, 2));
}

#[test]
fn a_member_goes_under_the_declaration_it_is_written_in_when_another_shares_its_name() {
    let source = "export const Shape = { kind: 'shape' };\nexport type Shape = { width: number };\n\ninterface Box { a: string }\ninterface Box { b: string }\n";
    let (records, parses) = chain(&[("src/shape.ts", "git:d", source)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found = declarations_of(&layers, &["src/shape.ts".to_owned()], 40);
    assert_eq!(rows(&found[0]), vec![
        "1 const Shape Some(true)",
        "2 type Shape Some(true)",
        "  2 width",
        "4 interface Box Some(false)",
        "  4 a",
        "5 interface Box Some(false)",
        "  5 b",
    ]);
}
