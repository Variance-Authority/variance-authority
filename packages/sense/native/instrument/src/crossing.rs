//! Function syntax consumed by another realm or by a compile-time DSL.
//!
//! `page.evaluate(fn)` does not call `fn`: it sends `fn.toString()` to the
//! page and the page compiles it there, where nothing this module declares
//! exists. A probe inside that text calls a binding the page does not have and
//! throws at the first one. So the walk places nothing inside a function this
//! finds, and keeps probing the rest of the module: the text of a crossing
//! function belongs to the region around it, the way any other expression's
//! text does, or, for a declaration after a branch or under a `case`, to the
//! block it is hoisted to (`walk.rs`).
//!
//! What crosses is decided by the call, not by the function. [`CROSSINGS`]
//! names each method that serializes an argument and which argument it is,
//! matched by the property name on any receiver, because which object a
//! receiver is cannot be read from text. A call that only shares a name costs
//! the function its own regions and nothing else; a crossing missed leaves the
//! probes in and fails loudly in the page, which is the failure the product
//! keeps rather than hides.
//!
//! A function is found where the argument names it in this module: written at
//! the call, or an identifier whose binding — resolved by scope, never by
//! spelling — is a function declaration or a variable initialised with a
//! function, and is never reassigned. An import, a parameter, a property or a call
//! result is a function written somewhere this text cannot see, and stays the
//! caller's to declare.

use std::collections::HashSet;

use oxc_ast::ast::*;
use oxc_ast::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{Semantic, SemanticBuilder};

/// Each method that sends a function's source to a page, and the argument it sends.
///
/// Playwright's page, frame, locator and context, and Puppeteer's page. The
/// two `$eval`s take a selector first. WebdriverIO's `execute`, Selenium's
/// `executeScript`, TestCafe's `ClientFunction` and `evaluate.call(...)` are
/// not matched: their probes stay in and throw in the page.
///
/// Which functions this matches decides which functions get regions, so a
/// change to it is a change to the cut: the presence and entries ids in
/// `lib.rs` move with it, or a recording made before is read against the
/// wrong regions.
pub const CROSSINGS: [(&str, usize); 8] = [
    ("$$eval", 1),
    ("$eval", 1),
    ("addInitScript", 0),
    ("evaluate", 0),
    ("evaluateAll", 0),
    ("evaluateHandle", 0),
    ("evaluateOnNewDocument", 0),
    ("waitForFunction", 0),
];

/// The span of every function `program` hands to another realm.
///
/// Scope analysis is built only for named crossing arguments or Compiled
/// imports; most modules write theirs at the call or cross nothing.
pub fn crossing<'a>(program: &'a Program<'a>) -> HashSet<(u32, u32)> {
    let mut sites = Sites { found: HashSet::new(), named: false, semantic: None };
    sites.visit_program(program);
    if !sites.named && !crate::compiled::has_styles(program) {
        return sites.found;
    }
    let built = SemanticBuilder::new().with_build_nodes(true).build(program);
    let mut sites = Sites { found: sites.found, named: false, semantic: Some(&built.semantic) };
    sites.visit_program(program);
    sites.found.extend(crate::compiled::callbacks(program, &built.semantic));
    sites.found
}

struct Sites<'s, 'a> {
    found: HashSet<(u32, u32)>,
    /// Whether an argument names a function rather than writing one.
    named: bool,
    /// The scopes that say what a name is bound to, once they are built.
    semantic: Option<&'s Semantic<'a>>,
}

impl<'a> Visit<'a> for Sites<'_, 'a> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Some(argument) = sent(it) {
            match bare(argument) {
                Expression::Identifier(id) => match self.semantic {
                    Some(semantic) => self.found.extend(bound(semantic, id)),
                    None => self.named = true,
                },
                expression => self.found.extend(function_span(expression)),
            }
        }
        walk::walk_call_expression(self, it);
    }
}

/// The argument a crossing call sends, when the call is one.
fn sent<'b, 'a>(call: &'b CallExpression<'a>) -> Option<&'b Expression<'a>> {
    let method = match bare(&call.callee) {
        Expression::StaticMemberExpression(it) => it.property.name.as_str(),
        Expression::ComputedMemberExpression(it) => match &it.expression {
            Expression::StringLiteral(name) => name.value.as_str(),
            _ => return None,
        },
        _ => return None,
    };
    let (_, index) = CROSSINGS.iter().find(|(name, _)| *name == method)?;
    call.arguments.get(*index)?.as_expression()
}

/// The expression under parentheses and type assertions, which cross with it.
fn bare<'b, 'a>(mut expression: &'b Expression<'a>) -> &'b Expression<'a> {
    loop {
        expression = match expression {
            Expression::ParenthesizedExpression(it) => &it.expression,
            Expression::TSAsExpression(it) => &it.expression,
            Expression::TSSatisfiesExpression(it) => &it.expression,
            Expression::TSNonNullExpression(it) => &it.expression,
            Expression::TSTypeAssertion(it) => &it.expression,
            _ => return expression,
        };
    }
}

fn function_span(expression: &Expression) -> Option<(u32, u32)> {
    match expression {
        Expression::FunctionExpression(it) => Some((it.span.start, it.span.end)),
        Expression::ArrowFunctionExpression(it) => Some((it.span.start, it.span.end)),
        _ => None,
    }
}

