//! The cut a test file carries: one call before each statement of a test or a
//! hook, so a case's log says which test line first reached each region.

//!
//! The call is `__vaC(line)`, inserted on the statement's own line in front of
//! it, so the text keeps every line and only columns move, and the map in
//! `cadence_map.rs` moves them back.
//! It stops at a nested function — the callback an `act` or a `waitFor` is
//! handed is part of the statement that hands it — and it goes into a nested
//! block, since a statement inside an `if` of the test is still the test's.
//! A statement that is not in a block, `if (x) y();`, is the statement around
//! it's: nothing is inserted where a cut would change what the `if` governs.
//! A concise arrow body is one statement, cut as `(__vaC(line),body)`.
//!
//! `__vaC` is declared after the last statement, as a function, so hoisting
//! puts it in place before anything runs and nothing in front of a hoisted
//! `vi.mock` moves. It asks the realm's root for `c` at each call and does
//! nothing where there is none: a file run without a recording runs as it is.
//! The collector's side is `cut` in `src/instrument/probe-log.cts`.

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::GetSpan;

use crate::cadence_map::mappings;
use crate::dialect::dialect;
use crate::header::json_string;

/// A cut test file, with the `mappings` of its source map and the shifts they
/// were made from: `cadence_map.rs`.
pub struct Cadence {
    pub code: String,
    pub mappings: String,
    pub shifts: Vec<u32>,
}

/// The calls whose function argument is a test or a hook body, by the name
/// the callee chain starts from: `it.each(…)(…)` and `test.only(…)` start from
/// `it` and `test`.
const BODIES: [&str; 9] = ["it", "test", "fit", "xit", "xtest", "beforeEach", "afterEach", "beforeAll", "afterAll"];

/// What the file declares to receive its cuts: one line, no newline.
const DECLARATION: &str =
    ";function __vaC(l){var r=globalThis.__VA__;if(r!=null&&typeof r.c===\"function\")r.c(l)}";

/// The test file with a cut before each statement of its test and hook bodies,
/// or nothing when it does not parse or holds no such body.
///
/// `awaited` is for a runner whose collector is not in the test's realm, as
/// Playwright's page is not: a statement of an async body awaits its cut, so
/// the collector can drain what the statement before it reached before this
/// one runs, and the cut names `file`, so a body declared in another file is
/// told apart. A body that cannot wait is cut as it is without it.
pub fn cadence(source: &str, file: &str, awaited: bool) -> Option<Cadence> {
    let allocator = Allocator::new();
    let source_type = dialect(file).unwrap_or_default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if parsed.panicked || !parsed.diagnostics.is_empty() {
        return None;
    }
    let registrars = registrars(&parsed.program);
    let mut cuts = Cuts { lines: Lines::new(source), edits: Vec::new(), awaited, waits: false, registrars };
    cuts.visit_program(&parsed.program);
    if cuts.edits.is_empty() {
        return None;
    }
    let last = parsed.program.body.last().map_or(0, |statement| statement.span().end);
    cuts.edits.push((last, declaration(file, awaited)));
    // Stable, so a concise body's closing parenthesis keeps its place.
    cuts.edits.sort_by_key(|(at, _)| *at);
    let mut code = String::with_capacity(source.len() + cuts.edits.iter().map(|(_, text)| text.len()).sum::<usize>());
    let mut read = 0usize;
    for (at, text) in &cuts.edits {
        code.push_str(&source[read..*at as usize]);
        code.push_str(text);
        read = *at as usize;
    }
    code.push_str(&source[read..]);
    let (mappings, shifts) = mappings(source, &cuts.edits);
    Some(Cadence { code, mappings, shifts })
}

/// `__vaC`, which hands the collector the line, and with `awaited` the file. An
/// awaited cut waits only on what a collector returned, kept on `__vaC.w`, so a
/// body in a realm with no recording takes no turn it did not take as written.
fn declaration(file: &str, awaited: bool) -> String {
    if !awaited {
        return DECLARATION.to_string();
    }
    let mut named = String::new();
    json_string(&mut named, file);
    format!(";function __vaC(l){{var r=globalThis.__VA__;__vaC.w=r!=null&&typeof r.c===\"function\"?r.c(l,{named}):void 0;return __vaC.w!=null}}")
}

struct Cuts {
    lines: Lines,
    edits: Vec<(u32, String)>,
    awaited: bool,
    /// Whether the body being cut can wait on its cuts.
    waits: bool,
    /// The names a test or hook body is registered under in this file.
    registrars: Vec<String>,
}

