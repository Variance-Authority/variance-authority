//! Top-level declaration facts reduced while OXC's arena is still resident.

use std::collections::HashMap;

use oxc_ast::ast::{Program, Statement};
use oxc_span::Span;
use serde::Serialize;

use crate::read::Lines;
use crate::top_level::top_level;

#[derive(Clone, Copy, Debug, Serialize)]
pub struct TextSpan {
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct SourceSymbol {
    pub name: String,
    pub kind: &'static str,
    pub line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<TextSpan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<TextSpan>,
    /// Who can name it when no export of its file binds it, as the reader of
    /// its language knows: one of [`REACHES`]; absent when the reader cannot
    /// tell, as for a script, whose top level is global or handed out through
    /// `module.exports`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reach: Option<&'static str>,
}

/// A function another function's body declares, as [`crate::nested`] finds
/// it: a name its holder alone can call. Kept apart from [`SourceSymbol`], so a
/// reader of a file's top level never meets one.
#[derive(Clone, Debug, Serialize)]
pub struct NestedSymbol {
    pub name: String,
    pub kind: &'static str,
    pub line: u32,
    pub signature: TextSpan,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<TextSpan>,
    /// The name of the function that holds it; absent when nothing names that
    /// function, as for a callback.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub holder: Option<String>,
    /// The line the function that holds it starts on.
    #[serde(rename = "holderLine")]
    pub holder_line: u32,
}

/// Every reach a symbol records, in the order the index stores them, from 1:
/// its file alone (an ES module, a Swift or Kotlin `private`), its module and
/// the modules inside it (a Rust item that is not `pub`), and any module that
/// imports it by name, kept out of `from … import *` by a leading underscore or
/// by `__all__` (Python).
pub const REACHES: [&str; 4] = ["file", "module", "underscore", "all"];

/// A reach as the index stores it; 0 is none.
pub fn reach_code(reach: Option<&str>) -> u8 {
    reach.and_then(|reach| REACHES.iter().position(|known| *known == reach)).map_or(0, |at| at as u8 + 1)
}

/// The reach the index stored as `code`.
pub fn reach_of(code: u8) -> Option<&'static str> {
    code.checked_sub(1).and_then(|at| REACHES.get(at as usize)).copied()
}

struct Offsets {
    utf16: Option<Vec<u32>>,
}

impl Offsets {
    fn new(source: &str) -> Self {
        if source.is_ascii() {
            return Self { utf16: None };
        }
        let mut offsets = vec![0; source.len() + 1];
        let mut units = 0u32;
        for (byte, character) in source.char_indices() {
            offsets[byte] = units;
            units += character.len_utf16() as u32;
            offsets[byte + character.len_utf8()] = units;
        }
        Self {
            utf16: Some(offsets),
        }
    }

    fn at(&self, byte: u32) -> u32 {
        self.utf16
            .as_ref()
            .and_then(|offsets| offsets.get(byte as usize).copied())
            .unwrap_or(byte)
    }

    fn span(&self, span: Span) -> TextSpan {
        TextSpan {
            start: self.at(span.start),
            end: self.at(span.end),
        }
    }
}

pub struct Harvest {
    pub symbols: Vec<SourceSymbol>,
    /// Every function a function's body declares, in source order.
    pub nested: Vec<NestedSymbol>,
    docs: HashMap<u32, TextSpan>,
    /// The role tags a doc declares, by where its subject starts; only docs that declare one.
    pub tagged: HashMap<u32, u8>,
    /// The module's own doc comment, inside its marks: the first `/**` that
    /// ends before the first statement that is not an import and documents no
    /// such statement. A doc above an import is the module's, since an import
    /// is not documented. A leading licence header written as `/**` is read as
    /// the module's doc too: no tag is asked for, unlike TypeDoc's `@module`.
    pub module_doc: Option<TextSpan>,
    offsets: Offsets,
}

impl Harvest {
    pub fn new(program: &Program<'_>, source: &str, lines: &Lines, symbols: bool) -> Self {
        let offsets = Offsets::new(source);
        let mut docs = HashMap::new();
        let mut tagged = HashMap::new();
        let first = program
            .body
            .iter()
            .find(|statement| !matches!(statement, Statement::ImportDeclaration(_)))
            .map(|statement| oxc_span::GetSpan::span(statement).start);
        let mut module_doc = None;
        for comment in &program.comments {
            let start = comment.span.start as usize;
            if !comment.is_block()
                || !source
                    .as_bytes()
                    .get(start..start + 3)
                    .is_some_and(|value| value == b"/**")
            {
                continue;
            }
            let mut subject = comment.span.end as usize;
            while let Some(character) = source.get(subject..).and_then(|rest| rest.chars().next()) {
                if !character.is_whitespace() {
                    break;
                }
                subject += character.len_utf8();
            }
            let tags = source
                .get(start + 3..(comment.span.end as usize).saturating_sub(2))
                .map_or(0, crate::declared_role::tags_in);
            if tags != 0 {
                tagged.insert(subject as u32, tags);
            }
            let doc = offsets.span(Span::new(comment.span.start + 2, comment.span.end - 2));
            if module_doc.is_none() && first.is_none_or(|first| comment.span.end <= first && subject as u32 != first) {
                module_doc = Some(doc);
            }
            docs.insert(subject as u32, doc);
        }

        let mut harvest = Self {
            symbols: Vec::new(),
            nested: Vec::new(),
            docs,
            tagged,
            module_doc,
            offsets,
        };
        if symbols {
            top_level(program, |bound| {
                // An `import x = require()` binds a name and declares nothing.
                if bound.kind == "import" {
                    return;
                }
                let doc = harvest.doc(bound.statement.start);
                harvest.push(bound.name.to_owned(), bound.kind, lines.at(bound.statement.start), doc, bound.signature);
            });
            harvest.nested = crate::nested::nested(program)
                .into_iter()
                .map(|found| NestedSymbol {
                    doc: harvest.doc(found.statement.start),
                    signature: harvest.span(found.signature),
                    line: lines.at(found.statement.start),
                    holder_line: lines.at(found.holder_at),
                    name: found.name,
                    kind: found.kind,
                    holder: found.holder,
                })
                .collect();
        }
        harvest
    }

    pub fn span(&self, span: Span) -> TextSpan {
        self.offsets.span(span)
    }

    pub fn doc(&self, at: u32) -> Option<TextSpan> {
        self.docs.get(&at).copied()
    }

    fn push(
        &mut self,
        name: String,
        kind: &'static str,
        line: u32,
        doc: Option<TextSpan>,
        signature: Option<Span>,
    ) {
        self.symbols.push(SourceSymbol {
            name,
            kind,
            line,
            signature: signature.map(|span| self.span(span)),
            doc,
            reach: None,
        });
    }
}
