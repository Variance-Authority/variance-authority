//! The names a module reads off another module it holds as an object.
//!
//! A named import says which names it takes. A namespace import and an
//! `import()` do not: the file holds the module whole, and the names it uses are
//! member reads further down — `ns.x`, `(await import('m')).x`, `m.x` after
//! `const m = await import('m')`, `const { x } = await import('m')`, and the
//! callback of `import('m').then(…)`. Each of those is recorded against the
//! request it reads through, by that request's index in the parse.
//!
//! This is a listing of where a name is used, and nothing selects on it: a
//! request's `bindings` stay what the statement wrote, so a namespace still
//! reads as the whole module to anything that charges a change. Shadowing is not
//! resolved, so a parameter that reuses the holder's name lists its reads too;
//! a holder handed to another function, or a specifier that is not a literal,
//! lists nothing.

use std::collections::{BTreeSet, HashMap};

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use serde::Serialize;

use crate::read::{Lines, Request};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Member {
    /// The index of the request, in the same parse, the name is read through.
    pub(crate) request: u32,
    pub(crate) name: String,
    pub(crate) line: u32,
}

/// `dynamic` pairs each `import()` expression's start offset with its request.
pub fn members_in(program: &Program, lines: &Lines, requests: &[Request], dynamic: &[(u32, u32)]) -> Vec<Member> {
    let mut holders = HashMap::new();
    for (index, request) in requests.iter().enumerate() {
        for binding in &request.bindings {
            if binding.imported == "*" && !binding.type_only {
                holders.insert(binding.local.clone(), index as u32);
            }
        }
    }
    let mut walker = Walker {
        lines,
        holders,
        dynamic: dynamic.iter().copied().collect(),
        found: BTreeSet::new(),
    };
    walker.visit_program(program);
    walker.found.into_iter().collect()
}

struct Walker<'l> {
    lines: &'l Lines,
    /// A local name to the request it holds.
    holders: HashMap<String, u32>,
    dynamic: HashMap<u32, u32>,
    found: BTreeSet<Member>,
}

impl Walker<'_> {
    /// The request an expression evaluates to, looking through parentheses and `await`.
    fn held(&self, expression: &Expression) -> Option<u32> {
        match expression.without_parentheses() {
            Expression::AwaitExpression(it) => self.held(&it.argument),
            Expression::ImportExpression(it) => self.dynamic.get(&it.span.start).copied(),
            Expression::Identifier(it) => self.holders.get(it.name.as_str()).copied(),
            _ => None,
        }
    }

    /// What binding a pattern to `request` takes: a holder, or the names it destructures.
    fn bind(&mut self, pattern: &BindingPattern, request: u32) {
        match pattern {
            BindingPattern::BindingIdentifier(it) => {
                self.holders.insert(it.name.to_string(), request);
            }
            BindingPattern::ObjectPattern(it) => {
                for property in &it.properties {
                    if let Some(name) = property.key.static_name() {
                        self.add(request, &name, property.span.start);
                    }
                }
            }
            BindingPattern::AssignmentPattern(it) => self.bind(&it.left, request),
            BindingPattern::ArrayPattern(_) => {}
        }
    }

    fn add(&mut self, request: u32, name: &str, at: u32) {
        self.found.insert(Member { request, name: name.to_owned(), line: self.lines.at(at) });
    }
}

impl<'a> Visit<'a> for Walker<'_> {
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let Some(request) = it.init.as_ref().and_then(|init| self.held(init)) {
            self.bind(&it.id, request);
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        if let Some(request) = self.held(&it.object) {
            self.add(request, &it.property.name, it.property.span.start);
        }
        walk::walk_static_member_expression(self, it);
    }

    fn visit_computed_member_expression(&mut self, it: &ComputedMemberExpression<'a>) {
        if let (Some(request), Expression::StringLiteral(name)) = (self.held(&it.object), &it.expression) {
            self.add(request, &name.value, name.span.start);
        }
        walk::walk_computed_member_expression(self, it);
    }

    fn visit_jsx_member_expression(&mut self, it: &JSXMemberExpression<'a>) {
        if let JSXMemberExpressionObject::IdentifierReference(object) = &it.object {
            if let Some(request) = self.holders.get(object.name.as_str()).copied() {
                self.add(request, &it.property.name, it.property.span.start);
            }
        }
        walk::walk_jsx_member_expression(self, it);
    }

    // `import('m').then((m) => …)`: the callback's first parameter holds the module.
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(callee) = it.callee.without_parentheses() {
            let loaded = matches!(callee.object.without_parentheses(), Expression::ImportExpression(_));
            if let (true, "then", Some(request)) = (loaded, callee.property.name.as_str(), self.held(&callee.object)) {
                let first = match it.arguments.first() {
                    Some(Argument::ArrowFunctionExpression(f)) => f.params.items.first(),
                    Some(Argument::FunctionExpression(f)) => f.params.items.first(),
                    _ => None,
                };
                if let Some(parameter) = first {
                    self.bind(&parameter.pattern, request);
                }
            }
        }
        walk::walk_call_expression(self, it);
    }
}
