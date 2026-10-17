//! The names a module reads off another module it holds as an object.
//!
//! A named import says which names it takes. A namespace import, TypeScript's
//! `import m = require('m')` and an `import()` do not: the file holds the module
//! whole, and the names it uses are member reads further down — `ns.x`,
//! `(await import('m')).x`, `m.x` after `const m = await import('m')` or
//! `import m = require('m')`, `const { x } = await import('m')`, the element of
//! `const [{ x }] = await Promise.all([import('m')])` in the same position, and
//! the callback of `import('m').then(…)`. A cast changes no value, and a rest
//! holds the module too; a read off the promise `import()` returns is the
//! promise's, not the module's. Each of those is recorded against the
//! request it reads through, by that request's index in the parse. An
//! `import m = require()` holds from where it is written on, as the `const`
//! TypeScript compiles it to does; a type-only one holds nothing.
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
/// `import()` is indexed as if `loads.dynamic` were appended to them, and one
/// read through an `import m = require()` as if `loads.required` followed those.
pub fn members_and_loads_in<'l>(program: &Program, lines: &'l Lines, requests: &[Request]) -> (Vec<Member>, Loads<'l>) {
    let mut holders = HashMap::new();
    for (index, request) in requests.iter().enumerate() {
        for binding in &request.bindings {
            if binding.imported == "*" && !binding.type_only {
                holders.insert(binding.local.clone(), Via::Indexed(index as u32));
            }
        }
    }
    let mut walker = Walker {
        lines,
        holders,
        stated: requests.len() as u32,
        loads: Loads::new(lines),
        found: BTreeSet::new(),
        mock_factory: None,
    };
    walker.visit_program(program);
    // A required request's index is known only once the walk has met every `import()`.
    let required = walker.stated + walker.loads.dynamic.len() as u32;
    let members: BTreeSet<Member> = walker
        .found
        .into_iter()
        .map(|(via, name, line)| Member { request: via.index(required), name, line })
        .collect();
    (members.into_iter().collect(), walker.loads)
}

/// The request a holder reads through: its index in the parse, or its index in
/// `loads.required`, which the parse appends after every `import()`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Via {
    Indexed(u32),
    Required(u32),
}

impl Via {
    fn index(self, required: u32) -> u32 {
        match self {
            Via::Indexed(index) => index,
            Via::Required(index) => required + index,
        }
    }
}

struct Walker<'l> {
    lines: &'l Lines,
    /// A local name to the request it holds.
    holders: HashMap<String, Via>,
    /// How many requests the record states, which the `import()` ones follow.
    stated: u32,
    loads: Loads<'l>,
    mock_factory: Option<String>,
    found: BTreeSet<(Via, String, u32)>,
}

