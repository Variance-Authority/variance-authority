//! The paths a Rust module names an item by, anchored where the module tree
//! can follow them.
//!
//! A `use` is one such path and a type or an expression written as
//! `crate::a::Name` is another. Each is told where it starts — the crate root,
//! the file's own module, its parent — and nothing more: which segments are
//! modules and which is the item is the module tree's answer, and
//! [`rust.ts`](../../../src/rust.ts) reads it from the `mod` lines.

use std::collections::{HashMap, HashSet};

use tree_sitter::Node;

use super::{line_of, named_children, text_of};

/// What a block of items can start a path with: the inline modules it sits
/// inside, the modules it declares, and the names its `use` lines bind to a
/// path from this crate.
pub(super) struct Scope {
    pub(super) prefix: Vec<String>,
    pub(super) mods: HashSet<String>,
    pub(super) bound: HashMap<String, Vec<String>>,
}

/// One path an item is named by: the path from its anchor, the name it takes,
/// the path as the line spells it, and the line it is written on.
pub(super) struct Named {
    pub(super) path: Vec<String>,
    pub(super) binding: String,
    pub(super) written: String,
    pub(super) line: u32,
}

/// `path` as the file's own module reads it: `crate` as written, `self` and
/// `super` from the file rather than from the inline module the path sits in,
/// and a module or a name this block declares or binds spelled out from the
/// file; nothing for a path that starts anywhere else, as an external crate's
/// does.
pub(super) fn anchored(path: &[String], scope: &Scope) -> Option<Vec<String>> {
    let first = path.first()?;
    match first.as_str() {
        "crate" => Some(path.to_vec()),
        "self" | "super" => Some(folded(path, &scope.prefix)),
        name if scope.mods.contains(name) => {
            let mut full = vec!["self".to_string()];
            full.extend_from_slice(&scope.prefix);
            full.extend_from_slice(path);
            Some(full)
        }
        name => scope.bound.get(name).map(|bound| {
            let mut full = bound.clone();
            full.extend_from_slice(&path[1..]);
            full
        }),
    }
}

/// `self` and `super` inside `mod a { mod b { … } }` read from the file:
/// `super` in `b` is `self::a`, and a `super` past the file's own inline
/// modules is the file's parent.
fn folded(path: &[String], prefix: &[String]) -> Vec<String> {
    let climbs = path.iter().take_while(|segment| *segment == "super").count();
    let (kept, rest) = if climbs == 0 {
        (prefix.len(), &path[1..])
    } else if climbs <= prefix.len() {
        (prefix.len() - climbs, &path[climbs..])
    } else {
        let mut full = vec!["super".to_string(); climbs - prefix.len()];
        full.extend_from_slice(&path[climbs..]);
        return full;
    };
    let mut full = vec!["self".to_string()];
    full.extend_from_slice(&prefix[..kept]);
    full.extend_from_slice(rest);
    full
}

/// Every path under `node` that names an item from an anchor, outermost
/// first. A `use`, a `mod`, an attribute and a visibility are read elsewhere
/// or name no item.
pub(super) fn qualified(node: Node, source: &str, scope: &Scope, found: &mut Vec<Named>) {
    match node.kind() {
        "use_declaration" | "mod_item" | "attribute_item" | "inner_attribute_item" | "visibility_modifier"
        | "macro_definition" | "extern_crate_declaration" => return,
        "scoped_identifier" | "scoped_type_identifier" => {
            if let Some(path) = simple(node, source) {
                if let Some(full) = anchored(&path, scope) {
                    named(full, &path, line_of(node), found);
                }
                return;
            }
        }
        _ => {}
    }
    for child in named_children(node) {
        qualified(child, source, scope, found);
    }
}

/// Every prefix of a path past its anchor, each as the item it would name:
/// nothing in `crate::map::JourneyMap::new()` says whether `map` is a module,
/// or whether `new` is a function of the module or of the type. The module
/// tree answers, by landing only the prefix that leaves one segment past the
/// modules ([`rust.ts`](../../../src/rust.ts)). Each prefix keeps the
/// segments of `spelled` it covers, at least the first, as the name the line
/// reaches it by: `crate::shapes::Props` is reached as written, a
/// `shapes::Props` under `mod shapes;` as `shapes::Props`.
fn named(full: Vec<String>, spelled: &[String], line: u32, found: &mut Vec<Named>) {
    let anchor = full.iter().take_while(|segment| matches!(segment.as_str(), "crate" | "self" | "super")).count();
    // Anchoring can lengthen a path, `shapes::X` to `self::shapes::X`, or
    // shorten it, `super::super::X` inside `mod a { … }` to `super::X`.
    let expanded = full.len() as isize - spelled.len() as isize;
    for end in anchor + 1..=full.len() {
        let path = full[..end].to_vec();
        let binding = path.last().cloned().unwrap_or_default();
        let covered = (end as isize - expanded).clamp(1, spelled.len() as isize) as usize;
        let written = spelled[..covered].join("::");
        found.push(Named { path, binding, written, line });
    }
}

/// The segments of a path made only of names, `crate`, `self` and `super`;
/// nothing for one that carries generic arguments, a leading `::`, a
/// qualified `<T as Trait>` or a macro variable, which name no module.
fn simple(node: Node, source: &str) -> Option<Vec<String>> {
    match node.kind() {
        "scoped_identifier" | "scoped_type_identifier" => {
            let mut held = simple(node.child_by_field_name("path")?, source)?;
            let name = node.child_by_field_name("name")?;
            if !matches!(name.kind(), "identifier" | "type_identifier" | "super" | "self") {
                return None;
            }
            held.push(text_of(name, source).to_string());
            Some(held)
        }
        "identifier" | "type_identifier" | "crate" | "self" | "super" => Some(vec![text_of(node, source).to_string()]),
        _ => None,
    }
}

/// One `use` argument flattened into the item paths it names.
/// Each path comes with its alias, and whether it is a glob, which binds no name of its own.
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
