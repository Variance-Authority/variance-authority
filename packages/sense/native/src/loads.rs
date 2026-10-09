//! The modules a module loads by calling for them — `import()`, `require()`,
//! `module.require()` and TypeScript's `import x = require()` — read off the tree
//! `read_module` already holds. The module record lists no `require` and gives an
//! `import()` only as a span of text.
//!
//! A load is read where the tree has one, so a comment, a string or a template's
//! text that spells one is not. A `require` is the identifier `require`, or the
//! member `module.require`; another object's `require` is that object's method,
//! and `require.resolve` names a file without loading it. A specifier is a
//! constant, a string or a template with no expressions, and any other is a load
//! this counts and cannot read. `import x = require('y')` is TypeScript's
//! spelling of a `require`, and its specifier is always a string.
//!
//! This holds what one walk finds and walks nothing itself: the walk in
//! [`members`](crate::members) drives it, because a name read through an
//! `import()` needs that call's request, and one walk answers both.

use std::collections::HashMap;

use oxc_ast::ast::*;

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
    /// Each `import()` met so far, by its start offset, and its index in `dynamic`.
    met: HashMap<u32, Option<u32>>,
}

impl<'l> Loads<'l> {
    pub(crate) fn new(lines: &'l Lines) -> Self {
        Self { lines, dynamic: Vec::new(), unread_dynamic: 0, required: Vec::new(), unread_required: 0, met: HashMap::new() }
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

    pub(crate) fn call(&mut self, it: &CallExpression) {
        if !requires(&it.callee) {
            return;
        }
        match it.arguments.first().and_then(Argument::as_expression).and_then(constant) {
            Some(value) => self.required.push(self.request(value, Kind::Imports, it.span.start)),
            None => self.unread_required += 1,
        }
    }

    pub(crate) fn import_equals(&mut self, it: &TSImportEqualsDeclaration) {
        if let TSModuleReference::ExternalModuleReference(reference) = &it.module_reference {
            self.required.push(self.request(&reference.expression.value, Kind::Imports, reference.span.start));
        }
    }

    fn request(&self, value: &str, kind: Kind, at: u32) -> Request {
        Request { value: value.to_owned(), kind, bindings: Vec::new(), line: self.lines.at(at) }
    }
}

/// Whether a call's callee loads a module: `require` itself, or `module.require`.
/// Every reader that asks what a require is asks this.
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

/// A specifier written as a constant: a string, or a template with no
/// expressions, as its cooked text.
pub(crate) fn constant<'s>(expression: &'s Expression) -> Option<&'s str> {
    match expression {
        Expression::StringLiteral(it) => Some(it.value.as_str()),
        Expression::TemplateLiteral(it) if it.expressions.is_empty() => {
            it.quasis.first()?.value.cooked.as_ref().map(|cooked| cooked.as_str())
        }
        _ => None,
    }
}
