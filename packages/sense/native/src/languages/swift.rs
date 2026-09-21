//! What a Swift file asks for and what it publishes.
//!
//! The argument for the shape is [`swift.ts`](../../../src/swift.ts), which this
//! is a port of and is measured against: `import Core` names a **target**, so an
//! import becomes an edge to every file in it and a file's own target becomes
//! edges to every file beside it. Resolution — the manifest, the target index,
//! the projection onto paths — stays in TypeScript, because it reads a tree and
//! not a file. What is here is the reader.

use std::collections::HashSet;

use tree_sitter::{Node, Tree};

use super::shape::{Binding, Export, Kind, Read, Request};
use super::{line_of, named_children, text_of};

/// The request a file makes for its own target: the files it sees without asking.
const OWN_TARGET: &str = "*";

pub fn read(file: &str, source: &str, tree: &Tree) -> Read {
    let root = tree.root_node();
    let mut requests: Vec<Request> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut exports: Vec<Export> = Vec::new();

    // The files beside this one, which it sees with no statement of any kind.
    want(&mut requests, &mut seen, OWN_TARGET, OWN_TARGET, 1);

    for child in named_children(root) {
        let line = line_of(child);
        if child.kind() == "import_declaration" {
            // `import struct Answer.Lens` names the module `Answer`; the rest of
            // the path is a symbol inside it, and there is no file grain below it.
            if let Some(module) = imported(child, source) {
                want(&mut requests, &mut seen, &module, &module, line);
            }
            continue;
        }
        if let Some(name) = declared(child, source) {
            exports.push(Export {
                exported: Some(name.clone()),
                local: Some(name),
                type_only: false,
                line,
                ..Export::default()
            });
        }
    }

    Read {
        requests,
        exports: if exports.is_empty() { None } else { Some(exports) },
        unknown: root.has_error().then(|| {
            format!("{file} did not parse cleanly as Swift, so what it imports may be incomplete.")
        }),
    }
}

fn imported(node: Node, source: &str) -> Option<String> {
    let name = named_children(node)
        .into_iter()
        .find(|part| part.kind() == "identifier")?;
    match named_children(name).first() {
        Some(first) => Some(text_of(*first, source).to_string()),
        None => Some(
            text_of(name, source)
                .split('.')
                .next()
                .unwrap_or("")
                .to_string(),
        ),
    }
}

fn want(requests: &mut Vec<Request>, seen: &mut HashSet<String>, value: &str, local: &str, line: u32) {
    if value.is_empty() || !seen.insert(value.to_string()) {
        return;
    }
    requests.push(Request {
        value: value.to_string(),
        kind: Kind::Imports,
        bindings: vec![Binding {
            imported: local.to_string(),
            local: local.to_string(),
            type_only: false,
            line,
        }],
        line,
        // Always. A module name is not a path, `Foundation` and `Core` are
        // written identically, and the target a name belongs to is a fact about
        // the tree.
        guessed: true,
    });
}

/// Top-level declarations this file publishes.
///
/// `class_declaration` is every nominal type in this grammar — `struct`, `class`,
/// `enum` and `actor` all reach it — and the keyword that separates them is an
/// anonymous node. Nothing here needs to tell them apart.
const DECLARATIONS: [&str; 5] = [
    "class_declaration",
    "protocol_declaration",
    "typealias_declaration",
    "function_declaration",
    "property_declaration",
];

fn declared(node: Node, source: &str) -> Option<String> {
    if !DECLARATIONS.contains(&node.kind()) {
        return None;
    }
    let children = named_children(node);
    let named = |nodes: &[Node]| -> Option<String> {
        nodes
            .iter()
            .find(|child| child.kind() == "type_identifier" || child.kind() == "simple_identifier")
            .map(|child| text_of(*child, source).to_string())
    };
    if let Some(name) = named(&children) {
        return Some(name);
    }
    // `let value = 1` binds through a pattern rather than naming itself.
    let pattern = children.iter().find(|child| child.kind() == "pattern")?;
    named_children(*pattern)
        .into_iter()
        .find(|child| child.kind() == "simple_identifier")
        .map(|child| text_of(child, source).to_string())
}
