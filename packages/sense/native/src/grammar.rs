//! The tree-sitter grammars this build carries, and the parser one language gets.

use std::sync::OnceLock;

use tree_sitter::{Language, Node, Parser, Tree};

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

    /// Every node kind this grammar names, by id, so a walk reads a node's
    /// kind from the table: `Node::kind` measures the name's C string and
    /// checks it is UTF-8 on every call, and a reader asks it of every node.
    pub fn kinds(self) -> Kinds {
        static KINDS: [OnceLock<Vec<&'static str>>; 5] = [const { OnceLock::new() }; 5];
        Kinds(KINDS[self as usize].get_or_init(|| {
            // Held for the process, as the table is: `node_kind_for_id` lends
            // its names for as long as the language it is asked of.
            let language: &'static Language = Box::leak(Box::new(self.language()));
            (0..language.node_kind_count())
                .map(|id| u16::try_from(id).ok().and_then(|id| language.node_kind_for_id(id)).unwrap_or_default())
                .collect()
        }))
    }

    /// Whether each node kind, by id, is one of [`Grammar::comments`].
    pub fn comment_kinds(self) -> &'static [bool] {
        static COMMENTS: [OnceLock<Vec<bool>>; 5] = [const { OnceLock::new() }; 5];
        COMMENTS[self as usize].get_or_init(|| self.kinds().0.iter().map(|kind| self.comments().contains(kind)).collect())
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

/// A grammar's node kinds by id, from [`Grammar::kinds`].
#[derive(Clone, Copy)]
pub struct Kinds(&'static [&'static str]);

impl Kinds {
    /// The kind of `node`, as `Node::kind` names it. An id past the table is
    /// one the parser makes rather than the grammar, such as `ERROR`.
    pub fn of<'tree>(self, node: Node<'tree>) -> &'tree str {
        match self.0.get(usize::from(node.kind_id())) {
            Some(kind) => kind,
            None => node.kind(),
        }
    }
}

/// Parse one file's bytes, or nothing when the parser could not be built.
pub fn parse(grammar: Grammar, source: &str) -> Option<Tree> {
    let mut parser = Parser::new();
    parser.set_language(&grammar.language()).ok()?;
    parser.parse(source, None)
}
