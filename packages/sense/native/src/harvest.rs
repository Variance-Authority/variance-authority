//! Top-level declaration facts reduced while OXC's arena is still resident.

use std::collections::HashMap;

use oxc_ast::ast::Program;
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
    docs: HashMap<u32, TextSpan>,
    /// The role tags a doc declares, by where its subject starts; only docs that declare one.
    pub tagged: HashMap<u32, u8>,
    offsets: Offsets,
}

impl Harvest {
    pub fn new(program: &Program<'_>, source: &str, lines: &Lines, symbols: bool) -> Self {
        let offsets = Offsets::new(source);
        let mut docs = HashMap::new();
        let mut tagged = HashMap::new();
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
            docs.insert(
                subject as u32,
                offsets.span(Span::new(comment.span.start + 2, comment.span.end - 2)),
            );
        }

        let mut harvest = Self {
            symbols: Vec::new(),
            docs,
            tagged,
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
        });
    }
}
