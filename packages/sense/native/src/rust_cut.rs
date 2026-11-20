//! The regions of a Rust file: the file, and each function in it.
//!
//! A Rust test's counters are rustc's (`-C instrument-coverage`), not probes,
//! so the cut places nothing: `code` is the source as it is. What it gives is
//! the regions a counter is charged to, with the digests a carried record
//! compares, in the same shape the JavaScript walk gives them, so a recording,
//! a carry and a selection read a `.rs` file as they read a module. A closure
//! is its function's: rustc counts it apart, and the innermost function around
//! it is the region an edit to it changes.

use tree_sitter::Node;
use variance_sense_instrument::digest;
use variance_sense_instrument::native::{own_digests, Block, Cut, Kind, Utf16};

use crate::grammar::{parse, Grammar};
use crate::languages::text_of;

/// The cut of one Rust file, or nothing when it does not parse.
pub fn cut(source: &str) -> Option<Cut> {
    let tree = parse(Grammar::Rust, source)?;
    let root = tree.root_node();
    if root.has_error() {
        return None;
    }
    let mut blocks =
        vec![Block { kind: Kind::Module, owner: None, name: String::new(), path: "module".into(), start: 0, end: source.len() as u32 }];
    items(root, source, 0, "", &mut blocks);
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
/// it, named by the `mod`, `impl`, `trait` and function scopes it is in. A
/// `const fn` is no block of its own: a `const` runs it as the crate compiles,
/// where no counter sees it, so it is code of its owner, whose consumers are
/// every test the file was compiled for.
fn items(node: Node, source: &str, owner: u32, scope: &str, blocks: &mut Vec<Block>) {
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        if child.kind() == "function_item" && is_const(child, source) {
            continue;
        }
        let own = match child.kind() {
            "function_item" | "mod_item" | "trait_item" => {
                child.child_by_field_name("name").map(|name| text_of(name, source).to_owned())
            }
            "impl_item" => impl_name(child, source),
            _ => None,
        };
        let Some(own) = own else {
            items(child, source, owner, scope, blocks);
            continue;
        };
        let name = if scope.is_empty() { own } else { format!("{scope}/{own}") };
        if child.kind() != "function_item" {
            items(child, source, owner, &name, blocks);
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
        items(child, source, ordinal, &name, blocks);
    }
}

fn is_const(function: Node, source: &str) -> bool {
    let mut cursor = function.walk();
    let constant = function
        .children(&mut cursor)
        .any(|child| child.kind() == "function_modifiers" && text_of(child, source).split_whitespace().any(|word| word == "const"));
    constant
}

/// `Type` for an inherent `impl`, `<Type as Trait>` for a trait's, as Rust
/// writes the path of a function in it.
fn impl_name(node: Node, source: &str) -> Option<String> {
    let spelled = |field| {
        node.child_by_field_name(field)
            .map(|it| text_of(it, source).split_whitespace().collect::<Vec<_>>().join(" "))
    };
    let ty = spelled("type")?;
    Some(match spelled("trait") {
        Some(by) => format!("<{ty} as {by}>"),
        None => ty,
    })
}

#[cfg(test)]
#[path = "rust_cut_tests.rs"]
mod tests;
