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
use crate::languages::{Children, RustKind};

impl<'a> Walker<'a> {
    pub(super) fn generics(&mut self, node: Node<'a>) {
        self.each(node, |walker, child, _| walker.generic(child));
    }

    fn generic(&mut self, child: Node<'a>) {
        match child.rust_kind() {
            "type_parameter" => {
                if let Some(name) = child.child_by_field_name("name") {
                    self.bind(Space::Type, self.text(name).to_string());
                }
                for field in ["bounds", "default_type"] {
                    if let Some(part) = child.child_by_field_name(field) {
                        self.node(part);
                    }
                }
            }
            "const_parameter" => {
                if let Some(name) = child.child_by_field_name("name") {
                    self.bind(Space::Value, self.text(name).to_string());
                }
                if let Some(kind) = child.child_by_field_name("type") {
                    self.node(kind);
                }
            }
            _ => {}
        }
    }

    pub(super) fn parameter(&mut self, node: Node<'a>) {
        match node.rust_kind() {
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
    pub(super) fn pattern(&mut self, node: Node<'a>) {
        match node.rust_kind() {
            "identifier" => {
                let name = self.text(node);
                if self.patterned.contains(name) {
                    if let Some(item) = self.resolve(name, &[Space::Value]) {
                        return self.found(item, node);
                    }
                }
                self.bind(Space::Value, name.to_string());
            }
            "scoped_identifier" | "scoped_type_identifier" => self.path(node),
            "tuple_struct_pattern" | "struct_pattern" => {
                self.each(node, |walker, child, field| match (field, child.rust_kind()) {
                    (Some("type"), "identifier") => walker.uses(child, &[Space::Value, Space::Type]),
                    (Some("type"), _) => walker.node(child),
                    _ => walker.pattern(child),
                });
            }
            "field_pattern" => match node.child_by_field_name("pattern") {
                Some(pattern) => self.pattern(pattern),
                None => {
                    if let Some(name) = node.child_by_field_name("name") {
                        self.bind(Space::Value, self.text(name).to_string());
                    }
                }
            },
            "match_pattern" => {
                let condition = node.child_by_field_name("condition");
                self.each(node, |walker, child, _| {
                    if Some(child) != condition {
                        walker.pattern(child);
                    }
                });
                if let Some(condition) = condition {
                    self.condition(condition);
                }
            }
            _ => self.each(node, |walker, child, _| walker.pattern(child)),
        }
    }

    /// A macro's arguments, token by token.
    pub(super) fn tokens(&mut self, node: Node<'a>) {
        // Each token is judged once the one after it is known.
        let mut tokens = Children::of(node, &mut self.spare);
        let (mut before, mut current) = (None, None);
        loop {
            let after = tokens.next().map(|(token, _)| token);
            if let Some(token) = current {
                self.token(token, before, after.map(|token| token.rust_kind()));
            }
            let Some(after) = after else { break };
            before = current.map(|token: Node<'a>| token.rust_kind());
            current = Some(after);
        }
        tokens.done(&mut self.spare);
    }

    /// One token of a macro's arguments, between the kinds of its neighbours.
    fn token(&mut self, token: Node<'a>, before: Option<&str>, after: Option<&str>) {
        match token.rust_kind() {
            "token_tree" | "token_repetition" => self.tokens(token),
            "identifier" if !(matches!(before, Some("." | "::")) || after == Some(":")) => {
                let spaces: &[Space] = if after == Some("!") { &[Space::Macro] } else { &[Space::Value, Space::Type] };
                self.uses(token, spaces);
            }
            _ => {}
        }
    }
}
