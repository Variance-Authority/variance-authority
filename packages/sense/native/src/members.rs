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

use std::collections::{BTreeSet, HashMap, HashSet};

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
    /// The name is read off the module's `default`, which under interop is a
    /// CommonJS module's `module.exports`: `(await import('m')).default.name`.
    #[serde(rename = "throughDefault", skip_serializing_if = "std::ops::Not::not")]
    pub(crate) through_default: bool,
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
                holders.insert(binding.local.clone(), Held::whole(Via::Indexed(index as u32)));
            }
        }
    }
    let mut walker = Walker {
        lines,
        holders,
        stated: requests.len() as u32,
        loads: Loads::new(lines),
        found: BTreeSet::new(),
        followed: HashSet::new(),
        mock_factory: None,
    };
    walker.visit_program(program);
    // A required request's index is known only once the walk has met every `import()`.
    let required = walker.stated + walker.loads.dynamic.len() as u32;
    let members: BTreeSet<Member> = walker
        .found
        .into_iter()
        .map(|(held, name, line)| Member { request: held.via.index(required), name, line, through_default: held.off })
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

/// What a value holds: the module a request loads, or, `off`, that module's
/// `default`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Held {
    via: Via,
    off: bool,
}

impl Held {
    fn whole(via: Via) -> Self {
        Held { via, off: false }
    }

    fn default(self) -> Option<Self> {
        (!self.off).then_some(Held { via: self.via, off: true })
    }
}

/// The token a member read takes when the module goes somewhere the walk does
/// not follow, as a binding takes it for the namespace whole.
const WHOLE: &str = "*";

struct Walker<'l> {
    lines: &'l Lines,
    /// A local name to what it holds.
    holders: HashMap<String, Held>,
    /// How many requests the record states, which the `import()` ones follow.
    stated: u32,
    loads: Loads<'l>,
    mock_factory: Option<String>,
    found: BTreeSet<(Held, String, u32)>,
    /// Where an `import()` or a holder is read in a way the walk follows, by
    /// the offset it starts at: anywhere else, the module escapes whole.
    followed: HashSet<u32>,
}

