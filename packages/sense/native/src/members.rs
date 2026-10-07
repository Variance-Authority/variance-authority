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
//!
//! The same walk reads the [`Loads`]: an `import()` is a request only the tree
//! can read, and a member read through it needs that request's index, so the
//! module's tree is walked once for both.

use std::collections::{BTreeSet, HashMap};

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use serde::Serialize;

use crate::loads::Loads;
use crate::read::{Lines, Request};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Member {
    /// The index of the request, in the same parse, the name is read through.
    pub(crate) request: u32,
    pub(crate) name: String,
    pub(crate) line: u32,
}

/// The loads a module calls for, and the names it reads off what it holds.
///
/// `requests` are the ones the module record states; a member read through an
/// `import()` is indexed as if `loads.dynamic` were appended to them.
pub fn members_and_loads_in<'l>(program: &Program, lines: &'l Lines, requests: &[Request]) -> (Vec<Member>, Loads<'l>) {
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
        stated: requests.len() as u32,
        loads: Loads::new(lines),
        found: BTreeSet::new(),
    };
    walker.visit_program(program);
    (walker.found.into_iter().collect(), walker.loads)
}

struct Walker<'l> {
    lines: &'l Lines,
    /// A local name to the request it holds.
    holders: HashMap<String, u32>,
    /// How many requests the record states, which the `import()` ones follow.
    stated: u32,
    loads: Loads<'l>,
    found: BTreeSet<Member>,
}

impl Walker<'_> {
    /// The request an expression evaluates to, looking through parentheses and `await`.
    fn held(&mut self, expression: &Expression) -> Option<u32> {
        match expression.without_parentheses() {
            Expression::AwaitExpression(it) => self.held(&it.argument),
            Expression::ImportExpression(it) => self.loads.import(it).map(|index| self.stated + index),
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

    fn visit_import_expression(&mut self, it: &ImportExpression<'a>) {
        self.loads.import(it);
        walk::walk_import_expression(self, it);
    }

    fn visit_ts_import_equals_declaration(&mut self, it: &TSImportEqualsDeclaration<'a>) {
        self.loads.import_equals(it);
        walk::walk_ts_import_equals_declaration(self, it);
    }

    // `import('m').then((m) => …)`: the callback's first parameter holds the module.
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        self.loads.call(it);
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
