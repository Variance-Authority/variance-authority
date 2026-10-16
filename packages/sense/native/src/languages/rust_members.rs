//! The fields and variants a Rust file declares, and the lines that use them.
//!
//! A named field of a `struct` or a `union` is declared on the type, a variant
//! on its `enum`, and a field of a struct-like variant on `Enum::Variant`. They
//! are the rows [`help_members.rs`](../help_members.rs) answers `uses` with for
//! a TypeScript member, and the same join reads them: a use records the type as
//! the line writes it, and which declaration that name is, through the `use`
//! that binds it, is the query's.
//!
//! No type checker runs, so a use is tied to a type only where the source
//! names one. A struct literal or a struct pattern names its type in its path,
//! `Self` as the type of the `impl` around it. A field read `recv.f` names it
//! when the receiver is `self` inside an `impl`, or a binding whose annotation
//! is the type, a reference to it, or a `Box`, `Rc` or `Arc` of it, or a `let`
//! bound to a struct literal. Every other binding of a name shadows the outer
//! one, as the language scopes it, so a closure's own `|props| props.size` is
//! no use.
//!
//! A type is recorded as the path the line writes, placed in the inline module
//! the line is in as [`rust_paths.rs`](rust_paths.rs) reads it, and a type an
//! inline module declares is on its path, `a::Props`. A path `A::B { .. }` is also written
//! as the variant `B` of `A`, since a file cannot tell an enum from a module by
//! its spelling: a module declares no variant, so the join answers none for
//! it. A field reached through a field, `o.inner.size`, is recorded on the
//! chain `Outer.inner`: the type of `inner` is the annotation its declaration
//! carries, which may be in another file, so the join follows it.
//!
//! A macro's arguments are tokens, not a tree: `recv.f` among them is a read, or
//! a write before `=`, a chain `o.inner.size` reads each field on the one
//! before it, and `Enum::Variant` is a `read`, since the tokens say
//! the name and not whether the macro builds it or matches it.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use tree_sitter::{Node, Tree};

use super::rust_paths::{annotated, inline_modules, spelled_path, written, Here, Inline};
use super::{line_of, named_children, text_of};
use crate::help_member_uses::{MemberUse, DESTRUCTURE, READ, WRITE};
use crate::help_members::MemberDeclaration;

/// Every field and variant `tree` declares, in source order.
pub fn member_declarations(tree: &Tree, source: &str) -> Vec<MemberDeclaration> {
    let inline = inline_modules(tree, source);
    let mut declared = Vec::new();
    declare(tree.root_node(), source, &mut Vec::new(), &inline, &mut declared);
    declared
}

