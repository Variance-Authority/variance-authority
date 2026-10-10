//! Arrival before binding: where a function's probe goes when its parameters can throw.
//!
//! A probe in the body runs after every parameter has bound, and a parameter
//! list that destructures or defaults can throw while it binds:
//! `function f({ required }) {}` called as `f()` throws a `TypeError` before
//! the body is reached. That call entered the function — an edit to its
//! parameter list changes what it does — so the arrival has to be observed
//! before the first parameter that can throw.
//!
//! Nothing evaluates in front of a pattern that has no default, so the list is
//! rewritten, by insertion only, so that something does. From the first
//! parameter that can throw, the parameters move into an object pattern laid
//! over a rest parameter, and the probe is that pattern's first computed key:
//!
//! ```text
//! function f(a, { b }, c = 1, d) {}
//! function f(a, __va$1, ...{[(__va(7),"")]: { b } = __va$1, 0: c = 1, 1: d}) {}
//! ```
//!
//! What that keeps, and why:
//!
//! - **Arity.** `length` counts the parameters in front of the first default
//!   or rest. Every parameter in front of that cut that moves into the object
//!   leaves a plain placeholder at its position, and the rest parameter does
//!   not count, so `length` is what it was. Every argument lands at the
//!   position it did: a moved parameter before the cut reads its placeholder
//!   through a default (the key `""` is never an array's own property), and one
//!   after the cut reads the rest array at its own index, keeping its own
//!   default.
//! - **`arguments`.** A list that can throw is already not simple, so its
//!   `arguments` object is already unmapped; the rewritten list is still not
//!   simple, so nothing about `arguments` changes, and a `"use strict"`
//!   directive in the body is exactly as illegal as it was.
//! - **Scope and order.** Every binding stays a parameter, in the parameter
//!   scope, bound in the original order, so a default still sees `this`,
//!   `super`, `new.target`, `arguments` and the earlier parameters, and a later
//!   one is still in its dead zone. A derived constructor's defaults still
//!   cannot touch `this` before `super()`.
//! - **Generators and async functions.** Parameters bind when the function is
//!   called, before a generator's body is deferred and before an async
//!   function's first await, so the probe runs at the call in both. A throw
//!   while binding still becomes the async function's rejection.
//!
//! An original rest parameter is read back from `arguments`, which an arrow
//! does not have, and a TypeScript parameter cannot move into a pattern; both
//! keep the probe in the body. So does a list whose first parameter is an
//! object pattern: its text is read by the runners that parse fixture names
//! out of `Function.prototype.toString`, and nothing can run in front of it
//! without changing that text or `length`.

use std::fmt::Write;

use oxc_ast::ast::*;
use oxc_span::GetSpan;

/// The insertions that move the probe in front of the parameters, and where the
/// last of them goes. `None` leaves the probe in the body.
pub struct Plan {
    pub before: Vec<(u32, String)>,
    /// The offset of the closing parenthesis: the object pattern's `}` goes
    /// here, after whatever the parameters' own walk inserts at the same offset.
    pub close: u32,
}

pub fn plan(params: &FormalParameters, entry: u32, arrow: bool) -> Option<Plan> {
    let items = &params.items;
    let throwing = items.iter().position(|item| throws(&item.pattern, item.initializer.as_deref()));
    let rest = params.rest.as_deref();

    let first = match (throwing, rest) {
        (Some(index), _) => index,
        (None, Some(rest)) if !matches!(rest.rest.argument, BindingPattern::BindingIdentifier(_)) => items.len(),
        _ => return None,
    };
    // A first parameter that is an object pattern keeps its text. Runners read
    // fixture names out of a function's source — Vitest's and Playwright's
    // `test.extend`, Rstest's test bodies — and refuse one whose first
    // parameter does not open with `{`; nothing can run in front of that
    // pattern without a parameter in front of it, or a default on it that
    // changes `length`. So a call that throws while binding it — `f()` or
    // `f(null)` — is observed only if its body is reached. A list that is only a
    // destructured rest has no first item: `first` is 0 and `items` is empty.
    if first == 0 && items.first().is_some_and(|item| matches!(item.pattern, BindingPattern::ObjectPattern(_))) {
        return None;
    }
    // TODO: an arrow whose parameters can throw and that ends in a rest keeps its
    // probe in the body — the rest is read back from `arguments`, and an arrow
    // has none. A throw while binding one is still charged to nobody.
    if rest.is_some() && arrow {
        return None;
    }
    // TODO: a TypeScript parameter — typed, optional, decorated or a parameter
    // property — cannot move into a pattern, and keeps its probe in the body.
    // The recording seams see JavaScript, which is what makes this rare.
    if items.iter().any(typed) || rest.is_some_and(|rest| rest.type_annotation.is_some() || !rest.decorators.is_empty()) {
        return None;
    }
    if rest.is_some() && params.iter_bindings().any(|pattern| {
        pattern.get_binding_identifiers().iter().any(|id| id.name == "arguments")
    }) {
        return None;
    }

    // The cut `length` counts up to.
    let cut = items.iter().position(|item| item.initializer.is_some()).unwrap_or(items.len());
    // Where the rest array starts.
    let from = first.max(cut);
    let probe = |key: &str| format!("[(__va({entry}),{key})]:");

    let mut before = Vec::new();
    for (index, item) in items.iter().enumerate().skip(first) {
        let span = item.pattern.span();
        let key = if index < cut { "\"\"".to_string() } else { (index - from).to_string() };
        let mut text = String::new();
        if index == first {
            for placeholder in first..cut {
                let _ = write!(text, "__va${placeholder}, ");
            }
            text.push_str("...{");
            text.push_str(&probe(&key));
        } else {
            let _ = write!(text, "{key}:");
        }
        before.push((span.start, text));
        if index < cut {
            before.push((span.end, format!(" = __va${index}")));
        }
    }
    if let Some(rest) = rest {
        let span = rest.rest.span;
        let head = if first == items.len() { format!("...{{{}[", probe("\"\"")) } else { "\"\":[".to_string() };
        before.push((span.start, head));
        before.push((span.end, format!("]=[].slice.call(arguments,{})", items.len())));
    }
    Some(Plan { before, close: params.span.end - 1 })
}

/// Whether binding this parameter can throw: a pattern can meet a value it
/// cannot take apart, and a default runs code.
fn throws(pattern: &BindingPattern, initializer: Option<&Expression>) -> bool {
    !matches!(pattern, BindingPattern::BindingIdentifier(_)) || initializer.is_some_and(|value| !inert(value))
}

/// A default that cannot throw: a literal, an empty object or array, a closure.
fn inert(value: &Expression) -> bool {
    match value {
        Expression::TemplateLiteral(it) => it.expressions.is_empty(),
        Expression::ObjectExpression(it) => it.properties.is_empty(),
        Expression::ArrayExpression(it) => it.elements.is_empty(),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
        Expression::ParenthesizedExpression(it) => inert(&it.expression),
        _ => value.is_literal(),
    }
}

fn typed(item: &FormalParameter) -> bool {
    item.type_annotation.is_some() || item.optional || item.has_modifier() || !item.decorators.is_empty()
}
