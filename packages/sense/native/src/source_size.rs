//! How big one module is, read off the parse the scan already made: its bytes,
//! the lines that hold code, and the regions the instrument would cut it into.
//!
//! The regions are the instrument's own walk over this parse's program, under
//! the rule a recorder cuts by (`presence`), so a module no suite loaded is
//! counted in the unit a module a suite loaded is counted in. Only regions with
//! source of their own are counted — `end > start`, the rule
//! `coverage-rows.ts` records `source` by — because a synthesized `else` is
//! nothing anybody wrote. A parse with a diagnostic has no region count: the
//! instrument does not cut a module it cannot parse, and a count it would never
//! make is absent rather than zero.
//!
//! A file read through a tree-sitter grammar is sized by
//! [`languages/size.rs`](./languages/size.rs), with this file's line rule over
//! the grammar's comments and no region count.

// compass: variance-authority.reach.source-index

use oxc_ast::ast::Program;
use serde::{Deserialize, Serialize};

use crate::instrument::typescript_start;
use crate::instrument_walk::{Kind, Walker};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Size {
    pub bytes: u32,
    /// Lines holding something outside a comment and outside whitespace.
    pub lines: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocks: Option<u32>,
}

/// One module's size, from its text and the program parsed from it.
pub fn size_of(source: &str, program: &Program, typescript: bool, parsed: bool) -> Size {
    Size {
        bytes: u32::try_from(source.len()).unwrap_or(u32::MAX),
        lines: code_lines(source, program.comments.iter().map(|comment| (comment.span.start as usize, comment.span.end as usize))),
        blocks: parsed.then(|| blocks(program, typescript)),
    }
}

fn blocks(program: &Program, typescript: bool) -> u32 {
    let mut walker = Walker::new(false);
    let start = if typescript { typescript_start(program) } else { program.span.start };
    walker.open(Kind::Module, "module", start, program.span.end, None);
    walker.list(&program.body, "", 0);
    walker.blocks.iter().filter(|block| block.end > block.start).count() as u32
}

/// Lines with a byte that is neither whitespace nor inside a comment. `comments`
/// are byte ranges in source order, none inside another — how oxc collects them,
/// and how a walk over a tree-sitter tree that stops at a comment finds them.
pub(crate) fn code_lines(source: &str, comments: impl IntoIterator<Item = (usize, usize)>) -> u32 {
    let bytes = source.as_bytes();
    let mut comments = comments.into_iter().peekable();
    let mut count = 0u32;
    let mut counted = false;
    let mut at = 0usize;
    while at < bytes.len() {
        if let Some(&(start, end)) = comments.peek() {
            if at >= start {
                comments.next();
                // A comment's newlines still end lines.
                for &byte in &bytes[at..end.min(bytes.len())] {
                    if byte == b'\n' {
                        counted = false;
                    }
                }
                at = end.max(at);
                continue;
            }
        }
        match bytes[at] {
            b'\n' => counted = false,
            b' ' | b'\t' | b'\r' | 0x0b | 0x0c => {}
            _ if !counted => {
                counted = true;
                count += 1;
            }
            _ => {}
        }
        at += 1;
    }
    count
}

#[cfg(test)]
mod tests {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    use super::*;

    fn size(source: &str) -> Size {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
        size_of(source, &parsed.program, true, parsed.diagnostics.is_empty())
    }

    #[test]
    fn a_line_holding_only_a_comment_or_whitespace_is_not_code() {
        let source = "// head\n\nexport const a = 1; // tail\n/* one\n two */\n  \nconst b = /* in */ 2;\n";
        assert_eq!(size(source), Size { bytes: source.len() as u32, lines: 2, blocks: Some(1) });
    }

    #[test]
    fn a_comment_ending_mid_line_leaves_the_code_after_it_counted() {
        assert_eq!(size("/* a\n b */ const c = 1;\n").lines, 1);
    }

    #[test]
    fn regions_are_the_ones_the_instrument_cuts_with_source() {
        let source = "export function f(a: boolean) {\n  if (a) {\n    return 1;\n  }\n  for (const x of [1]) g(x);\n  try { g(0) } catch { return 3 }\n  return 2;\n}\nfunction g(x: number) { return x ? x : 0 }\n";
        let cut = crate::instrument::instrument(source, "a.ts", false).expect("the instrument cuts it");
        let own = cut.blocks.iter().filter(|block| block.end > block.start).count() as u32;
        assert!(own > 4, "a source with a branch, a loop and a handler cuts more than the module and two functions");
        assert_eq!(size(source).blocks, Some(own));
    }

    #[test]
    fn a_module_that_does_not_parse_has_no_region_count() {
        assert_eq!(size("export const = ;\n").blocks, None);
    }
}
