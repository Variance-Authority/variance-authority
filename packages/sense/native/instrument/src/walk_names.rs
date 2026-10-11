//! What a region is called: its step label, the scope name it is opened under,
//! and the name a function or class takes from where it is written.
//!
//! A name is spelled as JavaScript would print the key: a regular expression as
//! `String(regex)`, a string as its value. A string holding a lone surrogate has
//! no UTF-8 spelling, so each one is written as `\uXXXX`; a real U+FFFD stays
//! itself.

use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
use oxc_syntax::number::ToJsString;

use super::{Scope, Walker};

impl Walker {
    /// `if#0`, `if#1`, `for#0` — numbered within the path that contains them.
    pub(super) fn step(&mut self, kind: &str) -> String {
        let key = format!("{} {kind}", self.path);
        let scope = self.scopes.last_mut().expect("the module scope is never popped");
        let counter = scope.counts.entry(key).or_insert(0);
        let index = *counter;
        *counter += 1;
        if self.path.is_empty() {
            format!("{kind}#{index}")
        } else {
            format!("{}/{kind}#{index}", self.path)
        }
    }

    /// Push the scope a declaration opens: its own name, or the next `anon#i`.
    pub(super) fn named(&mut self, own: Option<String>) {
        let outer = self.scope();
        let own = own.unwrap_or_else(|| {
            let at = outer.anon;
            outer.anon += 1;
            format!("anon#{at}")
        });
        let name = if outer.name.is_empty() { own } else { format!("{}/{own}", outer.name) };
        self.scopes.push(Scope::new(name));
    }

    /// Hand `name` to the child about to be visited, when that child can take one.
    pub(super) fn hint_for(&mut self, child: &Expression, name: impl FnOnce(&mut Self) -> Option<String>) {
        if matches!(
            child,
            Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_) | Expression::ClassExpression(_)
        ) {
            self.hint = name(self);
        }
    }

    pub(super) fn name_of(&mut self, expression: &Expression) -> Option<String> {
        match expression {
            Expression::Identifier(it) => Some(it.name.to_string()),
            Expression::StringLiteral(it) => Some(if it.lone_surrogates {
                spelled(&it.value)
            } else {
                it.value.to_string()
            }),
            Expression::NumericLiteral(it) => Some(it.value.to_js_string()),
            Expression::BigIntLiteral(it) => Some(it.value.to_string()),
            Expression::BooleanLiteral(it) => Some(it.value.to_string()),
            Expression::NullLiteral(_) => Some("null".to_string()),
            // `String(regex)`: the pattern as written and the flags in alphabetical
            // order, which is the order oxc prints them in.
            Expression::RegExpLiteral(it) => Some(it.regex.to_string()),
            Expression::StaticMemberExpression(it) => Some(it.property.name.to_string()),
            Expression::ComputedMemberExpression(it) => self.name_of(&it.expression),
            Expression::PrivateFieldExpression(it) => Some(it.field.name.to_string()),
            _ => None,
        }
    }

    pub(super) fn name_of_key(&mut self, key: &PropertyKey) -> Option<String> {
        match key {
            PropertyKey::StaticIdentifier(it) => Some(it.name.to_string()),
            PropertyKey::PrivateIdentifier(it) => Some(it.name.to_string()),
            _ => self.name_of(key.to_expression()),
        }
    }

    pub(super) fn name_of_target(&mut self, target: &AssignmentTarget) -> Option<String> {
        match target {
            AssignmentTarget::AssignmentTargetIdentifier(it) => Some(it.name.to_string()),
            AssignmentTarget::StaticMemberExpression(it) => Some(it.property.name.to_string()),
            AssignmentTarget::ComputedMemberExpression(it) => self.name_of(&it.expression),
            AssignmentTarget::PrivateFieldExpression(it) => Some(it.field.name.to_string()),
            _ => None,
        }
    }

    pub(super) fn arguments(&mut self, callee: &Expression, arguments: &[Argument]) {
        self.visit_expression(callee);
        for (index, argument) in arguments.iter().enumerate() {
            if let Some(child) = argument.as_expression() {
                self.hint_for(child, |w| {
                    let callee = w.name_of(callee).unwrap_or_else(|| "call".to_string());
                    Some(format!("{callee}.arg{index}"))
                });
            }
            self.visit_argument(argument);
        }
    }
}

/// A string holding a lone surrogate, with each one written `\uXXXX`.
///
/// No JavaScript string can come back from Rust holding a lone surrogate, so
/// `String(value)` cannot be matched and the name is spelled as it would be
/// escaped instead. oxc encodes a lone surrogate as U+FFFD followed by its code
/// unit in hex, and U+FFFD itself as U+FFFD followed by `fffd`.
fn spelled(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\u{FFFD}' {
            out.push(ch);
            continue;
        }
        let unit: String = chars.by_ref().take(4).collect();
        if unit == "fffd" {
            out.push('\u{FFFD}');
        } else {
            out.push_str("\\u");
            out.push_str(&unit.to_ascii_uppercase());
        }
    }
    out
}