/// The function a name's binding holds, when this module declares one.
pub(super) fn bound(semantic: &Semantic, id: &IdentifierReference) -> Option<(u32, u32)> {
    let scoping = semantic.scoping();
    let symbol = scoping.get_reference(id.reference_id.get()?).symbol_id()?;
    if scoping.symbol_is_mutated(symbol) {
        return None;
    }
    match semantic.nodes().kind(scoping.symbol_declaration(symbol)) {
        AstKind::Function(function) if function.body.is_some() => Some((function.span.start, function.span.end)),
        AstKind::VariableDeclarator(declarator) if matches!(declarator.id, BindingPattern::BindingIdentifier(_)) => {
            declarator.init.as_ref().and_then(|init| function_span(bare(init)))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    use super::*;

    /// The crossing functions' source, in order.
    fn crossing_text(source: &str) -> Vec<String> {
        let allocator = Allocator::new();
        let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
        assert!(parsed.diagnostics.is_empty(), "the fixture parses");
        let program = allocator.alloc(parsed.program);
        let mut spans: Vec<_> = crossing(program).into_iter().collect();
        spans.sort_unstable();
        spans.into_iter().map(|(start, end)| source[start as usize..end as usize].to_string()).collect()
    }

    #[test]
    fn compiled_style_callbacks_are_compiler_input() {
        let source = "import { styled as design, css } from '@compiled/react';\nconst Button = design.button({ width: p => p.small ? '24px' : '32px' }, p => p.active && css({ color: 'red' }));\n";
        assert_eq!(crossing_text(source), ["p => p.small ? '24px' : '32px'", "p => p.active && css({ color: 'red' })"]);
    }

    #[test]
    fn compiled_named_styles_cross_but_the_component_is_runtime() {
        let source = "import { styled } from '@compiled/react'; const style = p => p.active; const Button = styled(p => render(p))(style);";
        assert_eq!(crossing_text(source), ["p => p.active"]);
        let source = "import { styled } from '@compiled/react'; const Button = styled.button`color: ${p => p.color}`;";
        assert_eq!(crossing_text(source), ["p => p.color"]);
    }

    #[test]
    fn unrelated_and_shadowed_style_names_keep_their_probes() {
        let source = "import { styled } from '@compiled/react';\nfunction runtime(styled) { return styled.button(p => p.active); }\nlist.map(p => p.active);\n";
        assert!(crossing_text(source).is_empty());
        assert!(crossing_text("import { styled } from 'styled-components'; const B = styled.button(p => p.active);").is_empty());
    }

    #[test]
    fn a_function_written_at_the_call_crosses() {
        let source = "page.evaluate(() => document.title);\nframe.evaluate(function () { return 1 }, 2);\n";
        assert_eq!(crossing_text(source), ["() => document.title", "function () { return 1 }"]);
    }

    #[test]
    fn the_eval_methods_send_their_second_argument() {
        let source = "page.$eval('a', (a) => a.href, (b) => b);\npage.$$eval('a', (all) => all.length);\n";
        assert_eq!(crossing_text(source), ["(a) => a.href", "(all) => all.length"]);
    }

    #[test]
    fn a_function_named_at_the_call_crosses_where_it_is_declared() {
        let source = "function probe(x) { return x }\nconst read = () => 1;\nexport function f(page) {\n  page.evaluate(probe);\n  return page.addInitScript(read);\n}\n";
        assert_eq!(crossing_text(source), ["function probe(x) { return x }", "() => 1"]);
    }

    #[test]
    fn a_function_declared_after_the_call_that_names_it_crosses() {
        let source = "export function f(page) {\n  return page.evaluate(probe);\n}\nfunction probe() { return 1 }\n";
        assert_eq!(crossing_text(source), ["function probe() { return 1 }"]);
    }

    #[test]
    fn a_name_is_resolved_by_scope_not_spelling() {
        let source = "function probe() { return 1 }\nexport function f(page, probe) {\n  return page.evaluate(probe);\n}\n";
        assert!(crossing_text(source).is_empty());
    }

    #[test]
    fn a_binding_assigned_again_is_not_a_function_this_text_can_name() {
        let source = "let probe = () => 1;\nprobe = () => 2;\npage.evaluate(probe);\n";
        assert!(crossing_text(source).is_empty());
        let source = "function probe() { return 1 }\nprobe = () => 2;\npage.evaluate(probe);\n";
        assert!(crossing_text(source).is_empty());
    }

    #[test]
    fn a_string_an_import_and_a_parameter_send_nothing_this_module_wrote() {
        let source = "import { probe } from './probe';\npage.evaluate('document.title');\npage.evaluate(probe);\npage.addInitScript({ content: 'x' });\nexport const f = (page, fn) => page.evaluate(fn);\n";
        assert!(crossing_text(source).is_empty());
    }

    #[test]
    fn a_call_that_does_not_serialize_sends_nothing() {
        let source = "page.exposeFunction('f', () => 1);\nevaluate(() => 2);\nlist.map((x) => x);\n";
        assert!(crossing_text(source).is_empty());
    }

    #[test]
    fn parentheses_and_assertions_cross_with_the_function() {
        let source = "page.evaluate((() => 1) as () => number);\n";
        assert_eq!(crossing_text(source), ["() => 1"]);
    }
}