impl Walker<'_> {
    /// What an expression evaluates to, looking through parentheses,
    /// TypeScript's casts and `await`: an awaited `import()`, a holder, or the
    /// `default` of either.
    fn held(&mut self, expression: &Expression) -> Option<Held> {
        match expression.get_inner_expression() {
            Expression::AwaitExpression(it) => self.promised(&it.argument).map(Held::whole).or_else(|| self.held(&it.argument)),
            Expression::Identifier(it) => {
                let held = self.holders.get(it.name.as_str()).copied()?;
                self.followed.insert(it.span.start);
                Some(held)
            }
            Expression::StaticMemberExpression(it) if it.property.name == "default" => self.held(&it.object)?.default(),
            _ => None,
        }
    }

    /// The request an `import()` promises. The promise is not the module: a read
    /// off it, `.then` among them, is the promise's own.
    fn promised(&mut self, expression: &Expression) -> Option<Via> {
        match expression.get_inner_expression() {
            Expression::ImportExpression(it) => {
                self.followed.insert(it.span.start);
                self.loads.import(it).map(|index| Via::Indexed(self.stated + index))
            }
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
        let array = all_of(expression)?;
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

    /// An expression whose value is thrown away: an `import()` there, awaited
    /// or not, is run for its side effects, and reads no name.
    fn discarded(&mut self, expression: &Expression) {
        let expression = match expression.get_inner_expression() {
            Expression::AwaitExpression(it) => it.argument.get_inner_expression(),
            Expression::UnaryExpression(it) if it.operator.is_void() => it.argument.get_inner_expression(),
            other => other,
        };
        if let Some(array) = all_of(expression) {
            for element in array.elements.iter().filter_map(ArrayExpressionElement::as_expression) {
                self.promise_read(element);
            }
        }
        self.promise_read(expression);
    }

    /// An `import()` whose promise is read, not passed on: what it loads goes nowhere.
    fn promise_read(&mut self, expression: &Expression) {
        if let Expression::ImportExpression(it) = expression.get_inner_expression() {
            self.followed.insert(it.span.start);
        }
    }

    /// What binding a pattern to `held` takes: a holder, or the names it
    /// destructures, and a rest holds what the names left. `default`
    /// destructured further holds the module's default; a key the walk cannot
    /// spell, or an array pattern, reads the module whole.
    fn bind(&mut self, pattern: &BindingPattern, held: Held) {
        match pattern {
            BindingPattern::BindingIdentifier(it) => {
                self.holders.insert(it.name.to_string(), held);
            }
            BindingPattern::ObjectPattern(it) => {
                for property in &it.properties {
                    let Some(name) = property.key.static_name() else {
                        self.add(held, WHOLE, property.span.start);
                        continue;
                    };
                    self.add(held, &name, property.span.start);
                    if let Some(default) = held.default().filter(|_| name == "default") {
                        self.bind(&property.value, default);
                    }
                }
                if let Some(rest) = &it.rest {
                    self.bind(&rest.argument, held);
                }
            }
            BindingPattern::AssignmentPattern(it) => self.bind(&it.left, held),
            BindingPattern::ArrayPattern(it) => self.add(held, WHOLE, it.span.start),
        }
    }

    /// Binding a pattern to what `Promise.all` resolves to: element `i` of the
    /// pattern takes the request element `i` of the array holds, and a rest, or
    /// a pattern that is not an array, holds the modules it gets whole.
    fn bind_all(&mut self, pattern: &BindingPattern, held: &[Option<Via>]) {
        let pattern = match pattern {
            BindingPattern::AssignmentPattern(it) => &it.left,
            other => other,
        };
        let BindingPattern::ArrayPattern(array) = pattern else {
            let at = oxc_span::GetSpan::span(pattern).start;
            for request in held.iter().flatten() {
                self.add(Held::whole(*request), WHOLE, at);
            }
            return;
        };
        for (index, request) in held.iter().enumerate() {
            let Some(request) = *request else { continue };
            match (array.elements.get(index), &array.rest) {
                (Some(Some(element)), _) => self.bind(element, Held::whole(request)),
                (None, Some(rest)) => self.add(Held::whole(request), WHOLE, rest.span.start),
                _ => {}
            }
        }
    }

    /// `bind` for an assignment, whose target is a reference rather than a declaration.
    fn assign(&mut self, target: &AssignmentTarget, held: Held) {
        match target {
            AssignmentTarget::AssignmentTargetIdentifier(it) => {
                self.followed.insert(it.span.start);
                self.holders.insert(it.name.to_string(), held);
            }
            AssignmentTarget::ObjectAssignmentTarget(it) => {
                for property in &it.properties {
                    match property {
                        AssignmentTargetProperty::AssignmentTargetPropertyIdentifier(it) => self.add(held, &it.binding.name, it.span.start),
                        AssignmentTargetProperty::AssignmentTargetPropertyProperty(it) => {
                            let Some(name) = it.name.static_name() else {
                                self.add(held, WHOLE, it.span.start);
                                continue;
                            };
                            self.add(held, &name, it.span.start);
                            if let (Some(default), Some(target)) = (held.default().filter(|_| name == "default"), target_of(&it.binding)) {
                                self.assign(target, default);
                            }
                        }
                    }
                }
                if let Some(rest) = &it.rest {
                    self.assign(&rest.target, held);
                }
            }
            AssignmentTarget::ArrayAssignmentTarget(it) => self.add(held, WHOLE, it.span.start),
            _ => {}
        }
    }

    /// `bind_all` for an assignment.
    fn assign_all(&mut self, target: &AssignmentTarget, held: &[Option<Via>]) {
        let AssignmentTarget::ArrayAssignmentTarget(array) = target else {
            let at = oxc_span::GetSpan::span(target).start;
            for request in held.iter().flatten() {
                self.add(Held::whole(*request), WHOLE, at);
            }
            return;
        };
        for (index, request) in held.iter().enumerate() {
            let Some(request) = *request else { continue };
            match (array.elements.get(index), &array.rest) {
                (Some(Some(element)), _) => {
                    if let Some(target) = target_of(element) {
                        self.assign(target, Held::whole(request));
                    }
                }
                (None, Some(rest)) => self.add(Held::whole(request), WHOLE, rest.span.start),
                _ => {}
            }
        }
    }

    fn add(&mut self, held: Held, name: &str, at: u32) {
        self.found.insert((held, name.to_owned(), self.lines.at(at)));
    }
}

/// The array of `Promise.all([...])`.
fn all_of<'e, 'a>(expression: &'e Expression<'a>) -> Option<&'e ArrayExpression<'a>> {
    let Expression::CallExpression(call) = expression.get_inner_expression() else { return None };
    if !call.callee.get_inner_expression().is_specific_member_access("Promise", "all") {
        return None;
    }
    match call.arguments.first() {
        Some(Argument::ArrayExpression(array)) => Some(array),
        _ => None,
    }
}

/// The target an assignment pattern's element writes, past its default.
fn target_of<'e, 'a>(element: &'e AssignmentTargetMaybeDefault<'a>) -> Option<&'e AssignmentTarget<'a>> {
    match element {
        AssignmentTargetMaybeDefault::AssignmentTargetWithDefault(it) => Some(&it.binding),
        other => other.as_assignment_target(),
    }
}

/// A destructuring target that can take a module: a name, or a pattern.
fn takes(target: &AssignmentTarget) -> bool {
    matches!(
        target,
        AssignmentTarget::AssignmentTargetIdentifier(_) | AssignmentTarget::ObjectAssignmentTarget(_) | AssignmentTarget::ArrayAssignmentTarget(_)
    )
}

impl<'a> Visit<'a> for Walker<'_> {
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let Some(init) = &it.init {
            if let Some(held) = self.held_all(init) {
                self.bind_all(&it.id, &held);
            } else if let Some(held) = self.held(init) {
                self.bind(&it.id, held);
            } else if !matches!(it.id, BindingPattern::BindingIdentifier(_)) {
                // A pattern destructures the promise, which reads it and holds nothing.
                self.promise_read(init);
            }
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_assignment_expression(&mut self, it: &AssignmentExpression<'a>) {
        if it.operator == AssignmentOperator::Assign && takes(&it.left) {
            if let Some(held) = self.held_all(&it.right) {
                self.assign_all(&it.left, &held);
            } else if let Some(held) = self.held(&it.right) {
                self.assign(&it.left, held);
            }
        }
        walk::walk_assignment_expression(self, it);
    }

    fn visit_expression_statement(&mut self, it: &ExpressionStatement<'a>) {
        self.discarded(&it.expression);
        walk::walk_expression_statement(self, it);
    }

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        if let Some(held) = self.held(&it.object) {
            self.add(held, &it.property.name, it.property.span.start);
        } else if !matches!(it.property.name.as_str(), "then" | "catch" | "finally") {
            self.promise_read(&it.object);
        }
        walk::walk_static_member_expression(self, it);
    }

    fn visit_computed_member_expression(&mut self, it: &ComputedMemberExpression<'a>) {
        // A key the walk cannot spell reads the module whole: the object is not followed.
        if let Expression::StringLiteral(name) = &it.expression {
            if let Some(held) = self.held(&it.object) {
                self.add(held, &name.value, name.span.start);
            } else {
                self.promise_read(&it.object);
            }
        }
        walk::walk_computed_member_expression(self, it);
    }

    fn visit_jsx_member_expression(&mut self, it: &JSXMemberExpression<'a>) {
        if let JSXMemberExpressionObject::IdentifierReference(object) = &it.object {
            if let Some(held) = self.holders.get(object.name.as_str()).copied() {
                self.followed.insert(object.span.start);
                self.add(held, &it.property.name, it.property.span.start);
            }
        }
        walk::walk_jsx_member_expression(self, it);
    }

    // `ns.T` in a type is a qualified name, which this reader does not list:
    // it is not the namespace escaping either.
    fn visit_ts_qualified_name(&mut self, it: &TSQualifiedName<'a>) {
        if let TSTypeName::IdentifierReference(left) = &it.left {
            self.followed.insert(left.span.start);
        }
        walk::walk_ts_qualified_name(self, it);
    }

    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        if let Some(held) = self.holders.get(it.name.as_str()).copied() {
            if !self.followed.contains(&it.span.start) {
                self.add(held, WHOLE, it.span.start);
            }
        }
    }

    fn visit_import_expression(&mut self, it: &ImportExpression<'a>) {
        if let Some(index) = self.loads.import(it) {
            if !self.followed.contains(&it.span.start) {
                self.add(Held::whole(Via::Indexed(self.stated + index)), WHOLE, it.span.start);
            }
        }
        walk::walk_import_expression(self, it);
    }

    fn visit_ts_import_equals_declaration(&mut self, it: &TSImportEqualsDeclaration<'a>) {
        if let Some(index) = self.loads.import_equals(it) {
            if !it.import_kind.is_type() {
                self.holders.insert(it.id.name.to_string(), Held::whole(Via::Required(index)));
            }
        }
        walk::walk_ts_import_equals_declaration(self, it);
    }

    // `import('m').then((m) => …)`: the callback's first parameter holds the
    // module, and `Promise.all([import('m')]).then(([m]) => …)` pairs as `await`
    // does. A callback that is not written there takes the module whole.
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
                    Some(Argument::ArrowFunctionExpression(f)) => Some(f.params.items.first()),
                    Some(Argument::FunctionExpression(f)) => Some(f.params.items.first()),
                    _ => None,
                };
                if let Some(parameter) = first {
                    if let Some(held) = self.promised_all(&callee.object) {
                        if let Some(parameter) = parameter {
                            self.bind_all(&parameter.pattern, &held);
                        }
                    } else if let Some(request) = self.promised(&callee.object) {
                        if let Some(parameter) = parameter {
                            self.bind(&parameter.pattern, Held::whole(request));
                        }
                    }
                }
            }
        }
        walk::walk_call_expression(self, it);
    }
}
