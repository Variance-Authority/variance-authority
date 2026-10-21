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
//! TypeScript compiles it to does; a type-only one holds nothing. A default
//! import holds the module's `default`, which under interop is a CommonJS
//! module's `module.exports`. An `import()` type reads the name its qualifier
//! starts with, `import('m').x.y` reads `x`; with none, as in `typeof
//! import('m')`, it names the module's type and reads nothing, and what that
//! type is written on holds the module: a cast, an annotated variable or
//! parameter, or one typed by a top-level alias of it. A qualified name off a
//! holder in a type, `typeof ns.x` or `ns.T`, reads its first name, as `ns.x`
//! does in a value.
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
use oxc_semantic::Scoping;
use oxc_syntax::symbol::SymbolId;
use serde::Serialize;

use crate::loads::Loads;
use crate::read::{Lines, Request};

#[path = "members_bind.rs"]
mod bind;
use bind::takes;

#[path = "members_typed.rs"]
mod typed;

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
/// read through an `import m = require()` as if `loads.required` followed those,
/// and one read through an `import()` type as if `loads.typed` followed those.
/// `dynamic` is whether the module record lists any `import()`.
pub fn members_and_loads_in<'l>(program: &Program, scoping: &Scoping, lines: &'l Lines, requests: &[Request]) -> (Vec<Member>, Loads<'l>) {
    let mut holders = HashMap::new();
    for (index, request) in requests.iter().enumerate() {
        for binding in request.bindings.iter().filter(|binding| !binding.type_only) {
            let held = match binding.imported.as_str() {
                "*" => Held::whole(Via::Indexed(index as u32)),
                "default" => Held::whole(Via::Indexed(index as u32)).default(),
                _ => continue,
            };
            if let Some(symbol) = scoping.get_root_binding(binding.local.as_str().into()) {
                holders.insert(symbol, held);
            }
        }
    }
    let mut walker = Walker {
        lines,
        scoping,
        holders,
        aliases: typed::aliases(program),
        typed_at: HashMap::new(),
        stated: requests.len() as u32,
        loads: Loads::new(lines),
        found: BTreeSet::new(),
        followed: HashSet::new(),
        mock_factory: None,
    };
    walker.visit_program(program);
    // A required request's index is known only once the walk has met every `import()`.
    let required = walker.stated + walker.loads.dynamic.len() as u32;
    let typed = required + walker.loads.required.len() as u32;
    let typed_at = &walker.typed_at;
    let members: BTreeSet<Member> = walker
        .found
        .into_iter()
        .filter_map(|(held, name, line)| Some(Member { request: held.via.index(required, typed, typed_at)?, name, line, through_default: held.off }))
        .collect();
    (members.into_iter().collect(), walker.loads)
}

/// The request a holder reads through: its index in the parse, its index in
/// `loads.required`, which the parse appends after every `import()`, or its
/// index in `loads.typed`, which the parse appends after those, or the
/// `import()` type starting at an offset, whose index the walk may meet later.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Via {
    Indexed(u32),
    Required(u32),
    Typed(u32),
    TypedAt(u32),
}

impl Via {
    fn index(self, required: u32, typed: u32, typed_at: &HashMap<u32, u32>) -> Option<u32> {
        Some(match self {
            Via::Indexed(index) => index,
            Via::Required(index) => required + index,
            Via::Typed(index) => typed + index,
            Via::TypedAt(at) => typed + typed_at.get(&at)?,
        })
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
    fn default(self) -> Self {
        Held { via: self.via, off: true }
    }
}

/// The token a member read takes when the module goes somewhere the walk does
/// not follow, as a binding takes it for the namespace whole.
const WHOLE: &str = "*";

struct Walker<'l, 's> {
    lines: &'l Lines,
    scoping: &'s Scoping,
    /// A binding to what it holds.
    holders: HashMap<SymbolId, Held>,
    /// A top-level alias of `typeof import()`, to where its `import()` type starts.
    aliases: HashMap<SymbolId, u32>,
    /// Where each `import()` type the walk has met starts, to its index in `loads.typed`.
    typed_at: HashMap<u32, u32>,
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
            Expression::StaticMemberExpression(it) if it.property.name == "default" => self.held(&it.object).map(Held::default),
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
        self.scoping.get_reference(it.reference_id.get()?).symbol_id()
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
        let annotated = it.type_annotation.as_ref().and_then(|it| self.typed(&it.type_annotation));
        if let Some(init) = &it.init {
            if let Some(held) = self.held_all(init) {
                self.bind_all(&it.id, &held);
            } else if let Some(held) = self.held(init).or(annotated).or_else(|| self.cast(init)) {
                self.bind(&it.id, held);
            } else if !matches!(it.id, BindingPattern::BindingIdentifier(_)) {
                // A pattern destructures the promise, which reads it and holds nothing.
                self.promise_read(init);
            }
        } else if let Some(held) = annotated {
            self.bind(&it.id, held);
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

    // An exported holder is the module handed to every importer of this file,
    // where the walk does not follow it: it goes on whole at its binding.
    fn visit_export_declaration(&mut self, it: &ExportDeclaration<'a>) {
        walk::walk_export_declaration(self, it);
        let bindings = match &it.declaration {
            Declaration::VariableDeclaration(declaration) => declaration.declarations.iter().flat_map(|it| it.id.get_binding_identifiers()).collect(),
            Declaration::TSImportEqualsDeclaration(declaration) => vec![&declaration.id],
            _ => Vec::new(),
        };
        for binding in bindings {
            if let Some(held) = binding.symbol_id.get().and_then(|symbol| self.holders.get(&symbol).copied()) {
                self.add(held, WHOLE, binding.span.start);
            }
        }
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

    // `ns.T` in a type reads `T` off the holder, and `ns.a.b` reads `a`: the
    // name nearest the holder is the one the module exports.
    fn visit_ts_qualified_name(&mut self, it: &TSQualifiedName<'a>) {
        if let TSTypeName::IdentifierReference(left) = &it.left {
            self.followed.insert(left.span.start);
            if let Some(held) = self.holder(left) {
                self.add(held, &it.right.name, it.right.span.start);
            }
        }
        walk::walk_ts_qualified_name(self, it);
    }

    // Read as a value where the walk does not follow it, the module goes on
    // whole. A write replaces the value, and a type query reads its type.
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        let Some(reference) = it.reference_id.get() else { return };
        let reference = self.scoping.get_reference(reference);
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

    fn visit_ts_import_type(&mut self, it: &TSImportType<'a>) {
        let index = self.loads.import_type(it);
        self.typed_at.insert(it.span.start, index);
        let mut qualifier = it.qualifier.as_ref();
        while let Some(TSImportTypeQualifier::QualifiedName(name)) = qualifier {
            qualifier = Some(&name.left);
        }
        if let Some(TSImportTypeQualifier::Identifier(name)) = qualifier {
            self.add(Held::whole(Via::Typed(index)), &name.name, it.span.start);
        }
        walk::walk_ts_import_type(self, it);
    }

    fn visit_formal_parameter(&mut self, it: &FormalParameter<'a>) {
        if let Some(held) = it.type_annotation.as_ref().and_then(|it| self.typed(&it.type_annotation)) {
            self.bind(&it.pattern, held);
        }
        walk::walk_formal_parameter(self, it);
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