impl Cuts {
    fn cut(&mut self, at: u32) {
        let line = self.lines.at(at);
        let wait = if self.waits { "&&await __vaC.w" } else { "" };
        self.edits.push((at, format!("__vaC({line}){wait};")));
    }

    fn body(&mut self, function: &Argument) {
        match function {
            Argument::ArrowFunctionExpression(arrow) => {
                self.waits = self.awaited && arrow.r#async;
                match arrow.body.as_function_body() {
                    Some(body) => self.statements(&body.statements),
                    None => {
                        let span = arrow.body.span();
                        let line = self.lines.at(span.start);
                        let wait = if self.waits { "&&await __vaC.w" } else { "" };
                        self.edits.push((span.start, format!("(__vaC({line}){wait},")));
                        self.edits.push((span.end, ")".to_string()));
                    }
                }
            }
            Argument::FunctionExpression(function) => {
                self.waits = self.awaited && function.r#async && !function.generator;
                if let Some(body) = &function.body {
                    self.statements(&body.statements);
                }
            }
            _ => {}
        }
    }

    fn statements(&mut self, statements: &[Statement]) {
        for statement in statements {
            self.cut(statement.span().start);
            self.inside(statement);
        }
    }

    /// The blocks a statement holds, cut in turn; never a function's body.
    fn inside(&mut self, statement: &Statement) {
        match statement {
            Statement::BlockStatement(it) => self.statements(&it.body),
            Statement::IfStatement(it) => {
                self.braced(&it.consequent);
                match &it.alternate {
                    // `else if` takes nothing in front of its `if`.
                    Some(alternate @ Statement::IfStatement(_)) => self.inside(alternate),
                    Some(alternate) => self.braced(alternate),
                    None => {}
                }
            }
            Statement::ForStatement(it) => self.braced(&it.body),
            Statement::ForInStatement(it) => self.braced(&it.body),
            Statement::ForOfStatement(it) => self.braced(&it.body),
            Statement::WhileStatement(it) => self.braced(&it.body),
            Statement::DoWhileStatement(it) => self.braced(&it.body),
            Statement::WithStatement(it) => self.braced(&it.body),
            Statement::LabeledStatement(it) => self.braced(&it.body),
            Statement::TryStatement(it) => {
                self.statements(&it.block.body);
                if let Some(handler) = &it.handler {
                    self.statements(&handler.body.body);
                }
                if let Some(finalizer) = &it.finalizer {
                    self.statements(&finalizer.body);
                }
            }
            Statement::SwitchStatement(it) => {
                for case in &it.cases {
                    self.statements(&case.consequent);
                }
            }
            _ => {}
        }
    }

    fn braced(&mut self, body: &Statement) {
        if let Statement::BlockStatement(block) = body {
            self.statements(&block.body);
        }
    }
}

impl<'a> Visit<'a> for Cuts {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        // Playwright's `test.describe(…)` starts from `test` and holds tests.
        let registers = root_name(&it.callee).is_some_and(|name| self.registrars.iter().any(|known| known == name));
        if !registers || has_member(&it.callee, "describe") {
            return walk::walk_call_expression(self, it);
        }
        self.visit_expression(&it.callee);
        for argument in &it.arguments {
            match argument {
                Argument::ArrowFunctionExpression(_) | Argument::FunctionExpression(_) => self.body(argument),
                other => self.visit_argument(other),
            }
        }
    }
}

/// The names a body is registered under: `BODIES`, a specifier that
/// imports one of them under another name, and a top-level binding that
/// `.extend` made from a registrar, as Playwright's and Vitest's `test.extend`
/// make a test with fixtures, followed through any number of extensions.
fn registrars(program: &Program) -> Vec<String> {
    let mut names: Vec<String> = BODIES.iter().map(|name| name.to_string()).collect();
    let mut extended: Vec<(&str, &str)> = Vec::new();
    for statement in &program.body {
        let declaration = match statement {
            Statement::ImportDeclaration(import) => {
                for specifier in import.specifiers.iter().flatten() {
                    if let ImportDeclarationSpecifier::ImportSpecifier(it) = specifier {
                        let imported = it.imported.name();
                        if BODIES.contains(&imported.as_str()) && it.local.name != imported {
                            names.push(it.local.name.to_string());
                        }
                    }
                }
                continue;
            }
            Statement::VariableDeclaration(declaration) => declaration,
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::VariableDeclaration(declaration) => declaration,
                _ => continue,
            },
            _ => continue,
        };
        for declarator in &declaration.declarations {
            let (BindingPattern::BindingIdentifier(id), Some(Expression::CallExpression(call))) = (&declarator.id, &declarator.init) else {
                continue;
            };
            if has_member(&call.callee, "extend") {
                if let Some(root) = root_name(&call.callee) {
                    extended.push((id.name.as_str(), root));
                }
            }
        }
    }
    // An extension of an extension is declared after it, so one pass in order
    // takes the chain; a later pass takes one declared out of order.
    loop {
        let before = names.len();
        for (name, root) in &extended {
            if names.iter().any(|known| known == root) && !names.iter().any(|known| known == name) {
                names.push(name.to_string());
            }
        }
        if names.len() == before {
            return names;
        }
    }
}