impl Walker<'_> {
    /// The request an expression evaluates to, looking through parentheses,
    /// TypeScript's casts and `await`: an awaited `import()`, or a holder.
    fn held(&mut self, expression: &Expression) -> Option<Via> {
        match expression.get_inner_expression() {
            Expression::AwaitExpression(it) => self.promised(&it.argument).or_else(|| self.held(&it.argument)),
            Expression::Identifier(it) => self.holders.get(it.name.as_str()).copied(),
            _ => None,
        }
    }

    /// The request an `import()` promises. The promise is not the module: a read
    /// off it, `.then` among them, is the promise's own.
    fn promised(&mut self, expression: &Expression) -> Option<Via> {
        match expression.get_inner_expression() {
            Expression::ImportExpression(it) => self.loads.import(it).map(|index| Via::Indexed(self.stated + index)),
            _ => None,
        }
    }

    /// What an awaited `Promise.all([...])` resolves to, element by element:
    /// the request each `import()` in the array holds, and none for any other
    /// element, a hole, or everything from a spread on, whose positions are unknown.
    fn held_all(&mut self, expression: &Expression) -> Option<Vec<Option<Via>>> {
        match expression.get_inner_expression() {
            Expression::AwaitExpression(it) => self.promised_all(&it.argument),
            _ => None,
        }
    }

    fn promised_all(&mut self, expression: &Expression) -> Option<Vec<Option<Via>>> {
        let Expression::CallExpression(call) = expression.get_inner_expression() else { return None };
        if !call.callee.get_inner_expression().is_specific_member_access("Promise", "all") {
            return None;
        }
        let Some(Argument::ArrayExpression(array)) = call.arguments.first() else { return None };
        let mut held = Vec::new();
        for element in &array.elements {
            match element {
                ArrayExpressionElement::SpreadElement(_) => break,
                ArrayExpressionElement::Elision(_) => held.push(None),
                _ => held.push(element.as_expression().and_then(|it| self.promised(it))),
            }
        }
        Some(held)
    }

    /// What binding a pattern to `request` takes: a holder, or the names it
    /// destructures, and a rest holds what the names left.
    fn bind(&mut self, pattern: &BindingPattern, request: Via) {
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
                if let Some(rest) = &it.rest {
                    self.bind(&rest.argument, request);
                }
            }
            BindingPattern::AssignmentPattern(it) => self.bind(&it.left, request),
            BindingPattern::ArrayPattern(_) => {}
        }
    }

    /// Binding an array pattern to what `Promise.all` resolves to: element `i`
    /// of the pattern takes the request element `i` of the array holds.
    fn bind_all(&mut self, pattern: &BindingPattern, held: &[Option<Via>]) {
        let pattern = match pattern {
            BindingPattern::AssignmentPattern(it) => &it.left,
            other => other,
        };
        let BindingPattern::ArrayPattern(array) = pattern else { return };
        for (element, request) in array.elements.iter().zip(held) {
            if let (Some(element), Some(request)) = (element, request) {
                self.bind(element, *request);
            }
        }
    }

    fn add(&mut self, request: Via, name: &str, at: u32) {
        self.found.insert((request, name.to_owned(), self.lines.at(at)));
    }
}

impl<'a> Visit<'a> for Walker<'_> {
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let Some(init) = &it.init {
            if let Some(held) = self.held_all(init) {
                self.bind_all(&it.id, &held);
            } else if let Some(request) = self.held(init) {
                self.bind(&it.id, request);
            }
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
        if let Some(index) = self.loads.import_equals(it) {
            if !it.import_kind.is_type() {
                self.holders.insert(it.id.name.to_string(), Via::Required(index));
            }
        }
        walk::walk_ts_import_equals_declaration(self, it);
    }

    // `import('m').then((m) => …)`: the callback's first parameter holds the
    // module, and `Promise.all([import('m')]).then(([m]) => …)` pairs as `await` does.
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        self.loads.call(it, self.mock_factory.as_deref());
        if let Some(target) = crate::mocks::factory_target(it) {
            self.visit_expression(&it.callee);
            for (index, argument) in it.arguments.iter().enumerate() {
                if index == 1 {
                    let previous = self.mock_factory.replace(target.clone());
                    self.visit_argument(argument);
                    self.mock_factory = previous;
                } else {
                    self.visit_argument(argument);
                }
            }
            return;
        }
        if let Expression::StaticMemberExpression(callee) = it.callee.get_inner_expression() {
            if callee.property.name == "then" {
                let first = match it.arguments.first() {
                    Some(Argument::ArrowFunctionExpression(f)) => f.params.items.first(),
                    Some(Argument::FunctionExpression(f)) => f.params.items.first(),
                    _ => None,
                };
                if let Some(parameter) = first {
                    if let Some(held) = self.promised_all(&callee.object) {
                        self.bind_all(&parameter.pattern, &held);
                    } else if let Some(request) = self.promised(&callee.object) {
                        self.bind(&parameter.pattern, request);
                    }
                }
            }
        }
        walk::walk_call_expression(self, it);
    }
}
