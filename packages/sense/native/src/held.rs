//! A parse JavaScript held — `Parsed` in `cache.ts` — as a row of the
//! generation a cold build publishes from this side.
//!
//! The walk reads only modules. A stylesheet, a Python file or a manifest is
//! read on the JavaScript side, and its parse is cached there; those parses
//! cross here once, with the rest of what JavaScript adds, so the generation
//! is written in one place. They keep JavaScript's meaning of absence, which
//! is not the walk's: an export list that is present and empty is written as
//! present, and a missing line is the zero `Uint32Array.from` makes of it.

// compass: variance-authority.reach.source-index

use serde::Deserialize;

use crate::parse_columns::{ParseColumns, ParseRow, Span};
use crate::segment::{Collected, Strings};

#[derive(Debug, Deserialize)]
pub struct HeldBinding {
    imported: String,
    local: String,
    #[serde(default, rename = "type")]
    type_only: bool,
    #[serde(default)]
    line: u32,
}

#[derive(Debug, Deserialize)]
pub struct HeldRequest {
    value: String,
    kind: String,
    #[serde(default)]
    bindings: Vec<HeldBinding>,
    #[serde(default)]
    line: u32,
}

/// `TextSpan` in `harvest.ts`; an end JavaScript did not write reads as absent.
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct HeldSpan {
    start: Option<u32>,
    end: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct HeldExport {
    exported: Option<String>,
    local: Option<String>,
    from: Option<String>,
    imported: Option<String>,
    #[serde(default, rename = "type")]
    type_only: bool,
    #[serde(default)]
    line: u32,
    signature: Option<HeldSpan>,
    doc: Option<HeldSpan>,
    #[serde(default, rename = "roles", deserialize_with = "crate::declared_role::deserialize")]
    tags: u8,
}

#[derive(Debug, Deserialize)]
pub struct HeldSymbol {
    name: String,
    kind: String,
    #[serde(default)]
    line: u32,
    signature: Option<HeldSpan>,
    doc: Option<HeldSpan>,
}

#[derive(Debug, Default, Deserialize)]
pub struct HeldMocks {
    #[serde(default)]
    minus: Vec<String>,
    #[serde(default)]
    plus: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct HeldMember {
    #[serde(default)]
    request: u32,
    name: String,
    #[serde(default)]
    line: u32,
}

#[derive(Debug, Deserialize)]
pub struct HeldParse {
    requests: Vec<HeldRequest>,
    exports: Option<Vec<HeldExport>>,
    #[serde(default)]
    symbols: Vec<HeldSymbol>,
    #[serde(default)]
    harvested: bool,
    declares: Option<Vec<String>>,
    #[serde(default)]
    mocks: HeldMocks,
    #[serde(default)]
    members: Vec<HeldMember>,
    unknown: Option<String>,
    #[serde(default)]
    size: Option<crate::source_size::Size>,
}

/// Both ends, each `NONE` where JavaScript's `optional` would write it.
fn span(value: Option<HeldSpan>) -> Span {
    use crate::segment::NONE;
    value.map(|span| (span.start.unwrap_or(NONE), span.end.unwrap_or(NONE)))
}

impl ParseRow for HeldParse {
    fn strings<'s>(&'s self, values: &mut Collected<'s>) {
        for request in &self.requests {
            values.insert(&request.value);
            values.insert(&request.kind);
            for binding in &request.bindings {
                values.insert(&binding.imported);
                values.insert(&binding.local);
            }
        }
        for export in self.exports.iter().flatten() {
            for value in [&export.exported, &export.local, &export.from, &export.imported].into_iter().flatten() {
                values.insert(value);
            }
        }
        for symbol in &self.symbols {
            values.insert(&symbol.name);
            values.insert(&symbol.kind);
        }
        values.extend(self.mocks.minus.iter().map(String::as_str));
        values.extend(self.mocks.plus.iter().map(String::as_str));
        values.extend(self.members.iter().map(|member| member.name.as_str()));
        values.extend(self.declares.iter().flatten().map(String::as_str));
        values.extend(self.unknown.as_deref());
    }

    fn write(&self, strings: &Strings, into: &mut ParseColumns) {
        let id = |value: &str| strings.id(value);
        for request in &self.requests {
            into.request(
                id(&request.value),
                id(&request.kind),
                request.line,
                request.bindings.iter().map(|binding| {
                    (id(&binding.imported), id(&binding.local), binding.type_only, binding.line)
                }),
            );
        }
        for export in self.exports.iter().flatten() {
            into.export(
                [&export.exported, &export.local, &export.from, &export.imported]
                    .map(|value| strings.optional(value.as_deref())),
                export.type_only,
                export.line,
                span(export.signature),
                span(export.doc),
                export.tags,
            );
        }
        for symbol in &self.symbols {
            into.symbol(id(&symbol.name), id(&symbol.kind), symbol.line, span(symbol.signature), span(symbol.doc));
        }
        for name in self.declares.iter().flatten() {
            into.declare(id(name));
        }
        into.mock(self.mocks.minus.iter().map(|value| id(value)), self.mocks.plus.iter().map(|value| id(value)));
        for member in &self.members {
            into.member(member.request, id(&member.name), member.line);
        }
    }

    fn exports_present(&self) -> bool {
        self.exports.is_some()
    }

    fn declares_present(&self) -> bool {
        self.declares.is_some()
    }

    fn unknown(&self) -> Option<&str> {
        self.unknown.as_deref()
    }

    fn harvested(&self) -> bool {
        self.harvested
    }

    fn size(&self) -> Option<crate::source_size::Size> {
        self.size
    }
}
