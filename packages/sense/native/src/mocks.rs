//! What a module mocks and loads for real, read off the tree `read_module`
//! already holds — the native half of `mockDiff` in `taint/mocks.ts`, which is
//! the oracle and owns the reasoning. The parse carries the answer; only a
//! caller that applies the mock taint cuts anything with it.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::Scoping;
use regex::Regex;
use serde::Serialize;

use crate::loads::{constant, requires};
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
pub fn mocks_in(source: &str, program: &Program<'_>, scoping: &Scoping) -> Mocks {
    static WRITTEN: OnceLock<Regex> = OnceLock::new();
    let written = WRITTEN
        .get_or_init(|| Regex::new(r"\.(?:mock|requireActual|importActual)\b").unwrap());
    if !written.is_match(source) {
        return Mocks::default();
    }
    let mut found = Found { scoping, mocked: BTreeSet::new(), actual: BTreeSet::new(), preserved: BTreeSet::new(), factory: None };
    found.visit_program(program);
    let minus = found
        .mocked
        .difference(&found.actual)
        .filter(|specifier| !found.preserved.contains(*specifier))
        .cloned()
        .collect();
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

struct Found<'s> {
    scoping: &'s Scoping,
    mocked: BTreeSet<String>,
    actual: BTreeSet<String>,
    preserved: BTreeSet<String>,
    factory: Option<String>,
}

impl<'a> Visit<'a> for Found<'_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        let specifier = it.arguments.first().and_then(specifier_of);
        let method = method_of(it);
        if let Some(specifier) = specifier {
            if matches!(method, Some("importActual" | "requireActual"))
                || (self.factory.is_some() && requires(&it.callee))
            {
                if self.factory.as_ref() == Some(&specifier) {
                    self.preserved.insert(specifier);
                } else {
                    self.actual.insert(specifier);
                }
            } else if method == Some("mock") {
                let reaches = it.arguments[1..]
                    .iter()
                    .any(|argument| opaque(argument) || spies(argument) || original(argument, self.scoping));
                if reaches {
                    self.preserved.insert(specifier.clone());
                } else {
                    self.mocked.insert(specifier.clone());
                }
                for (index, argument) in it.arguments[1..].iter().enumerate() {
                    if index == 0 && is_factory(argument) {
                        let previous = self.factory.replace(specifier.clone());
                        self.visit_argument(argument);
                        self.factory = previous;
                    } else {
                        self.visit_argument(argument);
                    }
                }
                return;
            }
        }
        walk::walk_call_expression(self, it);
    }
}

/// A literal factory owned by a known mock call, rather than an eager argument.
pub(crate) fn factory_target(call: &CallExpression<'_>) -> Option<String> {
    if method_of(call) != Some("mock") || !call.arguments.get(1).is_some_and(is_factory) {
        return None;
    }
    call.arguments.first().and_then(specifier_of)
}

fn is_factory(argument: &Argument<'_>) -> bool {
    matches!(argument, Argument::ArrowFunctionExpression(_) | Argument::FunctionExpression(_))
}

/// `mock` in `vi.mock(…)`, when `vi` is one of the callers.
fn method_of<'b>(call: &'b CallExpression<'_>) -> Option<&'b str> {
    let Expression::StaticMemberExpression(member) = &call.callee else { return None };
    let Expression::Identifier(object) = &member.object else { return None };
    CALLERS.contains(&object.name.as_str()).then(|| member.property.name.as_str())
}

