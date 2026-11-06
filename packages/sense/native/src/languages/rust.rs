//! What a Rust file asks for and what it publishes.
//!
//! [`rust.ts`](../../../src/rust.ts) carries the argument, and `rust.test.ts`
//! holds this reader to it: a `mod` declaration names a file and can be a hole, a
//! `use` path names an item whose module prefix is a fact about the disk, so
//! every `use` is guessed and a written `mod` beats it. Resolution stays in
//! TypeScript.

use std::collections::{HashMap, HashSet};

use tree_sitter::{Node, Tree};

use super::rust_paths::{anchored, qualified, Named, Scope};
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

    block(root, source, &[], &mut held);

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

/// Every item the file declares, `pub` or not, each with the doc lines above
/// it and past its attributes. One inside an inline module is named on the
/// path from the file's own module, `tests::fixture`, the way rustdoc names it.
/// A `pub` one whose inline modules are all `pub` is left out: the file
/// exports the outermost module, and the item is named through it.
pub fn declarations(tree: &Tree, source: &str) -> Vec<SourceSymbol> {
    let mut held = Vec::new();
    declared_in(tree.root_node(), source, &[], true, &mut held);
    held
}

/// `open` is whether every inline module of `prefix` is `pub`.
fn declared_in(node: Node, source: &str, prefix: &[String], open: bool, held: &mut Vec<SourceSymbol>) {
    let children = named_children(node);
    for at in 0..children.len() {
        let node = children[at];
        let Some(name) = (match node.kind() {
            "mod_item" | "macro_definition" => node.child_by_field_name("name").map(|name| text_of(name, source).to_string()),
            _ => named(node, source),
        }) else {
            continue;
        };
        let Some(kind) = kind_of(node.kind()) else { continue };
        let path: Vec<String> = prefix.iter().cloned().chain([name]).collect();
        let shared = published(node, source);
        if prefix.is_empty() || !(open && shared) {
            // A `macro_rules!` has no module path: it is named as written.
            let named = if node.kind() == "macro_definition" { path[path.len() - 1].clone() } else { path.join("::") };
            let mut symbol = declaration(&children, at, named, kind, source, between_doc_and_item);
            // A `macro_rules!` is in scope by where it is written, and
            // `#[macro_export]` or `#[macro_use]` carry it further: never by
            // the module rule an item's visibility follows. A `pub` item
            // inside a private inline module reaches as far as the modules
            // around it let it, which the item alone does not say.
            if node.kind() != "macro_definition" && (prefix.is_empty() || !shared) {
                symbol.reach = Some("module");
            }
            held.push(symbol);
        }
        if let Some(body) = (node.kind() == "mod_item").then(|| node.child_by_field_name("body")).flatten() {
            declared_in(body, source, &path, open && shared, held);
        }
    }
}

/// What rustdoc attaches a doc across: an attribute, and a plain comment, which
/// the lexer drops before rustdoc sees a token. The grammar marks a doc comment
/// `outer` or `inner`, so a comment with neither is plain.
fn between_doc_and_item(node: Node) -> bool {
    match node.kind() {
        "attribute_item" => true,
        "line_comment" | "block_comment" => node.child_by_field_name("outer").is_none() && node.child_by_field_name("inner").is_none(),
        _ => false,
    }
}

