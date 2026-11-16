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
use crate::harvest::{Offsets, SourceSymbol, TextSpan};
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
pub fn declaration(children: &[Node], at: usize, name: String, kind: &'static str, source: &str, offsets: &Offsets, between: fn(Node) -> bool) -> SourceSymbol {
    let node = children[at];
    SourceSymbol {
        name,
        kind,
        line: line_of(node),
        signature: Some(head(node, source, offsets)),
        doc: doc_above(children, at, source, offsets, between),
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
pub fn head(node: Node, source: &str, offsets: &Offsets) -> TextSpan {
    let opens = node
        .child_by_field_name("body")
        .or_else(|| node.child_by_field_name("value"))
        .or_else(|| node.child_by_field_name("right"))
        .or_else(|| named_children(node).into_iter().find(|child| child.kind().ends_with("body") || child.kind() == "block"));
    let end = opens.map_or(node.end_byte(), |body| body.start_byte());
    let text = source.get(node.start_byte()..end).unwrap_or("");
    let kept = text.trim_end().trim_end_matches(['=', ':', '{']).trim_end();
    span_of(offsets, node.start_byte(), node.start_byte() + kept.len())
}

/// The doc comment written above `children[at]`, past the siblings the
/// language lets stand `between` a doc and its item: the `///` lines directly
/// before it, or the one `/** … */` block. A comment is told by what it is
/// written as, since each grammar names its comments differently. A block is spanned inside its `/*`
/// and `*/`, as the TypeScript reader spans a JSDoc block; lines are spanned
/// whole, from the first `///` to the end of the last.
pub fn doc_above(children: &[Node], at: usize, source: &str, offsets: &Offsets, between: fn(Node) -> bool) -> Option<TextSpan> {
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
            return Some(span_of(offsets, sibling.start_byte() + 2, sibling.end_byte() - 2));
        }
        break;
    }
    lines.map(|(start, end)| span_of(offsets, start, end))
}

/// Byte offsets of `source` as the UTF-16 span every reader writes.
pub fn span_of(offsets: &Offsets, start: usize, end: usize) -> TextSpan {
    offsets.span(oxc_span::Span::new(start as u32, end as u32))
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

    let offsets = Offsets::new(source);
    let (read, symbols) = match grammar {
        Grammar::Python => (python::read(file, source, &tree), python::declarations(&tree, source, &offsets)),
        Grammar::Rust => (rust::read(file, source, &tree), rust::declarations(&tree, source, &offsets)),
        Grammar::Swift => (swift::read(file, source, &tree), swift::declarations(&tree, source, &offsets)),
        Grammar::Java => (jvm::read(file, source, &tree, "java"), jvm::declarations(&tree, source, &offsets)),
        Grammar::Kotlin => (jvm::read(file, source, &tree, "kotlin"), jvm::declarations(&tree, source, &offsets)),
    };
    // FIXME: only Rust reads its own uses; Python, Swift and the JVM languages
    // answer `ask uses` with what other files import alone.
    let own_uses = match grammar {
        Grammar::Rust => rust_uses::own_uses(&tree, source),
        Grammar::Python | Grammar::Swift | Grammar::Java | Grammar::Kotlin => Vec::new(),
    };
    let lines = crate::read::Lines::new(source);
    let read = Read { size: Some(size::size_of(source, &tree, grammar)), symbols, harvested: true, own_uses, ..read };
    Some(read.texted(&crate::span_text::Source::new(source, lines.starts())))
}

/// The targets a `Package.swift` declares, or nothing when it does not parse.
pub fn swift_targets(source: &str) -> Option<Vec<swift::Target>> {
    let tree = grammar::parse(Grammar::Swift, source)?;
    Some(swift::targets(source, &tree))
}

#[cfg(test)]
#[path = "../rust_resolve_tests.rs"]
mod resolve_tests;

#[cfg(test)]
mod tests {
    use super::kind_of;

    #[test]
    fn every_grammar_keeps_declaration_text_and_utf16_offsets_after_unicode() {
        for (language, declaration, signature, doc) in [
            ("rust", "/// 文😀\nfn named() {}", "fn named()", "/// 文😀"),
            ("python", "def named():\n    \"\"\"文😀\"\"\"\n    pass", "def named()", "文😀"),
            ("java", "/** 文😀 */\nclass Named {}", "class Named", "* 文😀 "),
            ("kotlin", "/** 文😀 */\nclass Named {}", "class Named", "* 文😀 "),
            ("swift", "/** 文😀 */\nclass Named {}", "class Named", "* 文😀 "),
        ] {
            for unicode in [false, true] {
                let source = format!("{}\n{declaration}\n", if language == "python" { "# 😀 é" } else { "// 😀 é" });
                let source = if unicode { source } else { source.replace(['文', '😀', 'é'], "x") };
                let expected = |text: &str| if unicode { text.to_owned() } else { text.replace(['文', '😀', 'é'], "x") };
                let read = super::read(language, "source", &source).expect("the grammar is linked");
                let symbol = read.symbols.first().expect(language);
                for (span, text) in [(&symbol.signature, expected(signature)), (&symbol.doc, expected(doc))] {
                    let span = span.as_ref().expect(language);
                    let byte = source.find(&text).expect("the text is written");
                    assert_eq!(span.start, source[..byte].encode_utf16().count() as u32, "{language}");
                    assert_eq!(span.end, span.start + text.encode_utf16().count() as u32, "{language}");
                    assert_eq!(span.text.as_deref(), Some(text.as_str()), "{language}");
                }
            }
        }
    }

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
