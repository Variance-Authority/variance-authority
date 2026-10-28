//! Where a member is used through a value whose type the source writes.
//!
//! No type checker runs, so a member read is tied to a type only where the
//! line spells that type: the receiver is a binding whose annotation names it
//! (`props: Props`), or an expression cast to it (`value as Props`). An object
//! literal written as one (`const fixed: Props = { … }`, `{ … } satisfies
//! Props`) writes each of its keys, and an annotated pattern (`({ size }:
//! Props) =>`) destructures them. Each use records the type's name as the file
//! writes it; which declaration that name is, through its import, is the
//! query's join (`help_members.rs`), the same one `uses` makes for an import.
//!
//! Bindings are scoped as oxc's walk enters and leaves scopes, so a parameter
//! that shadows an annotated one, `(props) => props.size`, is no use. What a
//! checker infers — a value returned by a call, a generic, a mapped type, a
//! value narrowed or aliased without an annotation — names no type here, and
//! is no use of any declaration.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;
use oxc_syntax::scope::{ScopeFlags, ScopeId};
use serde::Serialize;
use std::cell::Cell;

use crate::read::Lines;

/// How a line uses a member.
pub(crate) const READ: &str = "read";
pub(crate) const WRITE: &str = "write";
pub(crate) const DESTRUCTURE: &str = "destructure";

/// One use of a member: its name, its line, the type its value is written
/// `of`, as the file names it, and `how` the line uses it.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
pub struct MemberUse {
    pub(crate) name: String,
    pub(crate) line: u32,
    pub(crate) of: String,
    pub(crate) how: String,
}

/// Every use `program` writes of a member through a value whose type it
/// names, once per name, line, type and kind, in source order.
pub(crate) fn member_uses_in(program: &Program<'_>, lines: &Lines) -> Vec<MemberUse> {
    let mut walker = Walker { lines, scopes: vec![HashMap::new()], written: HashSet::new(), seen: HashSet::new(), found: Vec::new() };
    walker.visit_program(program);
    walker.found
}

/// The name of the one type `annotation` writes: a reference by a plain name,
/// with or without type arguments, alone or in a union with `undefined` or
/// `null`.
fn named(annotation: &TSType) -> Option<String> {
    match annotation {
        TSType::TSTypeReference(it) => match &it.type_name {
            TSTypeName::IdentifierReference(name) => Some(name.name.to_string()),
            _ => None,
        },
        TSType::TSParenthesizedType(it) => named(&it.type_annotation),
        TSType::TSUnionType(it) => {
            let mut left = it.types.iter().filter(|one| !matches!(one, TSType::TSUndefinedKeyword(_) | TSType::TSNullKeyword(_)));
            match (left.next(), left.next()) {
                (Some(one), None) => named(one),
                _ => None,
            }
        }
        _ => None,
    }
}

fn annotated(annotation: Option<&TSTypeAnnotation>) -> Option<String> {
    annotation.and_then(|it| named(&it.type_annotation))
}

struct Walker<'n> {
    lines: &'n Lines,
    /// Each binding in scope and the type its annotation names, innermost last;
    /// `None` for a binding written without one.
    scopes: Vec<HashMap<String, Option<String>>>,
    /// The member expressions an assignment or an update writes, by span.
    written: HashSet<(u32, u32)>,
    seen: HashSet<MemberUse>,
    found: Vec<MemberUse>,
}

