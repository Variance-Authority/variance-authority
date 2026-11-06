//! The blocks a test file writes: a `describe`, an `it` or a `test` called with
//! a title. This reads the words the journeys read a runner by and no others: a
//! block written any other way is not worked out from its source, because a case
//! that ran is named by the record.
//!
//! A rule a repository holds only as a test is declared nowhere else: its title
//! says what must be true and the doc above the call says why, and neither is a
//! name. So each block is kept beside the symbols, never among them, where a
//! reader of a file's top level does not meet it and `search` does.
//!
//! The call is known by the word it starts from, through the members a runner
//! writes after it: `it.skip`, `test.describe`, `it.each(rows)`, `it.each` over
//! a template. `regex.test(text)` starts from `regex`, so it is no block, and
//! `it.replace('a', 'b')` writes no runner's member, so `it` is a value there. A
//! block has a title and something the title stands for, or says `todo`. A title
//! a row fills in whole, `%s` under `it.each`, spells nothing, so it is no row, and
//! the doc above it goes with it.

// compass: variance-authority.reach.source-index

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};

/// One titled test block.
pub(crate) struct TestBlock {
    /// The title as written; a template's holes read `*`.
    pub(crate) title: String,
    /// Where its statement starts when the call opens one behind an `await` or
    /// a `void`, else where the call starts: its line and its doc are read here.
    pub(crate) at: u32,
}

/// Every titled test block in `program`, in source order.
pub(crate) fn test_blocks(program: &Program<'_>) -> Vec<TestBlock> {
    let mut walker = Walker::default();
    walker.visit_program(program);
    walker.found
}

/// The title a call's first argument writes: a string, or a template whose holes read `*`.
pub(crate) fn title(arguments: &[Argument<'_>]) -> Option<String> {
    match arguments.first() {
        Some(Argument::StringLiteral(it)) => it.value.as_str().map(str::to_owned),
        Some(Argument::TemplateLiteral(it)) => {
            let parts = it.quasis.iter().map(|quasi| quasi.value.cooked.map_or(Some(""), |cooked| cooked.as_str()));
            parts.collect::<Option<Vec<_>>>().map(|parts| parts.join("*"))
        }
        _ => None,
    }
}

/// The words a runner's block starts from.
pub(crate) const RUNNER_WORDS: [&str; 3] = ["describe", "it", "test"];

/// What a runner writes after one of those words.
pub(crate) const RUNNER_MEMBERS: [&str; 6] = ["concurrent", "describe", "each", "only", "skip", "todo"];

/// Whether `callee` starts from a block's word, and if so whether it says `todo`.
fn block_callee(callee: &Expression<'_>) -> Option<bool> {
    match callee {
        Expression::Identifier(it) => RUNNER_WORDS.contains(&it.name.as_str()).then_some(false),
        Expression::StaticMemberExpression(it) if RUNNER_MEMBERS.contains(&it.property.name.as_str()) => {
            block_callee(&it.object).map(|todo| todo || it.property.name == "todo")
        }
        Expression::CallExpression(it) => block_callee(&it.callee),
        Expression::TaggedTemplateExpression(it) => block_callee(&it.tag),
        _ => None,
    }
}

/// Whether a title writes a word. `%s` and `$name` are holes only where `rows` fill them, so only there are they read past; a template's `*` never spells.
fn spells(title: &str, rows: bool) -> bool {
    if !rows {
        return title.chars().any(char::is_alphanumeric);
    }
    let mut characters = title.chars();
    while let Some(character) = characters.next() {
        match character {
            '%' => { characters.next(); }
            '$' => { characters.by_ref().find(|next| !next.is_alphanumeric() && !matches!(next, '_' | '.')); }
            _ if character.is_alphanumeric() => return true,
            _ => {}
        }
    }
    false
}

#[derive(Default)]
struct Walker {
    found: Vec<TestBlock>,
    /// Where a call behind an `await` or a `void` starts, and where its statement does.
    opened: Option<(u32, u32)>,
}

impl<'a> Visit<'a> for Walker {
    fn visit_expression_statement(&mut self, statement: &ExpressionStatement<'a>) {
        let mut inner = &statement.expression;
        loop {
            inner = match inner {
                Expression::AwaitExpression(it) => &it.argument,
                Expression::UnaryExpression(it) if it.operator == UnaryOperator::Void => &it.argument,
                _ => break,
            };
        }
        if let Expression::CallExpression(call) = inner {
            self.opened = Some((call.span.start, statement.span.start));
        }
        walk::walk_expression_statement(self, statement);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if block_callee(&call.callee).is_some_and(|todo| todo || call.arguments.len() >= 2) {
            let rows = matches!(call.callee, Expression::CallExpression(_) | Expression::TaggedTemplateExpression(_));
            if let Some(title) = title(&call.arguments).filter(|title| spells(title, rows)) {
                let at = self.opened.filter(|(opens, _)| *opens == call.span.start).map_or(call.span.start, |(_, statement)| statement);
                self.found.push(TestBlock { title: title.split_whitespace().collect::<Vec<_>>().join(" "), at });
            }
        }
        walk::walk_call_expression(self, call);
    }
}

#[cfg(test)]
mod tests {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    use super::*;

    fn titles(source: &str) -> Vec<String> {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
        test_blocks(&parsed.program).into_iter().map(|block| block.title).collect()
    }

    #[test]
    fn every_runner_spelling_of_a_block_is_read_in_source_order() {
        let source = "describe('outer', () => {
            it('plain', run);
            it.skip('skipped', run);
            it.each([1])('row %s stays', run);
            it.each`a\n${1}`('tagged', run);
            test.describe('playwright', run);
            it.todo\n('later');
        });";
        assert_eq!(titles(source), ["outer", "plain", "skipped", "row %s stays", "tagged", "playwright", "later"]);
    }

    #[test]
    fn a_template_title_keeps_its_words_and_reads_its_holes_as_stars() {
        assert_eq!(titles("it(`adds ${a} and ${b}`, run);"), ["adds * and *"]);
    }

    #[test]
    fn a_call_that_is_not_a_block_is_no_row() {
        assert!(titles("pattern.test('text', 1); check('title', run); it(title, run); it('alone');").is_empty());
    }

    #[test]
    fn a_member_no_runner_writes_is_a_value_called_it() {
        assert!(titles("rows.map((it) => it.replace('a word', 'b')); test.set('key', 1); it.startsWith('a', 1);").is_empty());
    }

    #[test]
    fn a_title_on_two_lines_reads_as_one() {
        assert_eq!(titles("it('holds \\n  on two lines', run);"), ["holds on two lines"]);
    }

    #[test]
    fn a_title_nothing_fills_in_is_read_as_it_is_written() {
        assert_eq!(titles("describe('$watch', run); it('$emit', run); it.each(rows)('$emit', run);"), ["$watch", "$emit"]);
    }

    #[test]
    fn a_title_a_row_fills_in_whole_spells_nothing() {
        assert!(titles("it.each(rows)('%s', run); it.each(rows)('$name', run); it.each(rows)('$a.b - %s', run); it(`${a}`, run);").is_empty());
    }
}
