//! One reader per language, each answering the shape [`shape.rs`](./shape.rs) holds.
//!
//! The grammars are linked into this binary rather than loaded from disk, which
//! is the one behavioural difference from the JavaScript readers they replace:
//! there, a grammar is an optional npm package and an absent one makes a whole
//! language unreadable ([`grammar.ts`](../../src/grammar.ts) argues why that has
//! to be *unknown* rather than *edgeless*). Here the grammar cannot be absent —
//! if this addon loaded, every language it claims can be parsed.

pub mod jvm;
pub mod python;
pub mod rust;
pub mod shape;
pub mod swift;

use tree_sitter::Node;

use crate::grammar::{self, Grammar};
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
        // file nothing could read and the JavaScript readers word it per language.
        return Some(Read::unreadable(match grammar {
            Grammar::Python => format!("{file} could not be parsed."),
            Grammar::Rust => format!("{file} could not be parsed as Rust."),
            Grammar::Swift => format!("{file} could not be parsed as Swift."),
            Grammar::Java => format!("{file} could not be parsed as java."),
            Grammar::Kotlin => format!("{file} could not be parsed as kotlin."),
        }));
    };

    Some(match grammar {
        Grammar::Python => python::read(file, source, &tree),
        Grammar::Rust => rust::read(file, source, &tree),
        Grammar::Swift => swift::read(file, source, &tree),
        Grammar::Java => jvm::read(file, source, &tree, "java"),
        Grammar::Kotlin => jvm::read(file, source, &tree, "kotlin"),
    })
}
