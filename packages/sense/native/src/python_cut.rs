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
use variance_sense_instrument::native::{Block, Cut, Kind};

use crate::grammar::Grammar;
use crate::languages::{cut_with, text_of};

/// The cut of one Python file, or nothing when it does not parse.
pub fn cut(source: &str) -> Option<Cut> {
    cut_with(Grammar::Python, source, |root, source, blocks| scope(root, source, 0, "", blocks))
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

#[cfg(test)]
#[path = "python_cut_tests.rs"]
mod tests;
