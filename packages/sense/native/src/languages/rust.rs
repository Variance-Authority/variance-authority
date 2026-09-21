//! What a Rust file asks for and what it publishes.
//!
//! [`rust.ts`](../../../src/rust.ts) is the oracle this is measured against and
//! carries the argument: a `mod` declaration names a file and can be a hole, a
//! `use` path names an item whose module prefix is a fact about the disk, so
//! every `use` is guessed and a written `mod` beats it. Resolution stays in
//! TypeScript.

use std::collections::HashMap;

use tree_sitter::{Node, Tree};

use super::shape::{Binding, Export, Kind, Read, Request};
use super::{line_of, named_children, text_of};

struct Gathering {
    requests: Vec<Request>,
    exports: Vec<Export>,
    at: HashMap<String, usize>,
    broken: bool,
}

pub fn read(file: &str, source: &str, tree: &Tree) -> Read {
    let root = tree.root_node();
    let mut held = Gathering {
        requests: Vec::new(),
        exports: Vec::new(),
        at: HashMap::new(),
        broken: false,
    };

    block(root, source, &[], true, &mut held);

    Read {
        requests: held.requests,
        exports: if held.exports.is_empty() {
            None
        } else {
            Some(held.exports)
        },
        unknown: held.broken.then(|| {
            format!("{file} did not parse cleanly as Rust, so what it imports may be incomplete.")
        }),
    }
}

/// `prefix` is the inline-module path this block sits inside. `mod b;` inside
/// `mod a { … }` is the file `a/b.rs`, so the nesting has to be carried down.
fn block(node: Node, source: &str, prefix: &[String], top: bool, held: &mut Gathering) {
    let children = named_children(node);
    for (at, child) in children.iter().enumerate() {
        if child.kind() == "ERROR" || child.is_missing() {
            held.broken = true;
        }
        match child.kind() {
            "mod_item" => {
                let Some(name) = child
                    .child_by_field_name("name")
                    .map(|name| text_of(name, source).to_string())
                else {
                    continue;
                };
                let body = child.child_by_field_name("body");
                let line = line_of(*child);

                match body {
                    None => {
                        // A declaration. `#[path = "…"]` on the statement above
                        // replaces the name with a filename; it is a preceding
                        // sibling, not a child.
                        let spelled = at
                            .checked_sub(1)
                            .and_then(|before| path_attribute(children[before], source));
                        let value = spelled.unwrap_or_else(|| {
                            let mut path = vec!["self".to_string()];
                            path.extend_from_slice(prefix);
                            path.push(name.clone());
                            path.join("::")
                        });
                        want(
                            held,
                            Request {
                                value,
                                kind: Kind::Imports,
                                bindings: vec![Binding {
                                    imported: name.clone(),
                                    local: name.clone(),
                                    type_only: false,
                                    line,
                                }],
                                line,
                                guessed: false,
                            },
                        );
                    }
                    Some(body) => {
                        let mut inner = prefix.to_vec();
                        inner.push(name.clone());
                        block(body, source, &inner, false, held);
                    }
                }

                if top && published(*child) {
                    held.exports.push(Export {
                        exported: Some(name.clone()),
                        local: Some(name),
                        type_only: false,
                        line,
                        ..Export::default()
                    });
                }
            }

            "use_declaration" => {
                let Some(argument) = child.child_by_field_name("argument") else {
                    continue;
                };
                let line = line_of(*child);
                let shared = published(*child);
                for (path, local) in used(argument, source, &[]) {
                    let value = path.join("::");
                    let last = path.last().cloned().unwrap_or_else(|| value.clone());
                    let local = local.unwrap_or_else(|| last.clone());
                    want(
                        held,
                        Request {
                            value: value.clone(),
                            kind: Kind::Imports,
                            bindings: vec![Binding {
                                imported: last.clone(),
                                local: local.clone(),
                                type_only: false,
                                line,
                            }],
                            line,
                            // Always. See the module doc: which prefix of a
                            // `use` is a module is a fact about the disk, not
                            // about the statement.
                            guessed: true,
                        },
                    );
                    // `pub use` is a re-export, and is the only thing in Rust
                    // that republishes a name this file did not declare.
                    if shared {
                        held.exports.push(Export {
                            exported: Some(local),
                            from: Some(value),
                            imported: Some(last),
                            type_only: false,
                            line,
                            ..Export::default()
                        });
                    }
                }
            }

            _ => {
                if !top {
                    continue;
                }
                if let Some(name) = named(*child, source) {
                    if published(*child) {
                        held.exports.push(Export {
                            exported: Some(name.clone()),
                            local: Some(name),
                            type_only: false,
                            line: line_of(*child),
                            ..Export::default()
                        });
                    }
                }
            }
        }
    }
}

