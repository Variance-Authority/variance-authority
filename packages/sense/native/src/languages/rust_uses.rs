//! Where a Rust file uses an item it declares at its top level.
//!
//! No resolver runs, so scope is walked by hand, as the language writes it: a
//! function's and a closure's parameters, a `let` from the statement after it,
//! a `match` arm's, an `if let`'s, a `while let`'s and a `for`'s pattern over
//! the body they guard, an item or a `use` inside a block over the whole
//! block, and a generic parameter over its item. A name bound nearer is
//! another name, so what it shadows is no use. Values, types and macros are
//! looked up apart, the way Rust keeps them, so `fn f<T>` hides a `struct T`
//! and no `let T` does.
//!
//! An inline `mod` sees none of the file's items but those it imports: `use
//! super::*`, `use super::name` (whose line is itself a use, as an import is
//! in another file) and a written `super::name`. A path names its first
//! segment and nothing after it, so `Shape::new` uses `Shape`, `self::f` and
//! `super::f` from an inline module use `f`, and `other::f` uses nothing here.
//!
//! A macro's arguments are tokens, not a tree: an identifier in them is a use
//! when it names an item and is not a field after `.` or a path's tail after
//! `::`. A `let` inside a macro binds nothing here, and a name formatted in a
//! string, `"{name}"`, is no use.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use tree_sitter::{Node, Tree, TreeCursor};

use super::rust::{used, ITEMS};
use super::{line_of, text_of, Children, RustKind};
use crate::help_own_uses::OwnUse;
use crate::order::code_unit;

/// Each is the index of its names in a [`Names`].
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Space {
    Value,
    Type,
    Macro,
}

/// Names by namespace, each set looked up by a `&str` the source holds, so a
/// lookup allocates nothing.
type Names = [HashSet<String>; 3];

/// One scope: what it binds, what it imports of the file's items, and, for an
/// inline module, how many modules deep it sits.
#[derive(Default)]
struct Frame {
    bound: Names,
    /// A local name, imported from the file's own scope, and the item it names.
    imported: HashMap<String, String>,
    /// An inline module: its depth, and whether it imports the file with `use super::*`.
    module: Option<(usize, bool)>,
}

struct Walker<'a> {
    source: &'a str,
    /// The file's top-level items, by namespace.
    items: Names,
    /// The items a pattern names rather than binds: a `const` and a unit or tuple struct.
    patterned: HashSet<String>,
    frames: Vec<Frame>,
    seen: HashSet<(String, u32)>,
    /// The cursors [`Children`] walks with, one per level of the walk in progress.
    spare: Vec<TreeCursor<'a>>,
}

/// Every line `tree` uses one of its top-level items on, once per name and
/// line, by line and then by name in code units.
pub fn own_uses(tree: &Tree, source: &str) -> Vec<OwnUse> {
    let root = tree.root_node();
    let mut items = Names::default();
    let mut patterned = HashSet::new();
    let mut spare = Vec::new();
    let mut children = Children::of(root, &mut spare);
    for (child, _) in children.by_ref().filter(|(child, _)| child.is_named()) {
        for (space, name) in item_names(child, source) {
            if matches!(child.rust_kind(), "const_item" | "struct_item") && space == Space::Value {
                patterned.insert(name.clone());
            }
            items[space as usize].insert(name);
        }
    }
    children.done(&mut spare);
    if items.iter().all(HashSet::is_empty) {
        return Vec::new();
    }

    let mut walker = Walker { source, items, patterned, frames: vec![Frame::default()], seen: HashSet::new(), spare };
    walker.each(root, |walker, child, _| walker.node(child));
    let mut found: Vec<OwnUse> = walker.seen.into_iter().map(|(name, line)| OwnUse { name, line }).collect();
    found.sort_by(|a, b| a.line.cmp(&b.line).then_with(|| code_unit(&a.name, &b.name)));
    found
}

