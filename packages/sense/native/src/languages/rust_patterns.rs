//! What a Rust pattern binds and uses, and what a macro's tokens use: the
//! binding half of the walk in [`rust_uses`](super).
//!
//! A generic parameter binds a type or a `const`, a function parameter binds
//! its pattern, and a pattern binds its plain names, except one that names a
//! `const` or a unit struct, which it uses. A macro's arguments are tokens: an
//! identifier among them is a use unless it is a field after `.`, a path's tail
//! after `::` or a key before `:`.

// compass: variance-authority.reach.relations

use tree_sitter::Node;

use super::{Space, Walker};
use crate::languages::named_children;

impl Walker<'_> {
    pub(super) fn generics(&mut self, node: Node) {
        for child in named_children(node) {
            match child.kind() {
                "type_parameter" => {
                    if let Some(name) = child.child_by_field_name("name") {
                        let name = self.text(name);
                        self.bind(Space::Type, name);
                    }
                    for field in ["bounds", "default_type"] {
                        if let Some(part) = child.child_by_field_name(field) {
                            self.node(part);
                        }
                    }
                }
                "const_parameter" => {
                    if let Some(name) = child.child_by_field_name("name") {
                        let name = self.text(name);
                        self.bind(Space::Value, name);
                    }
                    if let Some(kind) = child.child_by_field_name("type") {
                        self.node(kind);
                    }
                }
                _ => {}
            }
        }
    }

    pub(super) fn parameter(&mut self, node: Node) {
        match node.kind() {
            "parameter" => {}
            "attribute_item" | "self_parameter" | "variadic_parameter" => return,
            _ => return self.pattern(node),
        }
        if let Some(kind) = node.child_by_field_name("type") {
            self.node(kind);
        }
        if let Some(pattern) = node.child_by_field_name("pattern") {
            self.pattern(pattern);
        }
    }

    /// A pattern binds its plain names, except one that names a `const` or a
    /// unit struct, which it uses; the path a struct or tuple pattern is
    /// written with is a use too.
    pub(super) fn pattern(&mut self, node: Node) {
        match node.kind() {
            "identifier" => {
                let name = self.text(node);
                if self.patterned.contains(&name) {
                    if let Some(item) = self.resolve(&name, &[Space::Value]) {
                        return self.found(item, node);
                    }
                }
                self.bind(Space::Value, name);
            }
            "scoped_identifier" | "scoped_type_identifier" => self.path(node),
            "tuple_struct_pattern" | "struct_pattern" => {
                let mut cursor = node.walk();
                let children: Vec<(Node, Option<&str>)> = node
                    .children(&mut cursor)
                    .enumerate()
                    .filter(|(_, child)| child.is_named())
                    .map(|(at, child)| (child, node.field_name_for_child(at as u32)))
                    .collect();
                for (child, field) in children {
                    match (field, child.kind()) {
                        (Some("type"), "identifier") => self.uses(child, &[Space::Value, Space::Type]),
                        (Some("type"), _) => self.node(child),
                        _ => self.pattern(child),
                    }
                }
            }
            "field_pattern" => match node.child_by_field_name("pattern") {
                Some(pattern) => self.pattern(pattern),
                None => {
                    if let Some(name) = node.child_by_field_name("name") {
                        let name = self.text(name);
                        self.bind(Space::Value, name);
                    }
                }
            },
            "match_pattern" => {
                let condition = node.child_by_field_name("condition");
                for child in named_children(node).into_iter().filter(|child| Some(*child) != condition) {
                    self.pattern(child);
                }
                if let Some(condition) = condition {
                    self.condition(condition);
                }
            }
            _ => {
                for child in named_children(node) {
                    self.pattern(child);
                }
            }
        }
    }

    /// A macro's arguments, token by token.
    pub(super) fn tokens(&mut self, node: Node) {
        let mut cursor = node.walk();
        let tokens: Vec<Node> = node.children(&mut cursor).collect();
        for (at, token) in tokens.iter().enumerate() {
            match token.kind() {
                "token_tree" | "token_repetition" => self.tokens(*token),
                "identifier" => {
                    let before = at.checked_sub(1).map(|at| tokens[at].kind());
                    let after = tokens.get(at + 1).map(|token| token.kind());
                    if matches!(before, Some("." | "::")) || after == Some(":") {
                        continue;
                    }
                    let spaces: &[Space] = if after == Some("!") { &[Space::Macro] } else { &[Space::Value, Space::Type] };
                    self.uses(*token, spaces);
                }
                _ => {}
            }
        }
    }
}
