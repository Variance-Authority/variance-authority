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
/// and the line it is written on.
pub(super) struct Named {
    pub(super) path: Vec<String>,
    pub(super) binding: String,
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
                    named(full, line_of(node), found);
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
/// modules ([`rust.ts`](../../../src/rust.ts)).
fn named(full: Vec<String>, line: u32, found: &mut Vec<Named>) {
    let anchor = full.iter().take_while(|segment| matches!(segment.as_str(), "crate" | "self" | "super")).count();
    for end in anchor + 1..=full.len() {
        let path = full[..end].to_vec();
        let binding = path.last().cloned().unwrap_or_default();
        found.push(Named { path, binding, line });
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