fn want(held: &mut Gathering, request: Request) {
    let Some(index) = held.at.get(&request.value).copied() else {
        held.at.insert(request.value.clone(), held.requests.len());
        held.requests.push(request);
        return;
    };
    // Written beats guessed. One `mod order;` and one `use self::order::X` name
    // the same file, and the first is the one that can be a hole.
    if held.requests[index].guessed && !request.guessed {
        held.requests[index] = request;
    }
}

/// Item kinds whose `name` field is a name this crate can publish.
const ITEMS: [&str; 8] = [
    "function_item",
    "struct_item",
    "enum_item",
    "union_item",
    "trait_item",
    "type_item",
    "const_item",
    "static_item",
];

fn named(node: Node, source: &str) -> Option<String> {
    if !ITEMS.contains(&node.kind()) {
        return None;
    }
    node.child_by_field_name("name")
        .map(|name| text_of(name, source).to_string())
}

fn published(node: Node) -> bool {
    named_children(node)
        .iter()
        .any(|child| child.kind() == "visibility_modifier")
}

/// The filename in `#[path = "other.rs"]`, when the node above is that attribute.
fn path_attribute(node: Node, source: &str) -> Option<String> {
    if node.kind() != "attribute_item" {
        return None;
    }
    let attribute = named_children(node)
        .into_iter()
        .find(|child| child.kind() == "attribute")?;
    let parts = named_children(attribute);
    let key = parts.first()?;
    if text_of(*key, source) != "path" {
        return None;
    }
    let value = attribute
        .child_by_field_name("value")
        .or_else(|| parts.get(1).copied())?;
    if !value.kind().ends_with("string_literal") {
        return None;
    }
    Some(unquoted(text_of(value, source)))
}

/// `/^[a-z]*"|"$/g` — the opening quote with whatever prefixes it, and the closing one.
fn unquoted(text: &str) -> String {
    let lead = text
        .find(|character: char| !character.is_ascii_lowercase())
        .unwrap_or(text.len());
    let rest = if text[lead..].starts_with('"') {
        &text[lead + 1..]
    } else {
        text
    };
    rest.strip_suffix('"').unwrap_or(rest).to_string()
}

/// One `use` argument flattened into the item paths it names.
fn used(node: Node, source: &str, prefix: &[String]) -> Vec<(Vec<String>, Option<String>)> {
    match node.kind() {
        "scoped_identifier" => {
            let mut path = prefix.to_vec();
            path.extend(segments(Some(node), source));
            vec![(without_self(path), None)]
        }
        "scoped_use_list" => {
            let mut base = prefix.to_vec();
            base.extend(segments(node.child_by_field_name("path"), source));
            match node.child_by_field_name("list") {
                None => Vec::new(),
                Some(list) => named_children(list)
                    .into_iter()
                    .flat_map(|child| used(child, source, &base))
                    .collect(),
            }
        }
        "use_list" => named_children(node)
            .into_iter()
            .flat_map(|child| used(child, source, prefix))
            .collect(),
        "use_as_clause" => {
            let mut path = prefix.to_vec();
            path.extend(segments(node.child_by_field_name("path"), source));
            let alias = node
                .child_by_field_name("alias")
                .map(|alias| text_of(alias, source).to_string());
            vec![(without_self(path), alias)]
        }
        "use_wildcard" => {
            // `use a::b::*` — the module is the whole path, and the `*` names no item.
            match named_children(node).first() {
                None => Vec::new(),
                Some(inner) => {
                    let mut path = prefix.to_vec();
                    path.extend(segments(Some(*inner), source));
                    vec![(without_self(path), None)]
                }
            }
        }
        _ => {
            let own = segments(Some(node), source);
            if own.is_empty() {
                return Vec::new();
            }
            let mut path = prefix.to_vec();
            path.extend(own);
            vec![(without_self(path), None)]
        }
    }
}

/// `self` inside a list names the module the list hangs off, not a thing in it.
///
/// `use crate::git::{self, Oid}` asks for `crate::git` twice over — once as the
/// module and once as a name in it — and only the first spelling is a module
/// path. Left in, the same file is asked for under two keys and the request the
/// dedupe keeps is the one nobody wrote.
fn without_self(path: Vec<String>) -> Vec<String> {
    if path.len() > 1 && path.last().is_some_and(|last| last == "self") {
        return path[..path.len() - 1].to_vec();
    }
    path
}

fn segments(node: Option<Node>, source: &str) -> Vec<String> {
    let Some(node) = node else {
        return Vec::new();
    };
    if node.kind() == "scoped_identifier" {
        let mut held = segments(node.child_by_field_name("path"), source);
        if let Some(name) = node.child_by_field_name("name") {
            held.push(text_of(name, source).to_string());
        }
        return held;
    }
    // `crate`, `super`, `self` are their own node types, and their text is the word.
    let text = text_of(node, source);
    if text.is_empty() || text.contains('\n') {
        return Vec::new();
    }
    vec![text.to_string()]
}
