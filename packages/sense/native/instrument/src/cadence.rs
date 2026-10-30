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

/// The bodies of `BODIES` that are a hook's, called alone or off a test, as Playwright's `test.beforeEach(…)`.
const HOOKS: [&str; 4] = ["beforeEach", "afterEach", "beforeAll", "afterAll"];

/// What the file declares to receive its cuts: one line, no newline.
const DECLARATION: &str =
    ";function __vaC(l,h){var r=globalThis.__VA__;if(r!=null&&typeof r.c===\"function\")r.c(l,void 0,h===1)}";

/// The test file with a cut before each statement of its test and hook bodies,
/// or nothing when it does not parse or holds no such body.
///
/// `awaited` is for a runner whose collector is not in the test's realm, as
/// Playwright's page is not: a statement of an async body awaits its cut, so
/// the collector can drain what the statement before it reached before this
/// one runs, and the cut names `file`, so a body declared in another file is
/// told apart. A body that cannot wait is cut as it is without it. A hook's
/// cut says it is a hook's in every realm, since a page runs hooks and tests in
/// one realm and nothing in it tells the hook running apart from the test.
pub fn cadence(source: &str, file: &str, awaited: bool) -> Option<Cadence> {
    let allocator = Allocator::new();
    let source_type = dialect(file).unwrap_or_default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if parsed.panicked || !parsed.diagnostics.is_empty() {
        return None;
    }
    let (registrars, hooks) = registrars(&parsed.program);
    let mut cuts = Cuts { lines: Lines::new(source), edits: Vec::new(), awaited, waits: false, hook: false, registrars, hooks };
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
    format!(";function __vaC(l,h){{var r=globalThis.__VA__;__vaC.w=r!=null&&typeof r.c===\"function\"?r.c(l,{named},h===1):void 0;return __vaC.w!=null}}")
}

struct Cuts {
    lines: Lines,
    edits: Vec<(u32, String)>,
    awaited: bool,
    /// Whether the body being cut can wait on its cuts.
    waits: bool,
    /// Whether the body being cut is a hook's, which its cuts say.
    hook: bool,
    /// The names a test or hook body is registered under in this file.
    registrars: Vec<String>,
    /// The names among them a hook body is registered under.
    hooks: Vec<String>,
}

impl Cuts {
    fn cut(&mut self, at: u32) {
        let call = self.call(at);
        self.edits.push((at, format!("{call};")));
    }

    /// The call a cut at `at` makes, waited on where the body can wait.
    fn call(&self, at: u32) -> String {
        let line = self.lines.at(at);
        let hook = if self.hook { ",1" } else { "" };
        let wait = if self.waits { "&&await __vaC.w" } else { "" };
        format!("__vaC({line}{hook}){wait}")
    }

    fn body(&mut self, function: &Argument) {
        match function {
            Argument::ArrowFunctionExpression(arrow) => {
                self.waits = self.awaited && arrow.r#async;
                match arrow.body.as_function_body() {
                    Some(body) => self.statements(&body.statements),
                    None => {
                        let span = arrow.body.span();
                        let call = self.call(span.start);
                        self.edits.push((span.start, format!("({call},")));
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
            if is_probe(statement) {
                continue;
            }
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
        let root = root_name(&it.callee);
        let registers = root.is_some_and(|name| self.registrars.iter().any(|known| known == name));
        if !registers || has_member(&it.callee, "describe") {
            return walk::walk_call_expression(self, it);
        }
        self.hook = root.is_some_and(|name| self.hooks.iter().any(|known| known == name)) || HOOKS.iter().any(|hook| has_member(&it.callee, hook));
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
/// make a test with fixtures, followed through any number of extensions; and
/// the names among them a hook is registered under.
fn registrars(program: &Program) -> (Vec<String>, Vec<String>) {
    let mut names: Vec<String> = BODIES.iter().map(|name| name.to_string()).collect();
    let mut hooks: Vec<String> = HOOKS.iter().map(|name| name.to_string()).collect();
    let mut extended: Vec<(&str, &str)> = Vec::new();
    for statement in &program.body {
        let declaration = match statement {
            Statement::ImportDeclaration(import) => {
                for specifier in import.specifiers.iter().flatten() {
                    if let ImportDeclarationSpecifier::ImportSpecifier(it) = specifier {
                        let imported = it.imported.name();
                        if BODIES.contains(&imported.as_str()) && it.local.name != imported {
                            names.push(it.local.name.to_string());
                            if HOOKS.contains(&imported.as_str()) {
                                hooks.push(it.local.name.to_string());
                            }
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
            return (names, hooks);
        }
    }
}

/// A statement the probes put in: a call to one of the names they emit. Where the
/// probes go in first, as in a page, it is not a statement of the test's.
fn is_probe(statement: &Statement) -> bool {
    let Statement::ExpressionStatement(it) = statement else { return false };
    is_probe_call(&it.expression)
}

// A probe is a call to one of ours, or a dormant one: `__vaL&&__vaL(...)`.
fn is_probe_call(expression: &Expression) -> bool {
    match expression {
        Expression::CallExpression(call) => is_probe_name(&call.callee),
        Expression::LogicalExpression(it) => is_probe_name(&it.left) && is_probe_call(&it.right),
        _ => false,
    }
}

// The names `place.rs` and `walk_capture.rs` emit, and the cut's own.
fn is_probe_name(callee: &Expression) -> bool {
    matches!(callee, Expression::Identifier(name) if matches!(name.name.as_str(), "__va" | "__vaR" | "__vaL" | "__vaC"))
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
#[path = "cadence_tests.rs"]
mod tests;
