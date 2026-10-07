//! The `require` calls a module makes, read off the tree `read_module` already
//! holds, because the module record lists none of them.
//!
//! A call is one whose callee is the identifier `require`, so a comment, a
//! string or a template's text that spells one is not, and neither is
//! `require.resolve`, which names a file without loading it. Its specifier is a
//! string or a template with no expressions; any other first argument is a call
//! this counts and cannot read. `import x = require('y')` is TypeScript's
//! spelling of the same load, and its specifier is always a string.

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};

use crate::read::{Kind, Lines, Request};

pub(crate) struct Required {
    pub(crate) requests: Vec<Request>,
    /// The calls whose specifier is not a constant.
    pub(crate) unread: usize,
}

pub(crate) fn requires_in(program: &Program, lines: &Lines) -> Required {
    let mut walker = Walker { lines, found: Required { requests: Vec::new(), unread: 0 } };
    walker.visit_program(program);
    walker.found
}

struct Walker<'l> {
    lines: &'l Lines,
    found: Required,
}

impl Walker<'_> {
    fn push(&mut self, value: &str, at: u32) {
        self.found.requests.push(Request {
            value: value.to_owned(),
            kind: Kind::Imports,
            bindings: Vec::new(),
            line: self.lines.at(at),
        });
    }
}

impl<'a> Visit<'a> for Walker<'_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if matches!(&it.callee, Expression::Identifier(callee) if callee.name == "require") {
            match it.arguments.first().and_then(constant) {
                Some(value) => self.push(value, it.span.start),
                None => self.found.unread += 1,
            }
        }
        walk::walk_call_expression(self, it);
    }

    fn visit_ts_import_equals_declaration(&mut self, it: &TSImportEqualsDeclaration<'a>) {
        if let TSModuleReference::ExternalModuleReference(reference) = &it.module_reference {
            self.push(reference.expression.value.as_str(), reference.span.start);
        }
        walk::walk_ts_import_equals_declaration(self, it);
    }
}

fn constant<'s>(argument: &'s Argument) -> Option<&'s str> {
    match argument {
        Argument::StringLiteral(it) => Some(it.value.as_str()),
        Argument::TemplateLiteral(it) if it.expressions.is_empty() => {
            it.quasis.first()?.value.cooked.as_ref().map(|cooked| cooked.as_str())
        }
        _ => None,
    }
}
