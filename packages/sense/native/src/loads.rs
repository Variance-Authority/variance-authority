//! The modules a module loads by calling for them — `import()`, `require()`,
//! `module.require()` and TypeScript's `import x = require()` — and the ones it
//! names in an `import()` type, read off the tree `read_module` already holds.
//! The module record lists no `require`, gives an `import()` only as a span of
//! text, and holds no type at all.
//!
//! A load is read where the tree has one, so a comment, a string or a template's
//! text that spells one is not. A `require` is the identifier `require`, or the
//! member `module.require`, or a function Node's `createRequire` made: called
//! where it is made, or through a `const` the call is bound to, whatever its
//! name. Another object's `require` is that object's method, and
//! `require.resolve` names a file without loading it. A specifier is a
//! constant, a string or a template with no expressions, and any other is a load
//! this counts and cannot read. `import x = require('y')` is TypeScript's
//! spelling of a `require`, and its specifier is always a string.
//!
//! `import('./x').T` and `typeof import('./x')` are TypeScript's other spelling
//! of `import type`: the compiler resolves the specifier as it resolves an
//! import's, and erases it, so each is a `type` request, an edge every walk but a
//! runtime one follows. Its specifier is always a string.
//!
//! This holds what one walk finds and walks nothing itself: the walk in
//! [`members`](crate::members) drives it, because a name read through an
//! `import()` needs that call's request, and one walk answers both.

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::Scoping;
use oxc_syntax::reference::ReferenceId;

use crate::read::{Kind, Lines, Request};

pub(crate) struct Loads<'l> {
    lines: &'l Lines,
    /// The `import()` requests, in the order the walk first met each call.
    pub(crate) dynamic: Vec<Request>,
    /// The `import()` calls whose specifier is not a constant.
    pub(crate) unread_dynamic: usize,
    pub(crate) required: Vec<Request>,
    /// The `require` calls whose specifier is not a constant.
    pub(crate) unread_required: usize,
    /// The `import()` types, in the order the walk met them.
    pub(crate) typed: Vec<Request>,
    /// The `import()` types whose specifier no text holds.
    pub(crate) unread_typed: usize,
    /// Each `import()` met so far, by its start offset, and its index in `dynamic`.
    met: HashMap<u32, Option<u32>>,
    requires: Requires,
}

impl<'l> Loads<'l> {
    pub(crate) fn new(lines: &'l Lines, requires: Requires) -> Self {
        Self { lines, dynamic: Vec::new(), unread_dynamic: 0, required: Vec::new(), unread_required: 0, typed: Vec::new(), unread_typed: 0, met: HashMap::new(), requires }
    }

    /// The index in `dynamic` of the request this call makes, read once however
    /// often the walk asks, and none when its specifier is not a constant.
    pub(crate) fn import(&mut self, it: &ImportExpression) -> Option<u32> {
        if let Some(index) = self.met.get(&it.span.start) {
            return *index;
        }
        let index = match constant(&it.source) {
            Some(value) => {
                self.dynamic.push(self.request(value, Kind::Dynamic, it.span.start));
                Some(self.dynamic.len() as u32 - 1)
            }
            None => {
                self.unread_dynamic += 1;
                None
            }
        };
        self.met.insert(it.span.start, index);
        index
    }

    // Forwarding a factory's own target cancels its replacement; it does not
    // request that module. Other targets remain ordinary written requests.
    pub(crate) fn call(&mut self, it: &CallExpression, factory: Option<&str>) {
        let here = match self.requires.load(&it.callee) {
            Some(Base::Here) => true,
            Some(Base::Elsewhere) => false,
            None => return,
        };
        match it.arguments.first().and_then(Argument::as_expression).and_then(constant).filter(|_| here) {
            Some(value) if factory != Some(value) => self.required.push(self.request(value, Kind::Imports, it.span.start)),
            Some(_) => {},
            None => self.unread_required += 1,
        }
    }

    /// The index in `required` of the request this declaration makes, and none
    /// when it aliases a namespace rather than requiring a module, or requires
    /// one no text holds.
    pub(crate) fn import_equals(&mut self, it: &TSImportEqualsDeclaration) -> Option<u32> {
        let TSModuleReference::ExternalModuleReference(reference) = &it.module_reference else { return None };
        let Some(value) = reference.expression.value.as_str() else {
            self.unread_required += 1;
            return None;
        };
        self.required.push(self.request(value, Kind::Imports, reference.span.start));
        Some(self.required.len() as u32 - 1)
    }

    /// The index in `typed` of the request an `import()` type makes. A factory's
    /// own target named in a type is still a request, unlike a `require` of it:
    /// the type loads nothing, so it cancels no replacement, and one no text
    /// holds is no request and is counted unread.
    pub(crate) fn import_type(&mut self, it: &TSImportType) -> Option<u32> {
        let Some(value) = it.source.value.as_str() else {
            self.unread_typed += 1;
            return None;
        };
        self.typed.push(self.request(value, Kind::Type, it.span.start));
        Some(self.typed.len() as u32 - 1)
    }

    fn request(&self, value: &str, kind: Kind, at: u32) -> Request {
        Request { value: value.to_owned(), kind, bindings: Vec::new(), line: self.lines.at(at), republishes: false }
    }
}

