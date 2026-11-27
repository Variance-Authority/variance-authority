//! The regions of a Python file: the file, and each function in it.
//!
//! A Python test's lines are CPython's (`sys.monitoring`), not probes, so the
//! cut places nothing: `code` is the source as it is. What it gives is the
//! regions a line is charged to, with the digests a carried record compares, in
//! the same shape the JavaScript walk gives them. A method is named by the
//! classes around it; a class body, a decorator, a default argument and a
//! lambda run where they are written, so they are code of the innermost
//! function around them, or of the module body, which runs at import.

use tree_sitter::Node;
use variance_sense_instrument::digest;
use variance_sense_instrument::native::{own_digests, Block, Cut, Kind, Utf16};

use crate::grammar::{parse, Grammar};
use crate::languages::text_of;

/// The cut of one Python file, or nothing when it does not parse.
pub fn cut(source: &str) -> Option<Cut> {
    let tree = parse(Grammar::Python, source)?;
    let root = tree.root_node();
    if root.has_error() {
        return None;
    }
    let mut blocks =
        vec![Block { kind: Kind::Module, owner: None, name: String::new(), path: "module".into(), start: 0, end: source.len() as u32 }];
    scope(root, source, 0, "", &mut blocks);
    let digests = own_digests(source, &blocks);
    if !source.is_ascii() {
        let table = Utf16::new(source);
        for block in &mut blocks {
            block.start = table.at(block.start);
            block.end = table.at(block.end);
        }
    }
    Some(Cut {
        code: source.to_owned(),
        header_at: 0,
        header_byte: 0,
        source_digest: digest::of_string(source),
        blocks,
        digests,
        module: false,
    })
}

/// Every function under `node`, each owned by the innermost function around
/// it, named by the class and function scopes it is in.
fn scope(node: Node, source: &str, owner: u32, scope_name: &str, blocks: &mut Vec<Block>) {
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        let own = match child.kind() {
            "function_definition" | "class_definition" => child.child_by_field_name("name").map(|name| text_of(name, source).to_owned()),
            _ => None,
        };
        let Some(own) = own else {
            scope(child, source, owner, scope_name, blocks);
            continue;
        };
        let name = if scope_name.is_empty() { own } else { format!("{scope_name}/{own}") };
        if child.kind() == "class_definition" {
            scope(child, source, owner, &name, blocks);
            continue;
        }
        let ordinal = blocks.len() as u32;
        blocks.push(Block {
            kind: Kind::Function,
            owner: Some(owner),
            name: name.clone(),
            path: "entry".into(),
            start: child.start_byte() as u32,
            end: child.end_byte() as u32,
        });
        scope(child, source, ordinal, &name, blocks);
    }
}

/// Where each line of a file starts, to charge a 1-based line to a block.
pub struct Lines {
    source: String,
    starts: Vec<usize>,
    utf16: Option<Utf16>,
}

impl Lines {
    pub fn new(source: String) -> Self {
        let starts = std::iter::once(0).chain(source.match_indices('\n').map(|(at, _)| at + 1)).collect();
        let utf16 = (!source.is_ascii()).then(|| Utf16::new(&source));
        Lines { source, starts, utf16 }
    }

    /// The innermost block around the first statement of a 1-based line; none for a line the file has not.
    pub fn charged(&self, cut: &Cut, line: usize) -> Option<u32> {
        let start = *self.starts.get(line.checked_sub(1)?)?;
        let indent = self.source[start..].bytes().take_while(|byte| *byte == b' ' || *byte == b'\t').count();
        let byte = (start + indent) as u32;
        let at = self.utf16.as_ref().map_or(byte, |table| table.at(byte));
        // Blocks are in pre-order, so the last one around a point is the innermost.
        cut.blocks.iter().rposition(|block| block.start <= at && at < block.end).map(|ordinal| ordinal as u32)
    }
}

#[cfg(test)]
#[path = "python_cut_tests.rs"]
mod tests;