/// The name a callee chain starts from: `it` for `it.each([…])` and `it.only`.
fn root_name<'b>(callee: &'b Expression) -> Option<&'b str> {
    match callee {
        Expression::Identifier(it) => Some(it.name.as_str()),
        Expression::StaticMemberExpression(it) => root_name(&it.object),
        Expression::ComputedMemberExpression(it) => root_name(&it.object),
        Expression::CallExpression(it) => root_name(&it.callee),
        Expression::TaggedTemplateExpression(it) => root_name(&it.tag),
        Expression::ParenthesizedExpression(it) => root_name(&it.expression),
        _ => None,
    }
}

/// Whether a callee chain reads `name` off something: `describe` in `test.describe.only`.
fn has_member(callee: &Expression, name: &str) -> bool {
    match callee {
        Expression::StaticMemberExpression(it) => it.property.name == name || has_member(&it.object, name),
        Expression::ComputedMemberExpression(it) => has_member(&it.object, name),
        Expression::CallExpression(it) => has_member(&it.callee, name),
        Expression::TaggedTemplateExpression(it) => has_member(&it.tag, name),
        Expression::ParenthesizedExpression(it) => has_member(&it.expression, name),
        _ => false,
    }
}

/// Byte offsets to 1-based lines, by every terminator the language has:
/// `\n`, `\r\n`, a lone `\r`, U+2028 and U+2029, as an engine numbers them.
struct Lines {
    starts: Vec<u32>,
}

impl Lines {
    fn new(source: &str) -> Self {
        let mut starts = vec![0];
        let bytes = source.as_bytes();
        for (at, character) in source.char_indices() {
            let after = (at + character.len_utf8()) as u32;
            match character {
                '\n' | '\u{2028}' | '\u{2029}' => starts.push(after),
                '\r' if bytes.get(at + 1) != Some(&b'\n') => starts.push(after),
                _ => {}
            }
        }
        Self { starts }
    }