fn declare(node: Node, source: &str, module: &mut Vec<String>, inline: &Inline, declared: &mut Vec<MemberDeclaration>) {
    let here = Here { own: None, module: &module[..], inline };
    match node.kind() {
        "struct_item" | "union_item" => {
            if let (Some(name), Some(body)) = (node.child_by_field_name("name"), node.child_by_field_name("body")) {
                let on = here.declared(text_of(name, source));
                fields(body, &on, Some(Here { own: Some(&on), ..here }), source, declared);
            }
        }
        "enum_item" => {
            if let (Some(name), Some(body)) = (node.child_by_field_name("name"), node.child_by_field_name("body")) {
                let on = here.declared(text_of(name, source));
                for variant in named_children(body).into_iter().filter(|child| child.kind() == "enum_variant") {
                    let Some(called) = variant.child_by_field_name("name") else { continue };
                    let called = text_of(called, source);
                    declared.push(MemberDeclaration { name: called.to_owned(), line: line_of(variant), on: on.clone(), variant: true, r#type: None });
                    if let Some(body) = variant.child_by_field_name("body") {
                        fields(body, &format!("{on}::{called}"), None, source, declared);
                    }
                }
            }
        }
        "mod_item" => {
            if let (Some(name), Some(body)) = (node.child_by_field_name("name"), node.child_by_field_name("body")) {
                module.push(text_of(name, source).to_owned());
                declare(body, source, module, inline, declared);
                module.pop();
            }
            return;
        }
        // A macro's own body is a pattern of tokens, no declaration.
        "macro_definition" => return,
        _ => {}
    }
    for child in named_children(node) {
        declare(child, source, module, inline, declared);
    }
}

/// The named fields of a `{ … }` body, each on `on`, with the type its
/// annotation names where the body is a struct's, `typed` being where it is:
/// a variant's field is reached by a pattern, never through a field. A tuple
/// body names none.
fn fields(body: Node, on: &str, typed: Option<Here>, source: &str, declared: &mut Vec<MemberDeclaration>) {
    if body.kind() != "field_declaration_list" { return; }
    for field in named_children(body).into_iter().filter(|child| child.kind() == "field_declaration") {
        let Some(name) = field.child_by_field_name("name") else { continue };
        let r#type = typed.and_then(|here| annotated(field.child_by_field_name("type")?, source, here));
        declared.push(MemberDeclaration { name: text_of(name, source).to_owned(), line: line_of(name), on: on.to_owned(), variant: false, r#type });
    }
}

/// Every use `tree` writes of a field or a variant through a type it names,
/// once per name, line, type and kind, in source order.
pub fn member_uses(tree: &Tree, source: &str) -> Vec<MemberUse> {
    let inline = inline_modules(tree, source);
    let mut walker = Walker { source, scopes: vec![HashMap::new()], selves: Vec::new(), module: Vec::new(), inline, seen: HashSet::new(), found: Vec::new() };
    walker.visit(tree.root_node(), false);
    walker.found
}

struct Walker<'s> {
    source: &'s str,
    /// Each binding in scope and the type its annotation names, innermost
    /// last; `None` for a binding no annotation types.
    scopes: Vec<HashMap<String, Option<String>>>,
    /// The type each `impl` around the walk is for, innermost last; `None` for
    /// a trait, whose `Self` is no type this file names.
    selves: Vec<Option<String>>,
    /// The inline module the walk is in, outermost first.
    module: Vec<String>,
    inline: Inline,
    seen: HashSet<MemberUse>,
    found: Vec<MemberUse>,
}

impl Walker<'_> {
    fn text(&self, node: Node) -> &str {
        text_of(node, self.source)
    }

    fn add(&mut self, name: &str, line: u32, of: &str, how: &str, variant: bool) {
        let found = MemberUse { name: name.to_owned(), line, of: of.to_owned(), how: how.to_owned(), variant };
        if self.seen.insert(found.clone()) { self.found.push(found); }
    }

    fn own(&self) -> Option<&str> {
        self.selves.last().and_then(|own| own.as_deref())
    }

    fn here(&self) -> Here<'_> {
        Here { own: self.own(), module: &self.module, inline: &self.inline }
    }

    fn bound(&self, name: &str) -> Option<String> {
        if name == "self" { return self.own().map(str::to_owned); }
        self.scopes.iter().rev().find_map(|scope| scope.get(name)).cloned().flatten()
    }

    fn shadow(&mut self, name: &str, of: Option<String>) {
        if let Some(scope) = self.scopes.last_mut() { scope.insert(name.to_owned(), of); }
    }

    fn scoped(&mut self, walk: impl FnOnce(&mut Self)) {
        self.scopes.push(HashMap::new());
        walk(self);
        self.scopes.pop();
    }

    /// The type a type annotation names, as [`annotated`] reads it.
    fn typed(&self, node: Node) -> Option<String> {
        annotated(node, self.source, self.here())
    }

    /// The type a struct literal's or a struct pattern's path names, as the
    /// path is written: a type, or `Enum::Variant`.
    fn path(&self, node: Node) -> Option<String> {
        match node.kind() {
            "generic_type_with_turbofish" => self.path(node.child_by_field_name("type")?),
            _ => written(node, self.source, self.here()),
        }
    }

    /// `Enum::Variant` by the path before the variant, `how` the line uses it.
    fn variant(&mut self, node: Node, how: &str) {
        let (Some(head), Some(name)) = (node.child_by_field_name("path"), node.child_by_field_name("name")) else { return };
        let Some(of) = written(head, self.source, self.here()) else { return };
        let called = self.text(name).to_owned();
        self.add(&called, line_of(name), &of, how, true);
    }

    /// The names a pattern binds, each shadowing the outer one; `of` types the
    /// pattern when it is one name.
    fn bind(&mut self, pattern: Node, of: Option<String>) {
        match pattern.kind() {
            "identifier" => {
                let name = self.text(pattern).to_owned();
                self.shadow(&name, of);
            }
            "self" => {}
            "mut_pattern" | "ref_pattern" => {
                for child in named_children(pattern) { self.bind(child, of.clone()); }
            }
            "shorthand_field_identifier" => {
                let name = self.text(pattern).to_owned();
                self.shadow(&name, None);
            }
            // A path names a type or a constant, never a binding.
            "scoped_identifier" | "scoped_type_identifier" | "type_identifier" | "field_identifier" => {}
            "field_pattern" => {
                match pattern.child_by_field_name("pattern") {
                    Some(inner) => self.bind(inner, None),
                    None => {
                        if let Some(name) = pattern.child_by_field_name("name") { self.bind(name, None); }
                    }
                }
            }
            "struct_pattern" | "tuple_struct_pattern" => {
                let path = pattern.child_by_field_name("type").map(|path| path.id());
                for child in named_children(pattern).into_iter().filter(|child| Some(child.id()) != path) { self.bind(child, None); }
            }
            _ => {
                for child in named_children(pattern) { self.bind(child, None); }
            }
        }
    }

    fn visit_children(&mut self, node: Node, pattern: bool) {
        for child in named_children(node) { self.visit(child, pattern); }
    }

    fn visit(&mut self, node: Node, pattern: bool) {
        match node.kind() {
            // A macro's own body is a pattern of tokens, an attribute is no
            // code, and a `use` path names modules and items, never a variant.
            "macro_definition" | "attribute_item" | "inner_attribute_item" | "use_declaration" => {}
            "impl_item" => {
                let own = node.child_by_field_name("type").and_then(|it| self.typed(it));
                self.selves.push(own);
                if let Some(body) = node.child_by_field_name("body") { self.visit(body, false); }
                self.selves.pop();
            }
            "mod_item" => {
                let (Some(name), Some(body)) = (node.child_by_field_name("name"), node.child_by_field_name("body")) else { return };
                let name = self.text(name).to_owned();
                self.module.push(name);
                self.scoped(|walker| walker.visit(body, false));
                self.module.pop();
            }
            "trait_item" => {
                self.selves.push(None);
                self.visit_children(node, false);
                self.selves.pop();
            }
            "function_item" | "closure_expression" => self.scoped(|walker| {
                if let Some(parameters) = node.child_by_field_name("parameters") { walker.parameters(parameters); }
                if let Some(body) = node.child_by_field_name("body") { walker.visit(body, false); }
            }),
            "block" | "while_expression" => self.scoped(|walker| walker.visit_children(node, pattern)),
            // An `if let` binds in its branch, and its `else` sees the outer name.
            "if_expression" => {
                self.scoped(|walker| {
                    if let Some(condition) = node.child_by_field_name("condition") { walker.visit(condition, false); }
                    if let Some(consequence) = node.child_by_field_name("consequence") { walker.visit(consequence, false); }
                });
                if let Some(alternative) = node.child_by_field_name("alternative") { self.visit(alternative, false); }
            }
            // The iterable is read before the pattern binds.
            "for_expression" => self.scoped(|walker| {
                if let Some(value) = node.child_by_field_name("value") { walker.visit(value, false); }
                if let Some(bound) = node.child_by_field_name("pattern") {
                    walker.visit(bound, true);
                    walker.bind(bound, None);
                }
                if let Some(body) = node.child_by_field_name("body") { walker.visit(body, false); }
            }),
            // A guard is an expression in the arm's scope: it reads what the
            // pattern binds, and binds nothing itself.
            "match_arm" => self.scoped(|walker| {
                let arm = node.child_by_field_name("pattern");
                let guard = arm.and_then(|arm| arm.child_by_field_name("condition"));
                let bound: Vec<Node> = match arm {
                    Some(arm) if arm.kind() == "match_pattern" => named_children(arm).into_iter().filter(|child| Some(child.id()) != guard.map(|it| it.id())).collect(),
                    Some(arm) => vec![arm],
                    None => Vec::new(),
                };
                for pattern in bound {
                    walker.visit(pattern, true);
                    walker.bind(pattern, None);
                }
                if let Some(guard) = guard { walker.visit(guard, false); }
                if let Some(value) = node.child_by_field_name("value") { walker.visit(value, false); }
            }),
            "let_declaration" | "let_condition" => {
                if let Some(value) = node.child_by_field_name("value") { self.visit(value, false); }
                if let Some(alternative) = node.child_by_field_name("alternative") { self.visit(alternative, false); }
                let Some(bound) = node.child_by_field_name("pattern") else { return };
                self.visit(bound, true);
                let of = node.child_by_field_name("type").and_then(|it| self.typed(it)).or_else(|| {
                    let value = node.child_by_field_name("value")?;
                    if value.kind() != "struct_expression" { return None; }
                    self.path(value.child_by_field_name("name")?)
                });
                self.bind(bound, of);
            }
            "struct_expression" => {
                let of = node.child_by_field_name("name").and_then(|name| {
                    if matches!(name.kind(), "scoped_type_identifier" | "scoped_identifier") { self.variant(name, WRITE); }
                    self.path(name)
                });
                if let (Some(of), Some(body)) = (&of, node.child_by_field_name("body")) {
                    for field in named_children(body) {
                        let name = match field.kind() {
                            "field_initializer" => field.child_by_field_name("field"),
                            "shorthand_field_initializer" => named_children(field).first().copied(),
                            _ => None,
                        };
                        if let Some(name) = name { let called = self.text(name).to_owned(); self.add(&called, line_of(name), of, WRITE, false); }
                    }
                }
                if let Some(body) = node.child_by_field_name("body") { self.visit(body, false); }
            }
            "struct_pattern" => {
                let of = node.child_by_field_name("type").and_then(|path| {
                    if path.kind() == "scoped_type_identifier" { self.variant(path, DESTRUCTURE); }
                    self.path(path)
                });
                for field in named_children(node).into_iter().filter(|child| child.kind() == "field_pattern") {
                    if let (Some(of), Some(name)) = (&of, field.child_by_field_name("name")) {
                        let called = self.text(name).to_owned();
                        self.add(&called, line_of(name), of, DESTRUCTURE, false);
                    }
                    if let Some(inner) = field.child_by_field_name("pattern") { self.visit(inner, true); }
                }
            }
            "scoped_identifier" => self.variant(node, if pattern { DESTRUCTURE } else { WRITE }),
            "tuple_struct_pattern" => {
                let path = node.child_by_field_name("type");
                if let Some(path) = path.filter(|path| path.kind() == "scoped_identifier") { self.variant(path, DESTRUCTURE); }
                for child in named_children(node).into_iter().filter(|child| Some(child.id()) != path.map(|path| path.id())) { self.visit(child, true); }
            }
            "field_expression" => {
                self.field(node);
                if let Some(value) = node.child_by_field_name("value") { self.visit(value, false); }
            }
            "token_tree" => self.tokens(node),
            _ => self.visit_children(node, pattern),
        }
    }

    /// A function's or a closure's parameters, each bound in its scope: typed
    /// by its annotation, or shadowing untyped.
    fn parameters(&mut self, parameters: Node) {
        for parameter in named_children(parameters) {
            match parameter.kind() {
                "parameter" => {
                    let Some(bound) = parameter.child_by_field_name("pattern") else { continue };
                    self.visit(bound, true);
                    let of = parameter.child_by_field_name("type").and_then(|it| self.typed(it));
                    self.bind(bound, of);
                }
                "self_parameter" | "attribute_item" => {}
                _ => {
                    self.visit(parameter, true);
                    self.bind(parameter, None);
                }
            }
        }
    }

    /// `recv.f` through a receiver whose type is known: a write as the left
    /// side of an assignment or under `&mut`, a read otherwise; the callee of a
    /// method call is no field.
    fn field(&mut self, node: Node) {
        let (Some(value), Some(name)) = (node.child_by_field_name("value"), node.child_by_field_name("field")) else { return };
        if name.kind() != "field_identifier" { return; }
        let parent = node.parent();
        let is = |kind: &str, field: &str| parent.is_some_and(|it| it.kind() == kind && it.child_by_field_name(field).is_some_and(|it| it.id() == node.id()));
        if is("call_expression", "function") { return; }
        let Some(of) = self.receiver(value) else { return };
        let mutable = is("reference_expression", "value") && parent.is_some_and(|it| named_children(it).iter().any(|child| child.kind() == "mutable_specifier"));
        let how = if is("assignment_expression", "left") || is("compound_assignment_expr", "left") || mutable { WRITE } else { READ };
        let called = self.text(name).to_owned();
        self.add(&called, line_of(name), &of, how, false);
    }

    /// The type a field expression's receiver is: a binding's, or the chain
    /// of fields it reaches through after one, `self.inner` in an `impl
    /// Outer` being `Outer.inner`, whose type is the declaration's to say.
    fn receiver(&self, value: Node) -> Option<String> {
        match value.kind() {
            "identifier" | "self" => self.bound(self.text(value)),
            "field_expression" => {
                let name = value.child_by_field_name("field").filter(|name| name.kind() == "field_identifier")?;
                let on = self.receiver(value.child_by_field_name("value")?)?;
                Some(format!("{on}.{}", self.text(name)))
            }
            _ => None,
        }
    }

    /// A macro's arguments, flattened to their tokens: `recv.f` not called,
    /// each field of a chain `recv.f.g` on the one before it, and
    /// `Enum::Variant` by the path before the variant.
    fn tokens(&mut self, tree: Node) {
        let mut tokens = Vec::new();
        flatten(tree, &mut tokens);
        let kind = |at: usize| tokens.get(at).map_or("", |token: &Node| token.kind());
        for at in 0..tokens.len() {
            let after_path = at > 0 && matches!(kind(at - 1), "." | "::");
            if after_path || !matches!(kind(at), "identifier" | "self") { continue; }
            let receiver = self.text(tokens[at]).to_owned();
            if let Some(mut of) = self.bound(&receiver).filter(|_| kind(at + 1) == "." && kind(at + 2) == "identifier") {
                let mut step = at + 2;
                while !matches!(kind(step + 1), "(" | "::") {
                    let called = self.text(tokens[step]).to_owned();
                    let more = kind(step + 1) == "." && kind(step + 2) == "identifier";
                    let how = if !more && is_assignment(kind(step + 1)) { WRITE } else { READ };
                    self.add(&called, line_of(tokens[step]), &of, how, false);
                    if !more { break; }
                    of = format!("{of}.{called}");
                    step += 2;
                }
            }
            let mut last = at;
            while kind(last + 1) == "::" && kind(last + 2) == "identifier" { last += 2; }
            if last > at {
                let names: Vec<&str> = (at..last).step_by(2).map(|name| text_of(tokens[name], self.source)).collect();
                let Some(of) = spelled_path(&names, self.here()) else { continue };
                let called = self.text(tokens[last]).to_owned();
                self.add(&called, line_of(tokens[last]), &of, READ, true);
            }
        }
    }
}

fn is_assignment(token: &str) -> bool {
    matches!(token, "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "&=" | "|=" | "^=" | "<<=" | ">>=")
}

/// Every leaf token under a token tree, in order, nested trees opened.
fn flatten<'t>(node: Node<'t>, into: &mut Vec<Node<'t>>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.child_count() == 0 { into.push(child); } else { flatten(child, into); }
    }
}

#[cfg(test)]
#[path = "rust_members_tests.rs"]
mod tests;
