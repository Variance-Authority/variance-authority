//! One reader per language, each answering the shape [`shape.rs`](./shape.rs) holds.
//!
//! These are the only readers for these five languages. The grammars are linked
//! into this binary rather than loaded from disk, so a grammar cannot be absent:
//! if this addon loaded, every language it claims can be parsed.
//!
//! What can be absent is this module. The grammars are the `grammars` feature,
//! on by default and dropped by `build.mjs` when they are what failed to
//! compile; a build without them claims no language at all, and
//! [`read_any.rs`](../read_any.rs) records every file in these five as
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

use tree_sitter::{Node, TreeCursor};

use crate::grammar::{self, Grammar};
use crate::harvest::{Offsets, SourceSymbol, TextSpan};
use shape::Read;

/// The 1-based line a node starts on.
pub fn line_of(node: Node) -> u32 {
    node.start_position().row as u32 + 1
}

/// The 1-based line a node ends on: the line of its last character, so a node
/// whose span takes the line break after it still ends on the line it closes.
pub fn end_line_of(node: Node) -> u32 {
    let end = node.end_position();
    if end.column == 0 && end.row > node.start_position().row { end.row as u32 } else { end.row as u32 + 1 }
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
        end_line: end_line_of(node),
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
    crate::harvest::KINDS.iter().find(|(_, nodes)| nodes.contains(&node)).map(|(kind, _)| *kind)
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
    span_of(node.start_byte(), node.start_byte() + kept.len())
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
            return Some(span_of(sibling.start_byte() + 2, sibling.end_byte() - 2));
        }
        break;
    }
    lines.map(|(start, end)| span_of(start, end))
}

/// The bytes `start..end` as a span. A reader spans in bytes, which a node
/// gives without counting; [`read`] converts them through
/// [`Offsets`](crate::harvest::Offsets) once the read is whole.
pub fn span_of(start: usize, end: usize) -> TextSpan {
    TextSpan { start: start as u32, end: end as u32, text: None }
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

/// Every named child of a node, in order, walked by [`Children`].
pub fn named_children(node: Node) -> Vec<Node> {
    Children::of(node, &mut Vec::new()).map(|(child, _)| child).filter(Node::is_named).collect()
}

/// Every node under `node`, itself first, in pre-order, walked by one cursor.
/// `enter` reads each node and says whether to walk the nodes under it. The
/// cursor is rooted at `node`, so its walk ends there: neither a sibling nor a
/// parent of `node` is visited.
pub fn preorder<'tree>(node: Node<'tree>, mut enter: impl FnMut(Node<'tree>) -> bool) {
    let mut cursor = node.walk();
    loop {
        if enter(cursor.node()) && cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                return;
            }
        }
    }
}

/// A Rust node's kind, read from the grammar's table ([`Grammar::kinds`]).
pub trait RustKind<'tree> {
    fn rust_kind(&self) -> &'tree str;
}

impl<'tree> RustKind<'tree> for Node<'tree> {
    fn rust_kind(&self) -> &'tree str {
        Grammar::Rust.kinds().of(*self)
    }
}

/// A node's children in order, each with the field it sits in, walked by one
/// cursor. A walk that collected every node's children into a `Vec` made an
/// allocation per node it visited; [`Children::done`] hands the cursor back
/// to `spare`, and the next node's children are walked by it.
pub struct Children<'tree> {
    cursor: TreeCursor<'tree>,
    started: bool,
}

impl<'tree> Children<'tree> {
    /// The children of `node`, walked by a cursor from `spare` when it holds one.
    pub fn of(node: Node<'tree>, spare: &mut Vec<TreeCursor<'tree>>) -> Self {
        let cursor = match spare.pop() {
            Some(mut cursor) => {
                cursor.reset(node);
                cursor
            }
            None => node.walk(),
        };
        Children { cursor, started: false }
    }

    pub fn done(self, spare: &mut Vec<TreeCursor<'tree>>) {
        spare.push(self.cursor);
    }
}

impl<'tree> Iterator for Children<'tree> {
    type Item = (Node<'tree>, Option<&'tree str>);

    fn next(&mut self) -> Option<Self::Item> {
        let moved = if self.started {
            self.cursor.goto_next_sibling()
        } else {
            self.started = true;
            self.cursor.goto_first_child()
        };
        moved.then(|| (self.cursor.node(), self.cursor.field_name()))
    }
}

/// Every child of a node under one field name, in order.
pub fn children_for_field<'tree>(node: Node<'tree>, field: &str) -> Vec<Node<'tree>> {
    let mut cursor = node.walk();
    node.children_by_field_name(field, &mut cursor).collect()
}

/// Read one file's bytes in the language named, or nothing when no reader here
/// claims it. It is not told the file's path: a read is stored by its bytes and
/// shared by every file holding them, so what it says names none of them, and
/// the record prefixes its own (`built` in `record.rs`).
pub fn read(language: &str, source: &str) -> Option<Read> {
    let grammar = Grammar::of(language)?;
    let Some(tree) = grammar::parse(grammar, source) else {
        // Worded per language, because this string is the whole answer for a
        // file nothing could read.
        return Some(Read::unreadable(match grammar {
            Grammar::Python => "could not be parsed.",
            Grammar::Rust => "could not be parsed as Rust.",
            Grammar::Swift => "could not be parsed as Swift.",
            Grammar::Java => "could not be parsed as java.",
            Grammar::Kotlin => "could not be parsed as kotlin.",
        }.to_owned()));
    };

    let (read, mut symbols) = match grammar {
        Grammar::Python => (python::read(source, &tree), python::declarations(&tree, source)),
        Grammar::Rust => (rust::read(source, &tree), rust::declarations(&tree, source)),
        Grammar::Swift => (swift::read(source, &tree), swift::declarations(&tree, source)),
        Grammar::Java => (jvm::read(source, &tree, "java"), jvm::declarations(&tree, source)),
        Grammar::Kotlin => (jvm::read(source, &tree, "kotlin"), jvm::declarations(&tree, source)),
    };
    let offsets = Offsets::new(source);
    for span in symbols.iter_mut().flat_map(|symbol| [symbol.signature.as_mut(), symbol.doc.as_mut()]).flatten() {
        span.start = offsets.at(span.start);
        span.end = offsets.at(span.end);
    }
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

    /// `swift.test.ts`: reads the targets a manifest declares, defaults and all.
    #[test]
    fn reads_the_targets_a_manifest_declares_defaults_and_all() {
        let manifest = "let package = Package(name: \"Shadow\", targets: [\n  .target(name: \"Core\", path: \"Sources/core\"),\n  .testTarget(name: \"CoreTests\", dependencies: [\"Core\"]),\n  .executableTarget(name: \"Tool\"),\n])";
        let targets: Vec<(String, String)> =
            super::swift_targets(manifest).unwrap().into_iter().map(|target| (target.name, target.path)).collect();
        let expected = [("Core", "Sources/core"), ("CoreTests", "Tests/CoreTests"), ("Tool", "Sources/Tool")];
        assert_eq!(targets, expected.map(|(name, path)| (name.to_owned(), path.to_owned())));
    }
}
