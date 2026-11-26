//! A file's top level read off the chain: each declaration with its line and
//! whether an export binds it, a container's members under it, and every cut
//! the line budget makes counted where it was made; and the declarations an
//! asked line is in, by the lines each one spans.

use oxc_allocator::Allocator;

use super::{declarations_of, lines_held, AskedLine, FileDeclarations, LineHeld};
use crate::compact::Layer;
use crate::generation::Delta;
use crate::graph_index::merged;
use crate::index::{parses_only, way};
use crate::read::Read;
use crate::read_any::read_file;

const BASKET: &str = "/** The sum. */\nexport function total() {}\n\nexport class Basket {\n  lines = [];\n  add() {}\n}\n\nconst limit = 10;\n";

/// A records layer naming each file at its digest, and a parse layer written
/// from each file's read, in the language its name says: no file is on any disk.
fn chain(files: &[(&str, &str, &str)]) -> (Vec<u8>, Vec<u8>) {
    let records: Vec<String> = files
        .iter()
        .map(|(file, digest, _)| format!(r#"["{file}", {{"record": {{"file": "{file}", "digest": "{digest}"}}, "witnesses": [], "targets": []}}]"#))
        .collect();
    let document = format!(r#"{{"records": [{}], "parses": [], "deletedRecords": [], "deletedParses": []}}"#, records.join(", "));
    let reads: Vec<(String, Read)> = files
        .iter()
        .map(|(file, digest, source)| (crate::parse_store::key(digest, &way(file)), read_file(file, source, &Allocator::default(), true)))
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

#[test]
fn a_name_the_file_only_binds_spends_no_line_of_the_budget_and_is_counted() {
    let held: Vec<String> = (0..45).map(|at| format!("const {{ held{at} }} = primordials;\n")).collect();
    let source = format!("const path = require('path');\n{}let debug = 1;\nfunction run() {{}}\nclass Loader {{\n  load() {{}}\n}}\nmodule.exports = {{ run }};\n", held.concat());
    let (records, parses) = chain(&[("src/loader.js", "git:e", &source)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found = declarations_of(&layers, &["src/loader.js".to_owned()], 40).remove(0);
    assert_eq!(rows(&found), vec![
        "47 let debug Some(false)",
        "48 function run Some(true)",
        "49 class Loader Some(false)",
        "  50 load",
    ]);
    assert_eq!((found.more, found.more_members, found.bound), (0, 0, 46));
}

#[test]
fn a_bound_name_the_file_exports_keeps_its_row() {
    let source = "export const { width, height } = box;\nconst { depth } = box;\n";
    let (records, parses) = chain(&[("src/box.js", "git:f", source)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found = declarations_of(&layers, &["src/box.js".to_owned()], 40).remove(0);
    assert_eq!(rows(&found), vec!["1 binding width Some(true)", "1 binding height Some(true)"]);
    assert_eq!((found.more, found.bound), (0, 1));
}

#[test]
fn a_file_that_only_binds_names_declares_nothing_and_counts_them() {
    let (records, parses) = chain(&[("src/binds.js", "git:g", "const { a, b } = require('./c');\n")]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found = declarations_of(&layers, &["src/binds.js".to_owned()], 40).remove(0);
    assert!(found.read);
    assert_eq!((rows(&found), found.more, found.bound), (Vec::new(), 0, 2));
}

#[test]
fn a_file_the_index_kept_no_exports_of_says_so_when_every_name_it_has_is_only_bound() {
    let sources = [
        ("src/assigned.js", "git:j", "const { A } = require('./x');\nexports.A = A;\n"),
        ("src/spread.js", "git:k", "const { A } = require('./x');\nmodule.exports = { A, ...rest };\n"),
        ("src/kept.js", "git:l", "const { A } = require('./x');\nmodule.exports = { b: 1 };\n"),
    ];
    let (records, parses) = chain(&sources);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let files: Vec<String> = sources.iter().map(|(file, _, _)| (*file).to_owned()).collect();
    let found: Vec<(u32, bool)> = declarations_of(&layers, &files, 40).iter().map(|one| (one.bound, one.exports_kept)).collect();
    assert_eq!(found, vec![(1, false), (1, false), (1, true)]);
}

#[test]
fn a_name_the_file_binds_twice_is_counted_once() {
    let source = "var { a } = require('./x');\nvar { a } = require('./y');\nvar util = require('util');\nvar util = require('util');\n";
    let (records, parses) = chain(&[("src/twice.js", "git:m", source)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    assert_eq!(declarations_of(&layers, &["src/twice.js".to_owned()], 40).remove(0).bound, 2);
}

#[test]
fn a_member_written_in_a_bound_value_is_not_put_under_the_declaration_above_it() {
    let source = "class Box {\n  open() {}\n}\nconst { made } = make(class Box {\n  shut() {}\n});\n";
    let (records, parses) = chain(&[("src/made.js", "git:h", source)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found = declarations_of(&layers, &["src/made.js".to_owned()], 40).remove(0);
    let lines: Vec<String> = rows(&found).iter().map(|row| row.replace(" None", "").replace(" Some(false)", "")).collect();
    assert_eq!(lines, vec!["1 class Box", "  2 open"]);
    assert_eq!((found.more_members, found.bound), (0, 1));
}

#[test]
fn a_name_the_file_binds_and_declares_is_listed_at_the_declaration_and_not_counted() {
    let source = "const { Pool } = pg;\ntype Pool = number;\nconst { other } = pg;\nexport const run = 1;\n";
    let (records, parses) = chain(&[("src/pool.ts", "git:i", source)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found = declarations_of(&layers, &["src/pool.ts".to_owned()], 40).remove(0);
    assert_eq!(rows(&found), vec!["2 type Pool Some(false)", "4 const run Some(true)"]);
    assert_eq!(found.bound, 1);
    let cut = declarations_of(&layers, &["src/pool.ts".to_owned()], 0).remove(0);
    assert_eq!((cut.more, cut.bound), (2, 1), "a name whose declaration the budget cut is still declared");
}

const CART: &str = "export interface Cart {\n  total: number;\n  add(item: string): void;\n}\n\nexport const limit = {\n  items: 10,\n};\n\nexport class Basket {\n  lines = [];\n  total() {\n    return this.lines.length;\n  }\n}\n\nfunction first() {\n  const inner = () => {\n    return 1;\n  };\n}\n\nfunction second() {}\n";

/// What an asked line is in, outermost first, each as `kind name start-end`.
fn held(found: &LineHeld) -> String {
    if !found.read { return "not read".to_owned() }
    if found.holders.is_empty() { return "top level".to_owned() }
    let holders: Vec<String> = found.holders.iter().map(|holder| format!("{} {} {}-{}", holder.kind, holder.name, holder.line, holder.end)).collect();
    holders.join(" > ")
}

fn asked(file: &str, lines: &[u32]) -> Vec<AskedLine> {
    lines.iter().map(|line| AskedLine { file: file.to_owned(), line: *line }).collect()
}

#[test]
fn a_line_is_in_every_declaration_whose_lines_enclose_it_outermost_first_and_in_none_between_them() {
    let (records, parses) = chain(&[("src/cart.ts", "git:n", CART)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let mut lines = asked("src/cart.ts", &[2, 4, 7, 13, 16, 19, 22]);
    lines.extend(asked("src/gone.ts", &[1]));
    let found: Vec<String> = lines_held(&layers, &lines).iter().map(held).collect();
    assert_eq!(found, vec![
        "interface Cart 1-4 > property total 2-2",
        "interface Cart 1-4",
        "const limit 6-8",
        "class Basket 10-15 > method total 12-14",
        "top level",
        "function first 17-21 > const inner 18-20",
        "top level",
    ], "a file the chain does not hold is left out");
}

#[test]
fn a_line_of_a_tree_sitter_language_is_in_the_items_whose_lines_enclose_it() {
    let source = "pub fn total() -> u32 {\n    1\n}\n\n#[cfg(test)]\nmod tests {\n    fn fixture() {\n        let _ = 1;\n    }\n}\n";
    let (records, parses) = chain(&[("src/total.rs", "git:o", source)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found: Vec<String> = lines_held(&layers, &asked("src/total.rs", &[2, 4, 8])).iter().map(held).collect();
    assert_eq!(found, vec!["function total 1-3", "top level", "module tests 6-10 > function tests::fixture 7-9"]);
}

#[test]
fn names_one_statement_declares_on_the_same_lines_are_one_holder() {
    let source = "export const width = 1,\n  height = 2;\ninterface Box { a: string; b: string }\n";
    let (records, parses) = chain(&[("src/size.ts", "git:p", source)]);
    let layers = [Layer::open(&records).unwrap(), Layer::open(&parses).unwrap()];
    let found: Vec<String> = lines_held(&layers, &asked("src/size.ts", &[2, 3])).iter().map(held).collect();
    assert_eq!(found, vec!["const width, height 1-2", "interface Box 3-3 > property a, b 3-3"]);
}