    fn at(&self, offset: u32) -> usize {
        self.starts.partition_point(|&start| start <= offset)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cut(source: &str) -> String {
        cadence(source, "a.test.ts", false).expect("it parses and has a test").code
    }

    #[test]
    fn each_statement_of_a_test_body_is_cut_on_its_own_line() {
        let source = "import { it } from 'vitest';\nit('adds', () => {\n  const x = add(1, 2);\n  expect(x).toBe(3);\n});\n";
        let out = cut(source);
        assert_eq!(out.lines().count(), source.lines().count());
        assert!(out.contains("  __vaC(3);const x = add(1, 2);\n  __vaC(4);expect(x).toBe(3);\n"), "{out}");
    }

    #[test]
    fn hooks_and_tests_inside_describe_are_cut() {
        let out = cut("describe('d', () => {\n  beforeEach(() => {\n    reset();\n  });\n  test('t', async function () {\n    await run();\n  });\n});\n");
        assert!(out.contains("__vaC(3);reset();"), "{out}");
        assert!(out.contains("__vaC(6);await run();"), "{out}");
        assert!(!out.contains("__vaC(2)"), "describe's own statements are not a test's: {out}");
    }

    #[test]
    fn a_nested_function_is_not_cut_and_a_nested_block_is() {
        let out = cut("it('t', () => {\n  act(() => {\n    render();\n  });\n  if (x) {\n    y();\n  } else if (z) {\n    w();\n  }\n});\n");
        assert!(out.contains("__vaC(2);act("), "{out}");
        assert!(!out.contains("__vaC(3)"), "{out}");
        assert!(out.contains("__vaC(6);y();"), "{out}");
        assert!(out.contains("} else if (z)"), "an else-if is never cut in front of: {out}");
        assert!(out.contains("__vaC(8);w();"), "{out}");
    }

    #[test]
    fn a_concise_body_is_cut_as_one_expression() {
        let out = cut("it('t', () => expect(f()).toBe(1));\ntest('o', () => ({ a: 1 }));\n");
        assert!(out.contains("() => (__vaC(1),expect(f()).toBe(1))"), "{out}");
        assert!(out.contains("() => (__vaC(2),({ a: 1 }))"), "{out}");
    }

    #[test]
    fn each_and_modifiers_reach_the_body() {
        let out = cut("it.each([1])('n %i', (n) => {\n  check(n);\n});\ntest.only('o', () => {\n  one();\n});\ntest.each`a`('t', () => {\n  two();\n});\n");
        assert!(out.contains("__vaC(2);check(n);"), "{out}");
        assert!(out.contains("__vaC(5);one();"), "{out}");
        assert!(out.contains("__vaC(8);two();"), "{out}");
    }

    #[test]
    fn an_unbraced_body_is_left_whole() {
        let out = cut("it('t', () => {\n  if (x) y();\n  for (;;) break;\n});\n");
        assert!(out.contains("__vaC(2);if (x) y();"), "{out}");
        assert!(out.contains("__vaC(3);for (;;) break;"), "{out}");
    }

    #[test]
    fn the_cut_function_is_declared_after_the_last_statement() {
        let out = cut("it('t', () => {\n  a();\n})\n// end");
        assert!(out.contains("})\n") || out.contains("});"), "{out}");
        assert!(out.contains(";function __vaC(l){"), "{out}");
        assert_eq!(out.lines().count(), 4);
        assert!(out.ends_with("// end"), "{out}");
    }

    #[test]
    fn lines_count_every_terminator() {
        let out = cut("it('t', () => {\r\n  a();\r\n  b();\u{2028}  c();\n});\n");
        assert!(out.contains("__vaC(2);a();"), "{out}");
        assert!(out.contains("__vaC(3);b();"), "{out}");
        assert!(out.contains("__vaC(4);c();"), "{out}");
    }

    #[test]
    fn a_file_with_no_test_body_or_no_parse_is_left_alone() {
        assert!(cadence("export const a = 1;\n", "a.test.ts", false).is_none());
        assert!(cadence("it('t', () => {", "a.test.ts", false).is_none());
    }

    #[test]
    fn jsx_in_a_test_parses_by_extension() {
        let out = cadence("it('t', () => {\n  render(<A />);\n});\n", "a.test.tsx", false).expect("tsx parses").code;
        assert!(out.contains("__vaC(2);render(<A />);"), "{out}");
    }

    #[test]
    fn a_describe_off_a_test_is_walked_not_cut() {
        let out = cut("test.describe('d', () => {\n  test.beforeEach(async () => {\n    await reset();\n  });\n  test('t', async () => {\n    await run();\n  });\n  test.describe.serial('s', () => {\n    test('u', () => {\n      go();\n    });\n  });\n});\n");
        assert!(!out.contains("__vaC(2)") && !out.contains("__vaC(5)") && !out.contains("__vaC(8)"), "a describe's own statements are not a test's: {out}");
        assert!(out.contains("__vaC(3);await reset();"), "{out}");
        assert!(out.contains("__vaC(6);await run();"), "{out}");
        assert!(out.contains("__vaC(10);go();"), "{out}");
    }

    fn awaited(source: &str) -> String {
        cadence(source, "/repo/e2e/a.spec.ts", true).expect("it parses and has a test").code
    }

    #[test]
    fn an_awaited_cut_waits_in_an_async_body_and_names_its_file() {
        let out = awaited("test('t', async ({ page }) => {\n  await page.goto('/');\n  check();\n});\ntest('s', () => {\n  go();\n});\ntest('c', async () => page.click());\n");
        assert!(out.contains("  __vaC(2)&&await __vaC.w;await page.goto('/');\n  __vaC(3)&&await __vaC.w;check();\n"), "{out}");
        assert!(out.contains("  __vaC(6);go();"), "a body that cannot wait is cut as it was: {out}");
        assert!(out.contains("async () => (__vaC(8)&&await __vaC.w,page.click())"), "{out}");
        assert!(out.contains("r.c(l,\"/repo/e2e/a.spec.ts\")"), "{out}");
        assert_eq!(out.lines().count(), 8);
    }

    #[test]
    fn an_awaited_cut_escapes_its_file_as_a_string() {
        let out = cadence("test('t', () => {\n  go();\n});\n", "C:\\e2e\\\"a\".spec.js", true).expect("it parses").code;
        assert!(out.contains("r.c(l,\"C:\\\\e2e\\\\\\\"a\\\".spec.js\")"), "{out}");
    }

    #[test]
    fn jsx_in_a_javascript_test_parses() {
        let out = cadence("it('t', () => {\n  render(<A />);\n});\n", "a.test.js", false).expect("js parses with jsx").code;
        assert!(out.contains("__vaC(2);render(<A />);"), "{out}");
    }
}
