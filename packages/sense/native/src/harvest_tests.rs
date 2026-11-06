//! Whose a `/**` is: the declaration it sits on, or the file it opens.

use oxc_allocator::Allocator;

use crate::read::read_module;

/// The doc text of the module, and of the declaration `name`.
fn docs(source: &str, name: &str) -> (Option<String>, Option<String>) {
    let read = read_module("a.ts", source, &Allocator::default(), true);
    let text = |start: u32, end: u32| source[start as usize..end as usize].trim_start_matches('*').trim().to_owned();
    let symbol = read.symbols.iter().find(|symbol| symbol.name == name).expect("the name is declared");
    (read.doc.map(|doc| text(doc.start, doc.end)), symbol.doc.map(|doc| text(doc.start, doc.end)))
}

#[test]
fn a_doc_a_blank_line_parts_from_the_first_statement_is_the_files() {
    let (file, declared) = docs("/** The banner. */\n\nconst MAC = 1;\n", "MAC");
    assert_eq!(file.as_deref(), Some("The banner."));
    assert_eq!(declared, None);
}

#[test]
fn a_doc_parted_from_the_first_statement_under_a_directive_is_the_files() {
    let (file, declared) = docs("'use strict';\n\n/** The banner. */\n\nconst MAC = 1;\n", "MAC");
    assert_eq!(file.as_deref(), Some("The banner."));
    assert_eq!(declared, None);
}

#[test]
fn a_doc_on_the_first_statement_is_that_statements() {
    let (file, declared) = docs("/** The constant. */\nconst MAC = 1;\n", "MAC");
    assert_eq!(file, None);
    assert_eq!(declared.as_deref(), Some("The constant."));
}

#[test]
fn a_banner_keeps_the_doc_of_the_statement_under_it() {
    let (file, declared) = docs("/** The banner. */\n\n/** The constant. */\nconst MAC = 1;\n", "MAC");
    assert_eq!(file.as_deref(), Some("The banner."));
    assert_eq!(declared.as_deref(), Some("The constant."));
}

#[test]
fn a_doc_parted_from_a_later_statement_stays_that_statements() {
    let (file, declared) = docs("const a = 1;\n\n/** A section. */\n\nconst MAC = 1;\n", "MAC");
    assert_eq!(file, None);
    assert_eq!(declared.as_deref(), Some("A section."));
}

#[test]
fn a_role_tag_on_a_banner_is_not_the_first_statements() {
    let tags = |source: &str| read_module("a.ts", source, &Allocator::default(), true).exports[0].tags;
    assert_eq!(tags("/** @testOnly */\n\nexport const MAC = 1;\n"), 0);
    assert_ne!(tags("/** @testOnly */\nexport const MAC = 1;\n"), 0);
}

#[test]
fn a_blank_line_written_with_carriage_returns_parts_a_doc_too() {
    let (file, declared) = docs("/** The banner. */\r\n\r\nconst MAC = 1;\r\n", "MAC");
    assert_eq!(file.as_deref(), Some("The banner."));
    assert_eq!(declared, None);
}