/// Whether a call's callee is spelled as a load: `require` itself, or
/// `module.require`. A reader with no scope asks this; one with scope asks
/// [`Requires::load`], which also knows what `createRequire` made.
pub(crate) fn requires(callee: &Expression) -> bool {
    match callee {
        Expression::Identifier(it) => it.name == "require",
        Expression::StaticMemberExpression(member) => {
            member.property.name == "require"
                && matches!(&member.object, Expression::Identifier(object) if object.name == "module")
        }
        _ => false,
    }
}

/// The functions a module's own `createRequire` made, by every reference that
/// reaches one: a call to `createRequire` imported by name from `node:module`
/// or `module`, called where it is made or through the `const` it is bound to.
/// The binding is resolved by scope, so a parameter or a local of the same name
/// is not one, and a `let` or a `var` is not followed: either can be assigned
/// again. A binding handed to another module is not followed either.
///
/// Such a function resolves a specifier from the file it was made for. Made for
/// this module's own file, `import.meta.url`, its specifier is read as a
/// `require`'s is; made for any other, it loads a module this cannot place, and
/// the load is counted unread, whatever the function is named.
#[derive(Default)]
pub(crate) struct Requires {
    /// The references to an imported `createRequire`.
    made_by: HashSet<ReferenceId>,
    /// The references to a `const` bound to what one of those calls returned, and where it resolves from.
    made: HashMap<ReferenceId, Base>,
}

/// Where a function `createRequire` made resolves a specifier from.
#[derive(Clone, Copy)]
pub(crate) enum Base {
    /// This module's own file, as `require` does.
    Here,
    /// A file this cannot place.
    Elsewhere,
}

impl Requires {
    pub(crate) fn of(program: &Program, scoping: &Scoping) -> Self {
        let mut requires = Self::default();
        for symbol in factories(program).filter_map(|local| local.symbol_id.get()) {
            requires.made_by.extend(scoping.get_resolved_reference_ids(symbol));
        }
        if !requires.made_by.is_empty() {
            let mut bound = Bound { requires: &mut requires, scoping };
            bound.visit_program(program);
        }
        requires
    }

    /// Whether a call's callee loads a module, and where its specifier resolves
    /// from: a function this module's `createRequire` made, whatever its name,
    /// or else one [`requires`] answers for. Parentheses and TypeScript's
    /// assertions around either are looked through.
    pub(crate) fn load(&self, callee: &Expression) -> Option<Base> {
        let made = match callee.get_inner_expression() {
            Expression::Identifier(it) => it.reference_id.get().and_then(|id| self.made.get(&id).copied()),
            Expression::CallExpression(call) => self.makes(call),
            _ => None,
        };
        made.or_else(|| requires(callee).then_some(Base::Here))
    }

    fn makes(&self, call: &CallExpression) -> Option<Base> {
        let Expression::Identifier(callee) = &call.callee else { return None };
        callee.reference_id.get().filter(|id| self.made_by.contains(id))?;
        let own = matches!(
            call.arguments.first().and_then(Argument::as_expression),
            Some(Expression::StaticMemberExpression(it)) if matches!(&it.object, Expression::ImportMeta(_)) && it.property.name == "url"
        );
        Some(if own { Base::Here } else { Base::Elsewhere })
    }
}

/// The local names a module imports Node's `createRequire` under, read off its
/// text alone, so a reader that has built no scope yet can ask whether it needs one.
pub(crate) fn factories<'p>(program: &'p Program) -> impl Iterator<Item = &'p BindingIdentifier<'p>> {
    program.body.iter().filter_map(|statement| match statement {
        Statement::ImportDeclaration(it) if it.import_kind.is_value() && matches!(it.source.value.as_str(), Some("node:module" | "module")) => it.specifiers.as_ref(),
        _ => None,
    }).flatten().filter_map(|specifier| match specifier {
        ImportDeclarationSpecifier::ImportSpecifier(it) if it.import_kind.is_value() && it.imported.name() == "createRequire" => Some(&it.local),
        _ => None,
    })
}

/// Each `const` a `createRequire` call is bound to, with its references.
struct Bound<'r, 's> {
    requires: &'r mut Requires,
    scoping: &'s Scoping,
}

impl<'a> Visit<'a> for Bound<'_, '_> {
    fn visit_variable_declaration(&mut self, it: &VariableDeclaration<'a>) {
        if it.kind == VariableDeclarationKind::Const {
            for declarator in &it.declarations {
                let Some(Expression::CallExpression(call)) = declarator.init.as_ref().map(Expression::get_inner_expression) else { continue };
                let (Some(base), BindingPattern::BindingIdentifier(id)) = (self.requires.makes(call), &declarator.id) else { continue };
                if let Some(symbol) = id.symbol_id.get() {
                    self.requires.made.extend(self.scoping.get_resolved_reference_ids(symbol).iter().map(|&reference| (reference, base)));
                }
            }
        }
        walk::walk_variable_declaration(self, it);
    }
}

/// A specifier written as a constant: a string, or a template with no
/// expressions, as its cooked text.
pub(crate) fn constant<'s>(expression: &'s Expression) -> Option<&'s str> {
    match expression {
        Expression::StringLiteral(it) => it.value.as_str(),
        Expression::TemplateLiteral(it) if it.expressions.is_empty() => {
            it.quasis.first()?.value.cooked.and_then(|cooked| cooked.as_str())
        }
        _ => None,
    }
}

#[cfg(test)]
#[path = "loads_tests.rs"]
mod tests;