/// `'./x'`, a template with no substitutions, or `import('./x')`.
fn specifier_of(argument: &Argument<'_>) -> Option<String> {
    let expression = match argument.as_expression()? {
        Expression::ImportExpression(import) => &import.source,
        written => written,
    };
    constant(expression).map(str::to_owned)
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

/// A factory referring to the loader it is passed first, whatever its name, or
/// loading an original by a specifier this cannot read. `original` in `mockDiff`
/// owns the reasoning; here the scope tree says which references reach the
/// loader, so a shadowing name, a key or a label is not one.
fn original(argument: &Argument<'_>, scoping: &Scoping) -> bool {
    let (params, function) = match argument {
        Argument::ArrowFunctionExpression(arrow) => (&arrow.params, false),
        Argument::FunctionExpression(function) => (&function.params, true),
        _ => return false,
    };
    let loaders = match (params.items.first(), &params.rest) {
        (Some(parameter), _) => loader_of(&parameter.pattern).into_iter().collect(),
        (None, Some(rest)) => rest.rest.argument.get_binding_identifiers(),
        (None, None) => Vec::new(),
    };
    let referred = loaders.iter().any(|binding| {
        binding.symbol_id.get().is_some_and(|symbol| !scoping.get_resolved_reference_ids(symbol).is_empty())
    });
    let mut reach = Reaches { arguments: function, found: referred };
    reach.visit_argument(argument);
    reach.found
}

/// The binding a first parameter holds the whole loader by; a destructured one
/// takes the loader apart and holds none.
fn loader_of<'a, 'b>(pattern: &'b BindingPattern<'a>) -> Option<&'b BindingIdentifier<'a>> {
    match pattern {
        BindingPattern::BindingIdentifier(binding) => Some(binding),
        BindingPattern::AssignmentPattern(assigned) => loader_of(&assigned.left),
        _ => None,
    }
}

/// `arguments` in a `function` factory, which holds the loader under no binding,
/// and an `importActual` or `requireActual` this cannot read the specifier of.
struct Reaches {
    arguments: bool,
    found: bool,
}

impl<'a> Visit<'a> for Reaches {
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        self.found |= self.arguments && it.name == "arguments";
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        let actual = matches!(method_of(it), Some("importActual" | "requireActual"));
        self.found |= actual && it.arguments.first().and_then(specifier_of).is_none();
        walk::walk_call_expression(self, it);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_semantic::SemanticBuilder;
    use oxc_span::SourceType;

    fn read(source: &str) -> Mocks {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
        let built = SemanticBuilder::new().build(&parsed.program);
        mocks_in(source, &parsed.program, built.semantic.scoping())
    }

    #[test]
    fn a_mock_is_a_minus_and_an_original_is_a_plus() {
        let found = read("vi.mock('./b'); jest.mock('./a', () => jest.requireActual('./c')); sb.mock(import('./d'), { spy: true });");
        assert_eq!(found.minus, ["./a", "./b"]);
        assert_eq!(found.plus, ["./c"]);
    }

    #[test]
    fn a_factory_reaching_the_original_cuts_nothing() {
        let found = read("vi.mock('./a', async (original) => ({ ...(await original()) })); vi.mock('./b', factory);");
        assert!(found.minus.is_empty());
        assert!(found.plus.is_empty());
    }

    #[test]
    fn a_name_that_shadows_the_loader_is_not_a_reference_to_it() {
        let found = read("vi.mock('./a', (load) => ({ f: (load) => load() })); vi.mock('./b', (load) => { { const load = 1; return { load }; } });");
        assert_eq!(found.minus, ["./a", "./b"]);
    }

    #[test]
    fn a_forwarding_factory_cancels_without_adding_an_import() {
        assert!(read("jest.mock('./a', () => jest.requireActual('./a'));").is_empty());
        assert!(read("vi.mock('./a', async () => await vi.importActual('./a'));").is_empty());
        assert!(read("sb.mock(import('./a'), { spy: true });").is_empty());
    }

    #[test]
    fn an_independent_original_load_is_still_an_import() {
        let found = read("jest.mock('./a'); beforeEach(() => jest.requireActual('./a'));");
        assert!(found.minus.is_empty());
        assert_eq!(found.plus, ["./a"]);
    }

    #[test]
    fn a_computed_member_or_an_unknown_caller_is_not_a_mock() {
        assert!(read("vi[mock]('./a'); other.mock('./b'); vi.mock(name);").is_empty());
    }
}
