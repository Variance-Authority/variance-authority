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
mod rust_paths;
pub mod rust_uses;
pub mod shape;
pub mod size;
pub mod swift;

use tree_sitter::Node;

use crate::grammar::{self, Grammar};
use crate::harvest::{SourceSymbol, TextSpan};
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

/// One top-level declaration, `children[at]`, as the TypeScript reader
/// records one: its name and kind, its line, its head and the doc above it.
pub fn declaration(children: &[Node], at: usize, name: String, kind: &'static str, source: &str, between: fn(Node) -> bool) -> SourceSymbol {
    let node = children[at];
    SourceSymbol {
        name,
        kind,
        line: line_of(node),
        signature: Some(head(node, source)),
        doc: doc_above(children, at, source, between),
        reach: None,
    }
}

/// What a declaration's node kind is called in a symbol, the same word across
/// the grammars that spell it differently; nothing for a node that holds a
/// name and declares nothing, such as Rust's `extern crate`, which a reader
/// then leaves out.
pub fn kind_of(node: &str) -> Option<&'static str> {
    Some(match node {
        "function_item" | "function_definition" | "function_declaration" => "function",
        "struct_item" => "struct",
        "enum_item" | "enum_declaration" => "enum",
        "union_item" => "union",
        "trait_item" => "trait",
        "type_item" | "type_alias" | "typealias_declaration" => "type",
        "const_item" => "const",
        "static_item" => "static",
        "mod_item" => "module",
        "macro_definition" => "macro",
        "class_definition" | "class_declaration" => "class",
        "interface_declaration" => "interface",
        "record_declaration" => "record",
        "annotation_type_declaration" => "annotation",
        "object_declaration" => "object",
        "protocol_declaration" => "protocol",
        "property_declaration" => "property",
        _ => return None,
    })
}

/// A declaration's head: from where it starts to where its body or its value
/// does, less the `=`, `:` or `{` that opens them; the whole node when it has
/// neither.
pub fn head(node: Node, source: &str) -> TextSpan {
    let opens = node
        .child_by_field_name("body")
        .or_else(|| node.child_by_field_name("value"))
        .or_else(|| node.child_by_field_name("right"))
        .or_else(|| named_children(node).into_iter().find(|child| child.kind().ends_with("body") || child.kind() == "block"));
    let end = opens.map_or(node.end_byte(), |body| body.start_byte());
    let text = source.get(node.start_byte()..end).unwrap_or("");
    let kept = text.trim_end().trim_end_matches(['=', ':', '{']).trim_end();
    span_of(source, node.start_byte(), node.start_byte() + kept.len())
}

/// The doc comment written above `children[at]`, past the siblings the
/// language lets stand `between` a doc and its item: the `///` lines directly
/// before it, or the one `/** … */` block. A comment is told by what it is
/// written as, since each grammar names its comments differently. A block is spanned inside its `/*`
/// and `*/`, as the TypeScript reader spans a JSDoc block; lines are spanned
/// whole, from the first `///` to the end of the last.
pub fn doc_above(children: &[Node], at: usize, source: &str, between: fn(Node) -> bool) -> Option<TextSpan> {
    let mut lines: Option<(usize, usize)> = None;
    for sibling in children[..at].iter().rev() {
        let text = text_of(*sibling, source);
        let comment = sibling.kind().contains("comment");
        if lines.is_none() && between(*sibling) {
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
    if source.is_ascii() {
        return TextSpan { start: start as u32, end: end as u32 };
    }
    TextSpan { start: units(start), end: units(end) }
}

/// A visibility modifier as written, with the whitespace taken out, so
/// `pub ( self )` reads as `pub(self)` and `private (set)` as `private(set)`.
pub fn visibility(modifier: Node, source: &str) -> String {
    text_of(modifier, source).chars().filter(|c| !c.is_whitespace()).collect()
}

/// Whether a Swift or Kotlin declaration's [`visibility`], in its `modifiers`,
/// is one of `keywords`: the ones that keep it to its file. `private(set)`
/// narrows a setter alone and is none of them.
pub fn file_private(node: Node, source: &str, keywords: &[&str]) -> bool {
    named_children(node)
        .into_iter()
        .filter(|child| child.kind() == "modifiers")
        .flat_map(named_children)
        .filter(|modifier| modifier.kind() == "visibility_modifier")
        .any(|modifier| keywords.contains(&visibility(modifier, source).as_str()))
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

    let (read, symbols) = match grammar {
        Grammar::Python => (python::read(file, source, &tree), python::declarations(&tree, source)),
        Grammar::Rust => (rust::read(file, source, &tree), rust::declarations(&tree, source)),
        Grammar::Swift => (swift::read(file, source, &tree), swift::declarations(&tree, source)),
        Grammar::Java => (jvm::read(file, source, &tree, "java"), jvm::declarations(&tree, source)),
        Grammar::Kotlin => (jvm::read(file, source, &tree, "kotlin"), jvm::declarations(&tree, source)),
    };
    // FIXME: only Rust reads its own uses; Python, Swift and the JVM languages
    // answer `ask uses` with what other files import alone.
    let own_uses = match grammar {
        Grammar::Rust => rust_uses::own_uses(&tree, source),
        Grammar::Python | Grammar::Swift | Grammar::Java | Grammar::Kotlin => Vec::new(),
    };
    Some(Read { size: Some(size::size_of(source, &tree, grammar)), symbols, harvested: true, own_uses, ..read })
}

/// The targets a `Package.swift` declares, or nothing when it does not parse.
pub fn swift_targets(source: &str) -> Option<Vec<swift::Target>> {
    let tree = grammar::parse(Grammar::Swift, source)?;
    Some(swift::targets(source, &tree))
}

#[cfg(test)]
mod tests {
    use super::kind_of;

    /// A node a reader admits as a declaration and `kind_of` has no word for
    /// would be left out of the symbols without a sound.
    #[test]
    fn every_node_a_reader_declares_has_a_kind() {
        let admitted = super::rust::ITEMS.iter()
            .chain(&["mod_item", "macro_definition"])
            .chain(super::swift::DECLARATIONS.iter())
            .chain(super::jvm::DECLARATIONS.iter())
            .chain(&["function_definition", "class_definition"]);
        for node in admitted {
            assert!(kind_of(node).is_some(), "{node} has no kind");
        }
    }
}