/// The names an item binds where it is written, each in its namespace.
fn item_names(node: Node, source: &str) -> Vec<(Space, String)> {
    let name = |field: &str| node.child_by_field_name(field).map(|name| text_of(name, source).to_string());
    let kind = node.rust_kind();
    let spaces: &[Space] = match kind {
        "function_item" | "const_item" | "static_item" => &[Space::Value],
        // A unit or tuple struct is a value too: its constructor.
        "struct_item" => &[Space::Type, Space::Value],
        "mod_item" => &[Space::Type],
        "macro_definition" => &[Space::Macro],
        _ if ITEMS.contains(&kind) => &[Space::Type],
        _ => &[],
    };
    match name("name") {
        Some(name) => spaces.iter().map(|space| (*space, name.clone())).collect(),
        None => Vec::new(),
    }
}

impl<'a> Walker<'a> {
    fn text(&self, node: Node) -> &'a str {
        text_of(node, self.source)
    }

    /// Call `visit` with every named child of `node` and the field it sits in, in order.
    fn each(&mut self, node: Node<'a>, mut visit: impl FnMut(&mut Self, Node<'a>, Option<&'a str>)) {
        let mut children = Children::of(node, &mut self.spare);
        for (child, field) in children.by_ref() {
            if child.is_named() {
                visit(self, child, field);
            }
        }
        children.done(&mut self.spare);
    }

    /// How many inline modules deep the walk is.
    fn depth(&self) -> usize {
        self.frames.iter().rev().find_map(|frame| frame.module.map(|(depth, _)| depth)).unwrap_or(0)
    }

    /// The top-level item `name` names here, if it names one.
    fn resolve(&self, name: &str, spaces: &[Space]) -> Option<String> {
        for frame in self.frames.iter().rev() {
            if spaces.iter().any(|space| frame.bound[*space as usize].contains(name)) {
                return None;
            }
            if let Some(item) = frame.imported.get(name) {
                return Some(item.clone());
            }
            if let Some((depth, glob)) = frame.module {
                // `use super::*` one module down imports the file's items; any
                // deeper, it imports the module above, which this does not follow.
                return (glob && depth == 1 && self.declared(name, spaces)).then(|| name.to_string());
            }
        }
        self.declared(name, spaces).then(|| name.to_string())
    }

    fn declared(&self, name: &str, spaces: &[Space]) -> bool {
        spaces.iter().any(|space| self.items[*space as usize].contains(name))
    }

    fn found(&mut self, name: String, node: Node) {
        self.seen.insert((name, line_of(node)));
    }

    fn uses(&mut self, node: Node, spaces: &[Space]) {
        let name = self.text(node);
        if let Some(item) = self.resolve(name, spaces) {
            self.found(item, node);
        }
    }

    fn bind(&mut self, space: Space, name: String) {
        if let Some(frame) = self.frames.last_mut() {
            frame.bound[space as usize].insert(name);
        }
    }

    fn scoped(&mut self, module: Option<(usize, bool)>, body: impl FnOnce(&mut Self)) {
        self.frames.push(Frame { module, ..Frame::default() });
        body(self);
        self.frames.pop();
    }

    /// Bind what a block or a module body declares, before its statements run:
    /// its items and its `use`s are in scope over all of it.
    fn hoist(&mut self, body: Node<'a>) {
        let depth = self.depth();
        self.each(body, |walker, child, _| {
            if child.rust_kind() == "use_declaration" {
                return walker.imports(child, depth);
            }
            for (space, name) in item_names(child, walker.source) {
                walker.bind(space, name);
            }
        });
    }

    /// A `use` inside a block or an inline module: a name it takes from the
    /// file's own scope is an import of that item, and its line a use; any
    /// other name it takes shadows an item of that name.
    fn imports(&mut self, node: Node, depth: usize) {
        let Some(argument) = node.child_by_field_name("argument") else { return };
        for (path, local, glob) in used(argument, self.source, &[]) {
            // The segments that reach the file's own scope from this module:
            // `self` at the top, one `super` per inline module below it.
            let reach = if depth == 0 {
                usize::from(path.first().is_some_and(|first| first == "self"))
            } else {
                path.iter().take_while(|segment| *segment == "super").count()
            };
            let own = reach == depth.max(1);
            let rest = &path[reach.min(path.len())..];
            match (own, glob, rest) {
                (true, true, []) => {
                    if let Some(Frame { module: Some((_, glob)), .. }) = self.frames.last_mut() {
                        *glob = true;
                    }
                }
                (true, false, [item]) if self.declared(item, &[Space::Value, Space::Type, Space::Macro]) => {
                    let item = item.clone();
                    let local = local.unwrap_or_else(|| item.clone());
                    if let Some(frame) = self.frames.last_mut() {
                        frame.imported.insert(local, item.clone());
                    }
                    self.found(item, node);
                }
                // A `*` of another module may bind any name, which this does not read.
                // FIXME: that includes `use super::*` from a module two levels in whose
                // parent globs the file in turn, so its uses of the file's items are lost.
                (_, true, _) => {}
                _ => {
                    let Some(name) = local.or_else(|| path.last().cloned()) else { continue };
                    for space in [Space::Value, Space::Type, Space::Macro] {
                        self.bind(space, name.clone());
                    }
                }
            }
        }
    }

    fn children(&mut self, node: Node<'a>) {
        // An item's, a field's, a variant's name is the binding, not a use;
        // a struct expression's is the type it builds.
        let named = node.rust_kind() != "struct_expression";
        self.each(node, |walker, child, field| {
            if !(named && field == Some("name")) {
                walker.node(child);
            }
        });
    }

    fn node(&mut self, node: Node<'a>) {
        match node.rust_kind() {
            "identifier" => self.uses(node, &[Space::Value]),
            "type_identifier" => self.uses(node, &[Space::Type]),
            "attribute_item" | "inner_attribute_item" | "use_declaration" | "extern_crate_declaration" | "lifetime" | "label"
            | "line_comment" | "block_comment" | "string_literal" | "raw_string_literal" | "char_literal" => {}
            "scoped_identifier" | "scoped_type_identifier" => self.path(node),
            "macro_invocation" => {
                match node.child_by_field_name("macro") {
                    Some(name) if name.rust_kind() == "identifier" => self.uses(name, &[Space::Macro]),
                    Some(name) => self.path(name),
                    None => {}
                }
                self.each(node, |walker, child, _| {
                    if child.rust_kind() == "token_tree" {
                        walker.tokens(child);
                    }
                });
            }
            "macro_definition" => {
                self.each(node, |walker, rule, _| {
                    if let Some(right) = (rule.rust_kind() == "macro_rule").then(|| rule.child_by_field_name("right")).flatten() {
                        walker.tokens(right);
                    }
                });
            }
            "mod_item" => {
                let Some(body) = node.child_by_field_name("body") else { return };
                let depth = self.depth() + 1;
                self.scoped(Some((depth, false)), |walker| {
                    walker.hoist(body);
                    walker.children(body);
                });
            }
            "block" => self.scoped(None, |walker| {
                walker.hoist(node);
                walker.children(node);
            }),
            "function_item" | "function_signature_item" | "struct_item" | "enum_item" | "union_item" | "trait_item"
            | "type_item" | "impl_item" => self.scoped(None, |walker| {
                if let Some(parameters) = node.child_by_field_name("type_parameters") {
                    walker.generics(parameters);
                }
                if let Some(parameters) = node.child_by_field_name("parameters") {
                    walker.each(parameters, |walker, parameter, _| walker.parameter(parameter));
                }
                walker.each(node, |walker, child, field| {
                    if !matches!(field, Some("name" | "type_parameters" | "parameters")) {
                        walker.node(child);
                    }
                });
            }),
            "closure_expression" => self.scoped(None, |walker| {
                if let Some(parameters) = node.child_by_field_name("parameters") {
                    walker.each(parameters, |walker, parameter, _| walker.parameter(parameter));
                }
                for field in ["return_type", "body"] {
                    if let Some(child) = node.child_by_field_name(field) {
                        walker.node(child);
                    }
                }
            }),
            "let_declaration" => {
                // `let x = x;` reads the outer `x`: the value before the pattern binds.
                for field in ["type", "value", "alternative"] {
                    if let Some(child) = node.child_by_field_name(field) {
                        self.node(child);
                    }
                }
                if let Some(pattern) = node.child_by_field_name("pattern") {
                    self.pattern(pattern);
                }
            }
            "match_arm" => self.scoped(None, |walker| {
                if let Some(pattern) = node.child_by_field_name("pattern") {
                    walker.pattern(pattern);
                }
                if let Some(value) = node.child_by_field_name("value") {
                    walker.node(value);
                }
            }),
            "if_expression" | "while_expression" => {
                self.scoped(None, |walker| {
                    if let Some(condition) = node.child_by_field_name("condition") {
                        walker.condition(condition);
                    }
                    for field in ["consequence", "body"] {
                        if let Some(child) = node.child_by_field_name(field) {
                            walker.node(child);
                        }
                    }
                });
                if let Some(alternative) = node.child_by_field_name("alternative") {
                    self.node(alternative);
                }
            }
            "for_expression" => {
                if let Some(value) = node.child_by_field_name("value") {
                    self.node(value);
                }
                self.scoped(None, |walker| {
                    if let Some(pattern) = node.child_by_field_name("pattern") {
                        walker.pattern(pattern);
                    }
                    if let Some(body) = node.child_by_field_name("body") {
                        walker.node(body);
                    }
                });
            }
            _ => self.children(node),
        }
    }

    /// A condition, binding each `let` pattern in it over what it guards.
    fn condition(&mut self, node: Node<'a>) {
        match node.rust_kind() {
            "let_condition" => {
                if let Some(value) = node.child_by_field_name("value") {
                    self.node(value);
                }
                if let Some(pattern) = node.child_by_field_name("pattern") {
                    self.pattern(pattern);
                }
            }
            "let_chain" => self.each(node, |walker, child, _| walker.condition(child)),
            _ => self.node(node),
        }
    }

    /// A path names its first segment, and a written `self::` or `super::`
    /// that reaches the file names its item.
    fn path(&mut self, node: Node<'a>) {
        let mut segments = Vec::new();
        let mut head = Some(node);
        while let Some(at) = head {
            if !matches!(at.rust_kind(), "scoped_identifier" | "scoped_type_identifier") {
                break;
            }
            segments.push(at.child_by_field_name("name"));
            head = at.child_by_field_name("path");
        }
        let Some(head) = head else { return };
        let depth = self.depth();
        let ups = match head.rust_kind() {
            "self" => Some(0),
            "super" => Some(1 + segments.iter().rev().take_while(|name| name.is_some_and(|name| name.rust_kind() == "super")).count()),
            _ => None,
        };
        match ups {
            Some(ups) if ups == depth => {
                // The segment after the `self` or the `super`s is the item.
                let item = segments.iter().rev().nth(ups.saturating_sub(1)).copied().flatten();
                if let Some(item) = item {
                    let name = self.text(item);
                    if self.declared(name, &[Space::Value, Space::Type, Space::Macro]) {
                        self.found(name.to_string(), item);
                    }
                }
            }
            Some(_) => {}
            None => match head.rust_kind() {
                "identifier" | "type_identifier" => self.uses(head, &[Space::Type]),
                _ => self.node(head),
            },
        }
    }
}

#[path = "rust_patterns.rs"]
mod patterns;

#[cfg(test)]
#[path = "rust_uses_tests.rs"]
mod tests;
