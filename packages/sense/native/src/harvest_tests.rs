//! Whose a `/**` is: the declaration it sits on, or the file it opens.

use oxc_allocator::Allocator;

use crate::read::read_module;

/// The doc text of the module, and of the declaration `name`.
fn docs(source: &str, name: &str) -> (Option<String>, Option<String>) {
    let read = read_module("a.ts", source, &Allocator::default(), true);
    let text = |start: u32, end: u32| source[start as usize..end as usize].trim_start_matches('*').trim().to_owned();
    let symbol = read.symbols.iter().find(|symbol| symbol.name == name).expect("the name is declared");
    (read.doc.map(|doc| text(doc.start, doc.end)), symbol.doc.as_ref().map(|doc| text(doc.start, doc.end)))
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

/// The kind `name`'s top-level declaration is harvested under.
fn kind(path: &str, source: &str, name: &str) -> &'static str {
    let read = read_module(path, source, &Allocator::default(), true);
    read.symbols.iter().find(|symbol| symbol.name == name).expect("the name is declared").kind
}

#[test]
fn a_destructured_binding_is_a_binding_and_a_declarator_its_own_kind() {
    let source = "const { ChildProcess } = make();\nconst [first] = list;\nconst whole = make();\nfunction fork() {}\n";
    assert_eq!(kind("a.js", source, "ChildProcess"), "binding");
    assert_eq!(kind("a.js", source, "first"), "binding");
    assert_eq!(kind("a.js", source, "whole"), "const");
    assert_eq!(kind("a.js", source, "fork"), "function");
}

#[test]
fn a_published_binding_taken_off_a_module_is_a_binding() {
    let source = "'use strict';\nconst { ChildProcess } = require('internal/child_process');\nmodule.exports = { ChildProcess };\n";
    assert_eq!(kind("lib/child_process.js", source, "ChildProcess"), "binding");
}

/// A JavaScript file's read as a parse store hands it back keeps every
/// top-level kind it was harvested with, `binding` among them.
#[test]
fn a_kept_parse_reads_back_every_javascript_kind_it_was_harvested_with() {
    let source = "const { ChildProcess } = require('./internal');\nlet count = 0;\nvar total = 1;\nawait using handle = open();\nfunction fork() {}\nmodule.exports = { ChildProcess, count, total, handle, fork };\n";
    let fresh = crate::read_any::read_file("lib/child.js", source, &oxc_allocator::Allocator::default(), true);
    let bytes = crate::index::parses_only(&[("git:a", &fresh)]);
    let layer = crate::compact::Layer::open(&bytes).unwrap();
    let held = crate::compact::ParseView::of(&layer, 0).read().unwrap();
    let named = |read: &crate::read::Read| read.symbols.iter().map(|symbol| (symbol.name.clone(), symbol.kind)).collect::<Vec<_>>();
    assert!(fresh.harvested);
    assert_eq!((held.harvested, named(&held)), (fresh.harvested, named(&fresh)));
}
