//! One reader per language, each answering the shape [`shape.rs`](./shape.rs) holds.
//!
//! These are the only readers for these five languages. The grammars are linked
//! into this binary rather than loaded from disk, so a grammar cannot be absent:
//! if this addon loaded, every language it claims can be parsed.
//!
//! What can be absent is this module. The grammars are the `grammars` feature,
//! on by default and dropped by `build.mjs` when they are what failed to
//! compile; a build without them claims no language at all, and
//! [`record.ts`](../../../src/record.ts) records every file in these five as
//! *unknown* rather than *edgeless* — a repository whose Python nobody parsed
//! must not read as a repository with no Python in it.

pub mod jvm;
pub mod python;
pub mod rust;
pub mod shape;
pub mod size;
pub mod swift;

use tree_sitter::Node;

use crate::grammar::{self, Grammar};
use crate::harvest::TextSpan;
use shape::Read;

/// The 1-based line a node starts on.
pub fn line_of(node: Node) -> u32 {
    node.start_position().row as u32 + 1
}

/// The source a node covers. Empty for a range no `&str` can be cut at, which
/// tree-sitter does not produce over valid UTF-8 and which must not panic if it does.
pub fn text_of<'source>(node: Node, source: &'source str) -> &'source str {
    source.get(node.byte_range()).unwrap_or("")
}

/// The doc comment written above `children[at]`, past the siblings of the
/// kinds in `attributes`: the `///` lines directly before it, or the one
/// `/** … */` block. A comment is told by what it is written as, since each
/// grammar names its comments differently. A block is spanned inside its `/*`
/// and `*/`, as the TypeScript reader spans a JSDoc block; lines are spanned
/// whole, from the first `///` to the end of the last.
pub fn doc_above(children: &[Node], at: usize, source: &str, attributes: &[&str]) -> Option<TextSpan> {
    let mut lines: Option<(usize, usize)> = None;
    for sibling in children[..at].iter().rev() {
        let text = text_of(*sibling, source);
        let comment = sibling.kind().contains("comment");
        if lines.is_none() && attributes.contains(&sibling.kind()) {
            continue;
        }
        if comment && text.starts_with("///") && !text.starts_with("////") {
            let end = sibling.start_byte() + text.trim_end().len();
            lines = Some((sibling.start_byte(), lines.map_or(end, |(_, end)| end)));
            continue;
        }
        if comment && lines.is_none() && text.starts_with("/**") && !text.starts_with("/***") && text.len() > 4 {
            return Some(span_of(source, sibling.start_byte() + 2, sibling.end_byte() - 2));
        }
        break;
    }
    lines.map(|(start, end)| span_of(source, start, end))
}

/// Byte offsets of `source` as the UTF-16 span every reader writes.
pub fn span_of(source: &str, start: usize, end: usize) -> TextSpan {
    let units = |byte: usize| source.get(..byte).map_or(0, |before| before.encode_utf16().count()) as u32;
    TextSpan { start: units(start), end: units(end) }
}

/// Every named child of a node, in order.
pub fn named_children(node: Node) -> Vec<Node> {
    let mut cursor = node.walk();
    node.named_children(&mut cursor).collect()
}

/// Every child of a node under one field name, in order.
pub fn children_for_field<'tree>(node: Node<'tree>, field: &str) -> Vec<Node<'tree>> {
    let mut cursor = node.walk();
    node.children_by_field_name(field, &mut cursor).collect()
}

/// Read one file in the language named, or nothing when no reader here claims it.
pub fn read(language: &str, file: &str, source: &str) -> Option<Read> {
    let grammar = Grammar::of(language)?;
    let Some(tree) = grammar::parse(grammar, source) else {
        // Worded per language, because this string is the whole answer for a
        // file nothing could read.
        return Some(Read::unreadable(match grammar {
            Grammar::Python => format!("{file} could not be parsed."),
            Grammar::Rust => format!("{file} could not be parsed as Rust."),
            Grammar::Swift => format!("{file} could not be parsed as Swift."),
            Grammar::Java => format!("{file} could not be parsed as java."),
            Grammar::Kotlin => format!("{file} could not be parsed as kotlin."),
        }));
    };

    let read = match grammar {
        Grammar::Python => python::read(file, source, &tree),
        Grammar::Rust => rust::read(file, source, &tree),
        Grammar::Swift => swift::read(file, source, &tree),
        Grammar::Java => jvm::read(file, source, &tree, "java"),
        Grammar::Kotlin => jvm::read(file, source, &tree, "kotlin"),
    };
    Some(Read { size: Some(size::size_of(source, &tree, grammar)), ..read })
}

/// The targets a `Package.swift` declares, or nothing when it does not parse.
pub fn swift_targets(source: &str) -> Option<Vec<swift::Target>> {
    let tree = grammar::parse(Grammar::Swift, source)?;
    Some(swift::targets(source, &tree))
}
