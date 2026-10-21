//! A fault: one region of a module skipped, to ask whether the tests that ran it notice.
//!
//! A recording says which cases entered a region. It cannot say whether any of
//! them would fail if the region did something else: a case can run every line
//! of a function and check none of what it did. So a run can be asked to skip
//! one region — every other line as written — and the cases that entered it
//! either go red or pass whatever it does. That is mutation testing, with one
//! mutation per region and the record choosing the cases each one runs.
//!
//! The region is the walk's, by its ordinal, so a fault names what a recording
//! names. Skipping keeps every line: the replaced text keeps its line breaks,
//! and what is put in its place is written in front of them. What stands in the
//! region's place depends on what the region is:
//!
//! - a function's block body is emptied after its directives, and an
//!   expression body becomes `void 0`: the call returns nothing;
//! - an arm, a loop body, a `catch` or a `finally` block is emptied, and a bare
//!   statement becomes `;`;
//! - a `case` becomes `break;`, so it does nothing rather than falling through;
//! - the statements after a decision become `;`.
//!
//! The module itself, an `await`'s resumption, the `else` or `default` the walk
//! adds and a declaration the walk hoists have no text of their own to skip, so
//! a fault on one is refused rather than placed somewhere near it.

use oxc_allocator::Allocator;
use oxc_parser::Parser;

use crate::dialect::dialect;
use crate::walk::Walker;

/// What one region is skipped by: the bytes it replaces, and what goes there.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Skip {
    pub ordinal: u32,
    pub start: u32,
    pub end: u32,
    pub with: &'static str,
}

impl Walker {
    /// Note how `ordinal` is skipped, when the walk was asked to.
    pub(crate) fn skip(&mut self, ordinal: u32, start: u32, end: u32, with: &'static str) {
        if let Some(skips) = &mut self.skips {
            skips.push(Skip { ordinal, start, end, with });
        }
    }
}

/// The module's text with region `ordinal` skipped, on the same lines; nothing
/// when the text does not parse or the region has no text of its own to skip.
pub fn faulted(source: &str, file: &str, ordinal: u32) -> Option<String> {
    let allocator = Allocator::default();
    let source_type = dialect(file).unwrap_or_default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if parsed.panicked || !parsed.diagnostics.is_empty() {
        return None;
    }
    let walker = crate::cut::walk_with(&parsed.program, source_type.is_typescript(), false, |walker| {
        walker.skips = Some(Vec::new());
    });
    let skip = walker.skips?.into_iter().find(|skip| skip.ordinal == ordinal)?;
    let (start, end) = (skip.start as usize, skip.end as usize);
    let mut out = String::with_capacity(source.len());
    out.push_str(&source[..start]);
    out.push_str(skip.with);
    out.extend(source[start..end].chars().filter(|&c| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')));
    out.push_str(&source[end..]);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::faulted;
    use crate::cut::cut;

    /// The ordinal of the first region the walk opens under `path` in `name`.
    fn ordinal(source: &str, name: &str, path: &str) -> u32 {
        let cut = cut(source, "a.ts", false).expect("the fixture parses");
        cut.blocks.iter().position(|block| block.name == name && block.path == path).expect("the region exists") as u32
    }

    fn skipped(source: &str, name: &str, path: &str) -> String {
        let text = faulted(source, "a.ts", ordinal(source, name, path)).expect("the region can be skipped");
        assert_eq!(text.lines().count(), source.lines().count(), "every line stays: {text}");
        assert!(cut(&text, "a.ts", false).is_some(), "the skipped text parses: {text}");
        text
    }

    #[test]
    fn a_function_body_is_emptied_after_its_directives() {
        let source = "function f(a) {\n  'use strict';\n  a.push(1);\n  return a;\n}\n";
        assert_eq!(skipped(source, "f", "entry"), "function f(a) {\n  'use strict';\n\n\n}\n");
    }

    #[test]
    fn an_expression_body_returns_nothing() {
        let source = "const f = (a) =>\n  a * 2;\n";
        assert_eq!(skipped(source, "f", "entry"), "const f = (a) =>\n  void 0;\n");
    }

    #[test]
    fn an_arm_is_emptied_and_a_bare_one_becomes_an_empty_statement() {
        let source = "function f(a) {\n  if (a) {\n    a.x = 1;\n  } else a.y = 2;\n}\n";
        assert_eq!(skipped(source, "f", "if#0/then"), "function f(a) {\n  if (a) {\n\n} else a.y = 2;\n}\n");
        assert_eq!(skipped(source, "f", "if#0/else"), "function f(a) {\n  if (a) {\n    a.x = 1;\n  } else ;\n}\n");
    }

    #[test]
    fn a_loop_body_and_a_handler_are_emptied() {
        let source = "function f(a) {\n  for (const x of a) {\n    g(x);\n  }\n  try { g(a); } catch { h(); }\n}\n";
        assert_eq!(skipped(source, "f", "for#0/body"), "function f(a) {\n  for (const x of a) {\n\n}\n  try { g(a); } catch { h(); }\n}\n");
        assert_eq!(skipped(source, "f", "try#0/catch"), "function f(a) {\n  for (const x of a) {\n    g(x);\n  }\n  try { g(a); } catch {}\n}\n");
    }

    #[test]
    fn a_case_does_nothing_rather_than_falling_through() {
        let source = "function f(a) {\n  switch (a) {\n    case 1:\n      g();\n    case 2:\n      h();\n  }\n}\n";
        assert_eq!(skipped(source, "f", "switch#0/case#0"), "function f(a) {\n  switch (a) {\n    case 1:\n      break;\n    case 2:\n      h();\n  }\n}\n");
    }

    #[test]
    fn the_statements_after_a_decision_are_skipped_together() {
        let source = "function f(a) {\n  if (a) return 1;\n  g();\n  return 2;\n}\n";
        assert_eq!(skipped(source, "f", "if#0/after"), "function f(a) {\n  if (a) return 1;\n  ;\n\n}\n");
    }

    #[test]
    fn a_region_with_no_text_of_its_own_is_refused() {
        let source = "async function f(a) {\n  if (a) g();\n  await a;\n}\n";
        assert_eq!(faulted(source, "a.ts", 0), None, "the module");
        assert_eq!(faulted(source, "a.ts", ordinal(source, "f", "if#0/else")), None, "the else the walk adds");
        assert_eq!(faulted(source, "a.ts", ordinal(source, "f", "await#0")), None, "a resumption");
        assert_eq!(faulted("function f( {", "a.ts", 1), None, "a text that does not parse");
    }
}