impl Walker<'_> {
    fn add(&mut self, name: &str, at: u32, of: &str, how: &str) {
        let found = MemberUse { name: name.to_owned(), line: self.lines.at(at), of: of.to_owned(), how: how.to_owned() };
        if self.seen.insert(found.clone()) { self.found.push(found); }
    }

    /// The type a value is written as: a binding's annotation, the nearest
    /// scope that binds it deciding, or a cast.
    fn typed(&self, expression: &Expression) -> Option<String> {
        match expression.without_parentheses() {
            Expression::Identifier(it) => self.scopes.iter().rev().find_map(|scope| scope.get(it.name.as_str())).cloned().flatten(),
            Expression::TSAsExpression(it) => named(&it.type_annotation),
            Expression::TSSatisfiesExpression(it) => named(&it.type_annotation),
            Expression::TSTypeAssertion(it) => named(&it.type_annotation),
            Expression::TSNonNullExpression(it) => self.typed(&it.expression),
            _ => None,
        }
    }

    /// A pattern bound to a value of type `of`: a name holds it, an object
    /// pattern destructures each key it names.
    fn bind(&mut self, pattern: &BindingPattern, of: &str) {
        match pattern {
            BindingPattern::BindingIdentifier(it) => {
                if let Some(scope) = self.scopes.last_mut() { scope.insert(it.name.to_string(), Some(of.to_owned())); }
            }
            BindingPattern::ObjectPattern(it) => {
                for property in &it.properties {
                    if let Some(name) = property.key.static_name() { self.add(&name, property.key.span().start, of, DESTRUCTURE); }
                }
            }
            BindingPattern::AssignmentPattern(it) => self.bind(&it.left, of),
            BindingPattern::ArrayPattern(_) => {}
        }
    }

    /// An object literal written as a value of type `of` writes each key it names.
    fn literal(&mut self, expression: &Expression, of: &str) {
        let Expression::ObjectExpression(object) = expression.without_parentheses() else { return };
        for property in &object.properties {
            if let ObjectPropertyKind::ObjectProperty(property) = property {
                if let Some(name) = property.key.static_name() { self.add(&name, property.key.span().start, of, WRITE); }
            }
        }
    }

    fn member(&mut self, object: &Expression, name: &str, at: u32, span: (u32, u32)) {
        let Some(of) = self.typed(object) else { return };
        let how = if self.written.contains(&span) { WRITE } else { READ };
        self.add(name, at, &of, how);
    }

    fn writes(&mut self, target: Option<&MemberExpression>) {
        if let Some(target) = target { self.written.insert((target.span().start, target.span().end)); }
    }
}

impl<'a> Visit<'a> for Walker<'_> {
    fn enter_scope(&mut self, _flags: ScopeFlags, _scope_id: &Cell<Option<ScopeId>>) {
        self.scopes.push(HashMap::new());
    }

    fn leave_scope(&mut self) {
        self.scopes.pop();
    }

    // Every binding shadows the outer one of its name; one an annotation
    // already typed in this scope keeps its type.
    fn visit_binding_identifier(&mut self, it: &BindingIdentifier<'a>) {
        if let Some(scope) = self.scopes.last_mut() { scope.entry(it.name.to_string()).or_insert(None); }
    }

    fn visit_formal_parameter(&mut self, it: &FormalParameter<'a>) {
        if let Some(of) = annotated(it.type_annotation.as_deref()) { self.bind(&it.pattern, &of); }
        walk::walk_formal_parameter(self, it);
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        let of = annotated(it.type_annotation.as_deref()).or_else(|| match &it.id {
            // `const { size } = props` destructures what `props` is written as.
            BindingPattern::ObjectPattern(_) => it.init.as_ref().and_then(|init| self.typed(init)),
            _ => None,
        });
        if let Some(of) = of {
            if let Some(init) = &it.init { self.literal(init, &of); }
            self.bind(&it.id, &of);
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_ts_as_expression(&mut self, it: &TSAsExpression<'a>) {
        if let Some(of) = named(&it.type_annotation) { self.literal(&it.expression, &of); }
        walk::walk_ts_as_expression(self, it);
    }

    fn visit_ts_satisfies_expression(&mut self, it: &TSSatisfiesExpression<'a>) {
        if let Some(of) = named(&it.type_annotation) { self.literal(&it.expression, &of); }
        walk::walk_ts_satisfies_expression(self, it);
    }

    fn visit_assignment_expression(&mut self, it: &AssignmentExpression<'a>) {
        self.writes(it.left.as_member_expression());
        walk::walk_assignment_expression(self, it);
    }

    fn visit_update_expression(&mut self, it: &UpdateExpression<'a>) {
        self.writes(it.argument.as_member_expression());
        walk::walk_update_expression(self, it);
    }

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        self.member(&it.object, &it.property.name, it.property.span.start, (it.span.start, it.span.end));
        walk::walk_static_member_expression(self, it);
    }

    fn visit_computed_member_expression(&mut self, it: &ComputedMemberExpression<'a>) {
        if let Expression::StringLiteral(name) = &it.expression {
            self.member(&it.object, &name.value, name.span.start, (it.span.start, it.span.end));
        }
        walk::walk_computed_member_expression(self, it);
    }
}

#[cfg(test)]
#[path = "help_member_uses_tests.rs"]
mod tests;
