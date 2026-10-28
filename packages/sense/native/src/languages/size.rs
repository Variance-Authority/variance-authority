//! How big one file read through a grammar is: its bytes, and the lines that
//! hold something outside a comment and outside whitespace — the rule
//! [`source_size.rs`](../source_size.rs) counts a module's lines by, over the
//! comments this grammar lexed rather than over any pattern of ours.
//!
//! No region count. The instrument cuts modules and nothing else, so for these
//! files it is a count nobody makes, and it is absent rather than zero.
//!
//! A tree with an error node is still sized. Recovery keeps lexing, so a comment
//! after the error is still a comment node and the lines are counted the way the
//! oxc path counts a module with a diagnostic: the text is all there, and what a
//! line holds does not depend on whether the statements around it made sense. A
//! comment the recovery swallowed whole into an error counts as code, which can
//! only overstate the file by that comment's lines.

// compass: variance-authority.reach.source-index

use tree_sitter::Tree;

use crate::grammar::Grammar;
use crate::source_size::{code_lines, Size};

/// One file's size, from its text and the tree its grammar parsed.
pub fn size_of(source: &str, tree: &Tree, grammar: Grammar) -> Size {
    Size {
        bytes: u32::try_from(source.len()).unwrap_or(u32::MAX),
        lines: code_lines(source, comments(tree, grammar.comments())),
        blocks: None,
    }
}

/// Every comment node's byte range, in source order. The walk does not enter a
/// comment, so a doc comment's marker or a nested block comment is never a
/// second range inside the first.
fn comments(tree: &Tree, kinds: &[&str]) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut cursor = tree.walk();
    loop {
        let node = cursor.node();
        let comment = kinds.contains(&node.kind());
        if comment {
            ranges.push((node.start_byte(), node.end_byte()));
        }
        if !comment && cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                return ranges;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grammar;

    fn size(grammar: Grammar, source: &str) -> Size {
        let tree = grammar::parse(grammar, source).expect("the grammar is linked");
        size_of(source, &tree, grammar)
    }

    #[test]
    fn every_comment_kind_named_is_one_the_grammar_declares() {
        for grammar in [Grammar::Python, Grammar::Rust, Grammar::Java, Grammar::Kotlin, Grammar::Swift] {
            let tree = grammar::parse(grammar, "").expect("the grammar is linked");
            for kind in grammar.comments() {
                assert_ne!(tree.language().id_for_node_kind(kind, true), 0, "{grammar:?} declares no `{kind}`");
            }
        }
    }

    #[test]
    fn a_rust_line_holding_only_a_comment_or_whitespace_is_not_code() {
        let source = concat!(
            "//! The crate's own doc.\n",
            "\n",
            "/// An item's doc.\n",
            "pub fn f() -> u32 { // tail\n",
            "    /* outer /* nested\n",
            "       still nested */ still outer */\n",
            "    \t\n",
            "    let s = \"// not a comment\";\n",
            "    /** a block doc */ 1 /* in */ + s.len() as u32\n",
            "}\n",
        );
        assert_eq!(size(Grammar::Rust, source), Size { bytes: source.len() as u32, lines: 4, blocks: None });
    }

    #[test]
    fn a_rust_block_comment_ending_mid_line_leaves_the_code_after_it_counted() {
        assert_eq!(size(Grammar::Rust, "/* a\n /* b */ */ const C: u8 = 1;\n").lines, 1);
    }

    #[test]
    fn a_python_docstring_is_code_and_a_comment_is_not() {
        let source = "# head\n\ndef f():\n    \"\"\"A docstring is a string.\"\"\"\n    # inside\n    return 1  # tail\n";
        assert_eq!(size(Grammar::Python, source), Size { bytes: source.len() as u32, lines: 3, blocks: None });
    }

    #[test]
    fn a_swift_and_a_kotlin_comment_are_the_grammars_own() {
        assert_eq!(size(Grammar::Swift, "// a\nimport Foundation\n/* b\n c */\nlet x = 1 // d\n").lines, 2);
        assert_eq!(size(Grammar::Kotlin, "// a\npackage p\n/** b\n c */\nval x = 1 // d\n").lines, 2);
    }

    #[test]
    fn a_tree_with_an_error_is_sized_and_its_later_comments_stay_comments() {
        let source = "fn f( {\n// after the error\nconst C: u8 = 1;\n";
        let tree = grammar::parse(Grammar::Rust, source).expect("the grammar is linked");
        assert!(tree.root_node().has_error());
        assert_eq!(size(Grammar::Rust, source).lines, 2);
    }
}
