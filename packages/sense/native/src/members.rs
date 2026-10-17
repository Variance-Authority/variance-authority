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
//! reads as the whole module to anything that charges a change. A holder is the
//! binding, resolved by scope, so a parameter that reuses its name is another
//! value. Where the module goes on whole — read as a value anywhere the walk
//! does not follow — the read is `*`: a write or a type query is not one. The
//! module's `default` is a value of the module, so it moving is a use of
//! `default` and no more; a name read off it is read through `default`.
//!
//! The same walk reads the [`Loads`]: an `import()` is a request only the tree
//! can read, and a member read through it needs that request's index, so the
//! module's tree is walked once for both.

use std::collections::{BTreeSet, HashMap, HashSet};

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_syntax::symbol::SymbolId;
use serde::Serialize;

use crate::loads::Loads;
use crate::read::{Lines, Request};

#[path = "members_bind.rs"]
mod bind;
use bind::takes;

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
    let namespaces: Vec<(&str, u32)> = requests
        .iter()
        .enumerate()
        .flat_map(|(index, request)| request.bindings.iter().map(move |binding| (index, binding)))
        .filter(|(_, binding)| binding.imported == "*" && !binding.type_only)
        .map(|(index, binding)| (binding.local.as_str(), index as u32))
        .collect();
    // Scopes are resolved only for a file that holds a module whole.
    let built = (!namespaces.is_empty() || loads_any(program)).then(|| SemanticBuilder::new().build(program));
    let scoping = built.as_ref().map(|built| built.semantic.scoping());
    let mut holders = HashMap::new();
    if let Some(scoping) = scoping {
        for (local, index) in namespaces {
            if let Some(symbol) = scoping.get_root_binding(local.into()) {
                holders.insert(symbol, Held::whole(Via::Indexed(index)));
            }
        }
    }
    let mut walker = Walker {
        lines,
        scoping,
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

    /// The module's `default`. Interop nests one level, so the `default` of
    /// a `default` is the same level: `ns.default.default.x` reads `x` through it.
    fn default(self) -> Option<Self> {
        Some(Held { via: self.via, off: true })
    }
}

/// The token a member read takes when the module goes somewhere the walk does
/// not follow, as a binding takes it for the namespace whole.
const WHOLE: &str = "*";

struct Walker<'l, 's> {
    lines: &'l Lines,
    /// The file's scopes, when it holds a module whole at all.
    scoping: Option<&'s Scoping>,
    /// A binding to what it holds.
    holders: HashMap<SymbolId, Held>,
    /// How many requests the record states, which the `import()` ones follow.
    stated: u32,
    loads: Loads<'l>,
    mock_factory: Option<String>,
    found: BTreeSet<(Held, String, u32)>,
    /// Where an `import()` or a holder is read in a way the walk follows, by
    /// the offset it starts at: anywhere else, the module escapes whole.
    followed: HashSet<u32>,
}

impl Walker<'_, '_> {
    /// What an expression evaluates to, looking through parentheses,
    /// TypeScript's casts and `await`: an awaited `import()`, a holder, or the
    /// `default` of either.
    fn held(&mut self, expression: &Expression) -> Option<Held> {
        match expression.get_inner_expression() {
            Expression::AwaitExpression(it) => self.promised(&it.argument).map(Held::whole).or_else(|| self.held(&it.argument)),
            Expression::Identifier(it) => {
                let held = self.holder(it)?;
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
        match handed_on(expression) {
            Expression::ImportExpression(it) => {
                self.followed.insert(it.span.start);
                self.loads.import(it).map(|index| Via::Indexed(self.stated + index))
            }
            _ => None,
        }
    }

    /// What a reference's binding holds.
    fn holder(&self, it: &IdentifierReference) -> Option<Held> {
        let symbol = self.symbol_of(it)?;
        self.holders.get(&symbol).copied()
    }

    fn symbol_of(&self, it: &IdentifierReference) -> Option<SymbolId> {
        let scoping = self.scoping?;
        scoping.get_reference(it.reference_id.get()?).symbol_id()
    }

    fn hold(&mut self, symbol: Option<SymbolId>, held: Held) {
        if let Some(symbol) = symbol {
            self.holders.insert(symbol, held);
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
        if let Expression::ImportExpression(it) = handed_on(expression) {
            self.followed.insert(it.span.start);
        }
    }

    /// A name read off what is held. Off the `default`, the value going on
    /// whole is the `default` moving, a use already recorded, and its own
    /// `default` is the same level.
    fn add(&mut self, held: Held, name: &str, at: u32) {
        if held.off && (name == WHOLE || name == "default") {
            return;
        }
        self.found.insert((held, name.to_owned(), self.lines.at(at)));
    }
}

/// The promise an expression hands on: `.catch(…)` and `.finally(…)` settle
/// to the same module, so `import('m').catch(…)` is still `import('m')`.
fn handed_on<'e, 'a>(expression: &'e Expression<'a>) -> &'e Expression<'a> {
    let mut expression = expression.get_inner_expression();
    while let Expression::CallExpression(call) = expression {
        let Expression::StaticMemberExpression(callee) = call.callee.get_inner_expression() else { break };
        if !matches!(callee.property.name.as_str(), "catch" | "finally") {
            break;
        }
        expression = callee.object.get_inner_expression();
    }
    expression
}

/// Whether a file calls `import()` or writes `import m = require()` anywhere.
fn loads_any(program: &Program) -> bool {
    struct Finds(bool);
    impl<'a> Visit<'a> for Finds {
        fn visit_import_expression(&mut self, _: &ImportExpression<'a>) {
            self.0 = true;
        }
        fn visit_ts_import_equals_declaration(&mut self, _: &TSImportEqualsDeclaration<'a>) {
            self.0 = true;
        }
    }
    let mut finds = Finds(false);
    finds.visit_program(program);
    finds.0
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

impl<'a> Visit<'a> for Walker<'_, '_> {
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
            if let Some(held) = self.holder(object) {
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

    // Read as a value where the walk does not follow it, the module goes on
    // whole. A write replaces the value, and a type query reads its type.
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        let (Some(scoping), Some(reference)) = (self.scoping, it.reference_id.get()) else { return };
        let reference = scoping.get_reference(reference);
        let flags = reference.flags();
        if !flags.is_read() || flags.is_type() || flags.is_value_as_type() || self.followed.contains(&it.span.start) {
            return;
        }
        if let Some(held) = reference.symbol_id().and_then(|symbol| self.holders.get(&symbol).copied()) {
            self.add(held, WHOLE, it.span.start);
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
                self.hold(it.id.symbol_id.get(), Held::whole(Via::Required(index)));
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
