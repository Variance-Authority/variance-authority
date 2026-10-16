//! What a Rust file asks for and what it publishes.
//!
//! [`rust.ts`](../../../src/rust.ts) carries the argument, and `rust.test.ts`
//! holds this reader to it: a `mod` declaration names a file and can be a hole, a
//! `use` path names an item whose module prefix is a fact about the disk, so
//! every `use` is guessed and a written `mod` beats it. Resolution stays in
//! TypeScript.

use std::collections::HashMap;

use tree_sitter::{Node, Tree};

use super::shape::{Binding, Export, Kind, Read, Request, NAMESPACE_NAME};
use super::{declaration, kind_of, line_of, named_children, text_of, visibility};
use crate::harvest::SourceSymbol;

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
    rooted(root, source, &mut held);

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
        ..Read::default()
    }
}

/// Every item the file declares at its top level, `pub` or not, each with the
/// doc lines above it and past its attributes.
pub fn declarations(tree: &Tree, source: &str) -> Vec<SourceSymbol> {
    let children = named_children(tree.root_node());
    (0..children.len())
        .filter_map(|at| {
            let node = children[at];
            let name = match node.kind() {
                "mod_item" | "macro_definition" => node.child_by_field_name("name").map(|name| text_of(name, source).to_string()),
                _ => named(node, source),
            }?;
            let mut symbol = declaration(&children, at, name, kind_of(node.kind())?, source, &["attribute_item"]);
            // A `macro_rules!` is in scope by where it is written, and
            // `#[macro_export]` or `#[macro_use]` carry it further: never by
            // the module rule an item's visibility follows.
            if node.kind() != "macro_definition" {
                symbol.reach = Some("module");
            }
            Some(symbol)
        })
        .collect()
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
                                // The file is taken whole, as a module bound
                                // under its name: no item of it is imported.
                                bindings: vec![Binding {
                                    imported: NAMESPACE_NAME.to_string(),
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

                if top && published(*child, source) {
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
                let shared = published(*child, source);
                for (path, local) in used(argument, source, &[]) {
                    let value = path.join("::");
                    let last = path.last().cloned().unwrap_or_else(|| value.clone());
                    // `use a::b::*` binds every item `a::b` declares, under its
                    // own name: the binding is the glob itself. `use super::*`
                    // that climbs no further than the inline modules this
                    // block sits in names this very file, which is no import.
                    let wildcard = local.as_deref() == Some(GLOB);
                    let glob = wildcard && !within(&path, prefix);
                    let (imported, bound) = match local {
                        _ if glob => (NAMESPACE_NAME.to_string(), NAMESPACE_NAME.to_string()),
                        Some(local) if !wildcard => (last.clone(), local),
                        _ => (last.clone(), last.clone()),
                    };
                    // A glob re-export republishes under the module's name, as before.
                    let local = if glob { last.clone() } else { bound.clone() };
                    want(
                        held,
                        Request {
                            value: value.clone(),
                            kind: Kind::Imports,
                            bindings: vec![Binding {
                                imported,
                                local: bound,
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
                    if published(*child, source) {
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

/// Every path outside a `use` that names an item from the crate root,
/// `crate::shapes::Props`, asks for what its prefix names, as a `use` of the
/// prefix would: `crate::shapes` binds the module under its whole spelling,
/// and `crate::shapes::Shape` in `crate::shapes::Shape::Square` the item.
fn rooted(node: Node, source: &str, held: &mut Gathering) {
    for child in named_children(node) {
        match child.kind() {
            // A `use` is read by `block`, an attribute is no code, and a
            // macro's own body is a pattern of tokens.
            "use_declaration" | "attribute_item" | "inner_attribute_item" | "macro_definition" | "token_tree" => continue,
            "scoped_identifier" | "scoped_type_identifier" => {
                let names = segments(child.child_by_field_name("path"), source);
                if names.len() >= 2 && names[0] == "crate" {
                    let line = line_of(child);
                    want(
                        held,
                        Request {
                            value: names.join("::"),
                            kind: Kind::Imports,
                            bindings: vec![Binding {
                                imported: names[names.len() - 1].clone(),
                                local: names.join("::"),
                                type_only: false,
                                line,
                            }],
                            line,
                            guessed: true,
                        },
                    );
                }
            }
            _ => {}
        }
        rooted(child, source, held);
    }
}

fn want(held: &mut Gathering, request: Request) {
    let Some(index) = held.at.get(&request.value).copied() else {
        held.at.insert(request.value.clone(), held.requests.len());
        held.requests.push(request);
        return;
    };
    // Each statement still binds what it binds: `use a::b::*` and
    // `use a::b::C` ask for the file once, with both bindings.
    let mut bindings = held.requests[index].bindings.clone();
    for binding in &request.bindings {
        if !bindings.iter().any(|kept| kept.imported == binding.imported && kept.local == binding.local) {
            bindings.push(binding.clone());
        }
    }
    // Written beats guessed. One `mod order;` and one `use self::order::X` name
    // the same file, and the first is the one that can be a hole.
    if held.requests[index].guessed && !request.guessed {
        held.requests[index] = request;
    }
    held.requests[index].bindings = bindings;
}

/// Item kinds whose `name` field is a name this crate can publish.
pub(super) const ITEMS: [&str; 8] = [
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

/// Whether another file can name the item: any `pub`, `pub(crate)` and
/// `pub(super)` among them, but not `pub(self)` or `pub(in self)`, which are
/// no `pub` at all.
fn published(node: Node, source: &str) -> bool {
    named_children(node)
        .into_iter()
        .filter(|child| child.kind() == "visibility_modifier")
        .any(|modifier| !matches!(visibility(modifier, source).as_str(), "pub(self)" | "pub(inself)"))
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
                    vec![(without_self(path), Some(GLOB.to_string()))]
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

/// The local a `use_wildcard` comes back with from [`used`].
const GLOB: &str = "*";

/// Whether a path of `super`s alone climbs no higher than the inline modules
/// `prefix` names, so it names a module inside this very file.
fn within(path: &[String], prefix: &[String]) -> bool {
    path.iter().all(|name| name == "super" || name == "self") && path.iter().filter(|name| *name == "super").count() <= prefix.len()
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
