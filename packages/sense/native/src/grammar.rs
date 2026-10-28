//! The tree-sitter grammars this build carries, and the parser one language gets.

use tree_sitter::{Language, Parser, Tree};

/// Every language read through tree-sitter here.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Grammar {
    Python,
    Rust,
    Java,
    Kotlin,
    Swift,
}

impl Grammar {
    pub fn of(id: &str) -> Option<Self> {
        match id {
            "python" => Some(Self::Python),
            "rust" => Some(Self::Rust),
            "java" => Some(Self::Java),
            "kotlin" => Some(Self::Kotlin),
            "swift" => Some(Self::Swift),
            _ => None,
        }
    }

    /// The node kinds this grammar lexes as comments: the symbols its own
    /// `extras` list beside whitespace (Python's `line_continuation` is the one
    /// extra that is not a comment). Named here because the grammar decides what
    /// a comment is, and a test holds every name to a kind the grammar declares.
    pub fn comments(self) -> &'static [&'static str] {
        match self {
            Self::Python => &["comment"],
            Self::Rust | Self::Java | Self::Kotlin => &["line_comment", "block_comment"],
            Self::Swift => &["comment", "multiline_comment"],
        }
    }

    fn language(self) -> Language {
        match self {
            Self::Python => tree_sitter_python::LANGUAGE.into(),
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
            Self::Java => tree_sitter_java::LANGUAGE.into(),
            Self::Kotlin => tree_sitter_kotlin_ng::LANGUAGE.into(),
            Self::Swift => tree_sitter_swift::LANGUAGE.into(),
        }
    }
}

/// Parse one file's bytes, or nothing when the parser could not be built.
pub fn parse(grammar: Grammar, source: &str) -> Option<Tree> {
    let mut parser = Parser::new();
    parser.set_language(&grammar.language()).ok()?;
    parser.parse(source, None)
}
