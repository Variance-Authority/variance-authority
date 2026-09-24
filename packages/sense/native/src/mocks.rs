//! What a module mocks and loads for real, read off the tree `read_module`
//! already holds — the native half of `mockDiff` in `taint/mocks.ts`, which is
//! the oracle and owns the reasoning. The parse carries the answer; only a
//! caller that applies the mock taint cuts anything with it.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use regex::Regex;
use serde::Serialize;

use crate::order::code_unit;

/// `vi`, `jest` and `sb`: the callers every parse is read for.
const CALLERS: [&str; 3] = ["jest", "sb", "vi"];

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Mocks {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) minus: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) plus: Vec<String>,
}

impl Mocks {
    pub(crate) fn is_empty(&self) -> bool {
        self.minus.is_empty() && self.plus.is_empty()
    }
}

/// The diff `mockDiff` answers for the default callers: both sides sorted by
/// code unit and unique, empty when the file neither mocks nor loads an original.
pub fn mocks_in(source: &str, program: &Program<'_>) -> Mocks {
    static WRITTEN: OnceLock<Regex> = OnceLock::new();
    let written = WRITTEN
        .get_or_init(|| Regex::new(r"\.(?:mock|requireActual|importActual)\b").unwrap());
    if !written.is_match(source) {
        return Mocks::default();
    }
    let mut found = Found::default();
    found.visit_program(program);
    let minus = found.mocked.difference(&found.actual).cloned().collect();
    Mocks {
        minus: by_code_unit(minus),
        plus: by_code_unit(found.actual.into_iter().collect()),
    }
}

/// The set holds each specifier once; the order is JavaScript's `<`, as `mockDiff` sorts.
fn by_code_unit(mut values: Vec<String>) -> Vec<String> {
    values.sort_by(|left, right| code_unit(left, right));
    values
}

#[derive(Default)]
struct Found {
    mocked: BTreeSet<String>,
    actual: BTreeSet<String>,
}

impl<'a> Visit<'a> for Found {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        let specifier = it.arguments.first().and_then(specifier_of);
        if let (Some(method), Some(specifier)) = (method_of(it), specifier) {
            if method == "importActual" || method == "requireActual" {
                self.actual.insert(specifier);
            } else if method == "mock" {
                let reaches = it.arguments[1..]
                    .iter()
                    .any(|argument| opaque(argument) || spies(argument) || original(argument));
                if reaches {
                    self.actual.insert(specifier);
                } else {
                    self.mocked.insert(specifier);
                }
            }
        }
        walk::walk_call_expression(self, it);
    }
}

/// `mock` in `vi.mock(…)`, when `vi` is one of the callers.
fn method_of<'b>(call: &'b CallExpression<'_>) -> Option<&'b str> {
    let Expression::StaticMemberExpression(member) = &call.callee else { return None };
    let Expression::Identifier(object) = &member.object else { return None };
    CALLERS.contains(&object.name.as_str()).then(|| member.property.name.as_str())
}

/// `'./x'`, a template with no substitutions, or `import('./x')`.
fn specifier_of(argument: &Argument<'_>) -> Option<String> {
    argument.as_expression().and_then(specifier_of_expression)
}

fn specifier_of_expression(expression: &Expression<'_>) -> Option<String> {
    match expression {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template) if template.quasis.len() == 1 => {
            template.quasis[0].value.cooked.as_ref().map(|cooked| cooked.to_string())
        }
        Expression::ImportExpression(import) => specifier_of_expression(&import.source),
        _ => None,
    }
}

/// A factory whose body is elsewhere.
fn opaque(argument: &Argument<'_>) -> bool {
    !matches!(
        argument,
        Argument::ArrowFunctionExpression(_)
            | Argument::FunctionExpression(_)
            | Argument::ObjectExpression(_)
            | Argument::StringLiteral(_)
            | Argument::NumericLiteral(_)
            | Argument::BooleanLiteral(_)
            | Argument::NullLiteral(_)
            | Argument::RegExpLiteral(_)
            | Argument::BigIntLiteral(_)
    )
}

/// `{ spy: true }`.
fn spies(argument: &Argument<'_>) -> bool {
    let Argument::ObjectExpression(object) = argument else { return false };
    object.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else { return false };
        !property.computed
            && matches!(&property.key, PropertyKey::StaticIdentifier(key) if key.name == "spy")
    })
}

/// A factory naming `importOriginal`, or loading an original by a specifier this cannot read.
fn original(argument: &Argument<'_>) -> bool {
    let mut reach = Reaches(false);
    reach.visit_argument(argument);
    reach.0
}

struct Reaches(bool);

impl<'a> Visit<'a> for Reaches {
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        self.0 |= it.name == "importOriginal";
    }

    fn visit_binding_identifier(&mut self, it: &BindingIdentifier<'a>) {
        self.0 |= it.name == "importOriginal";
    }

    fn visit_identifier_name(&mut self, it: &IdentifierName<'a>) {
        self.0 |= it.name == "importOriginal";
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        let actual = matches!(method_of(it), Some("importActual" | "requireActual"));
        self.0 |= actual && it.arguments.first().and_then(specifier_of).is_none();
        walk::walk_call_expression(self, it);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    fn read(source: &str) -> Mocks {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
        mocks_in(source, &parsed.program)
    }

    #[test]
    fn a_mock_is_a_minus_and_an_original_is_a_plus() {
        let found = read("vi.mock('./b'); jest.mock('./a', () => jest.requireActual('./c')); sb.mock(import('./d'), { spy: true });");
        assert_eq!(found.minus, ["./a", "./b"]);
        assert_eq!(found.plus, ["./c", "./d"]);
    }

    #[test]
    fn a_factory_reaching_the_original_cuts_nothing() {
        let found = read("vi.mock('./a', async (importOriginal) => ({ ...(await importOriginal()) })); vi.mock('./b', factory);");
        assert!(found.minus.is_empty());
        assert_eq!(found.plus, ["./a", "./b"]);
    }

    #[test]
    fn a_computed_member_or_an_unknown_caller_is_not_a_mock() {
        assert!(read("vi[mock]('./a'); other.mock('./b'); vi.mock(name);").is_empty());
    }
}