/// `prefix` is the inline-module path this block sits inside. `mod b;` inside
/// `mod a { … }` is the file `a/b.rs`, so the nesting has to be carried down,
/// and `self` and `super` in a `use` name that module, not the file.
fn block(node: Node, source: &str, prefix: &[String], held: &mut Gathering) {
    let top = prefix.is_empty();
    let children = named_children(node);
    let scope = scope_of(&children, source, prefix);
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
                        // Inside an inline module the spelled path starts at
                        // that module's directory, so it is emitted after the
                        // module: `mod inline { #[path = "other.rs"] mod
                        // inner; }` is `self::inline/other.rs`. Which directory
                        // that is depends on the file, and the resolver owns it.
                        let spelled = attributes(&children[..at])
                            .iter()
                            .find_map(|attribute| path_attribute(*attribute, source))
                            .map(|spelled| if top { spelled } else { format!("self::{}/{spelled}", prefix.join("::")) });
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
                                item: false,
                            },
                        );
                    }
                    Some(body) => {
                        // FIXME: a `#[path = "foo"]` on this inline module
                        // makes `foo` the directory of the modules inside it;
                        // the name is carried instead (`rust.test.ts` todo).
                        let mut inner = prefix.to_vec();
                        inner.push(name.clone());
                        block(body, source, &inner, held);
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
                for (path, local, _) in used(argument, source, &[]) {
                    // A path that names the file itself, as `use super::*`
                    // in a `mod tests` does, asks for nothing.
                    let path = anchored(&path, &scope).unwrap_or(path);
                    if path == ["self"] {
                        continue;
                    }
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
                            // A `use` may name a module, and is counted as it always was.
                            item: false,
                        },
                    );
                    // `pub use` is a re-export, and is the only thing in Rust
                    // that republishes a name this file did not declare.
                    // At the top only: one inside `mod inner` publishes
                    // `inner::B`, which is no name of the file.
                    if shared && top {
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
                let mut found = Vec::new();
                qualified(*child, source, &scope, &mut found);
                for Named { path, binding, line } in found {
                    want(
                        held,
                        Request {
                            value: path.join("::"),
                            kind: Kind::Imports,
                            bindings: vec![Binding {
                                imported: binding.clone(),
                                local: binding,
                                type_only: false,
                                line,
                            }],
                            line,
                            // As a `use`: the module tree says which segment is the item.
                            guessed: true,
                            item: true,
                        },
                    );
                }
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

/// What the block's paths can start with besides `crate`, `self` and `super`:
/// the modules it declares, and the names its `use` lines bind to a path from
/// this crate. A glob binds no name a path could start with.
fn scope_of(children: &[Node], source: &str, prefix: &[String]) -> Scope {
    let mut scope = Scope {
        prefix: prefix.to_vec(),
        mods: children
            .iter()
            .filter(|child| child.kind() == "mod_item")
            .filter_map(|child| child.child_by_field_name("name"))
            .map(|name| text_of(name, source).to_string())
            .collect::<HashSet<_>>(),
        bound: HashMap::new(),
    };
    let mut bound = HashMap::new();
    for child in children.iter().filter(|child| child.kind() == "use_declaration") {
        let Some(argument) = child.child_by_field_name("argument") else {
            continue;
        };
        for (path, local, glob) in used(argument, source, &[]) {
            let Some(local) = local.or_else(|| path.last().cloned()) else {
                continue;
            };
            if glob || local == "self" || local == "super" || local == "crate" {
                continue;
            }
            if let Some(full) = anchored(&path, &scope) {
                bound.insert(local, full);
            }
        }
    }
    scope.bound = bound;
    scope
}

/// The attributes written directly above the item that follows `before`, nearest first.
fn attributes<'tree>(before: &[Node<'tree>]) -> Vec<Node<'tree>> {
    before
        .iter()
        .rev()
        .take_while(|node| matches!(node.kind(), "attribute_item" | "line_comment" | "block_comment"))
        .filter(|node| node.kind() == "attribute_item")
        .copied()
        .collect()
}

fn want(held: &mut Gathering, request: Request) {
    let Some(index) = held.at.get(&request.value).copied() else {
        held.at.insert(request.value.clone(), held.requests.len());
        held.requests.push(request);
        return;
    };
    // Written beats guessed. One `mod order;` and one `use self::order::X` name
    // the same file, and the first is the one that can be a hole. A `use` beats
    // an item asked for by the same path: `use crate::graph;` imports the module
    // a `crate::graph::reach()` also passes through.
    let held_request = &held.requests[index];
    if (held_request.guessed && !request.guessed) || (held_request.item && !request.item) {
        held.requests[index] = request;
    }
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

/// The filename in `#[path = "other.rs"]`, when `node` is that attribute.
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

/// One `use` argument flattened into the item paths it names, each with the
/// name it binds when it renames one, and whether it is a `*`, whose path is
/// the module it takes every item of.
pub(super) fn used(node: Node, source: &str, prefix: &[String]) -> Vec<(Vec<String>, Option<String>, bool)> {
    match node.kind() {
        "scoped_identifier" => {
            let mut path = prefix.to_vec();
            path.extend(segments(Some(node), source));
            vec![(without_self(path), None, false)]
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
            vec![(without_self(path), alias, false)]
        }
        "use_wildcard" => {
            // `use a::b::*` — the module is the whole path, and the `*` names no item.
            match named_children(node).first() {
                None => Vec::new(),
                Some(inner) => {
                    let mut path = prefix.to_vec();
                    path.extend(segments(Some(*inner), source));
                    vec![(without_self(path), None, true)]
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
            vec![(without_self(path), None, false)]
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
