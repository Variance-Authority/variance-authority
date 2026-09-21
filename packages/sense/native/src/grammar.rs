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
