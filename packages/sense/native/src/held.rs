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

use serde::{Deserialize, Serialize};

use crate::parse_columns::{ParseColumns, ParseRow};
use crate::segment::{Collected, Strings};

#[derive(Debug, Deserialize, Serialize)]
pub struct HeldBinding {
    imported: String,
    local: String,
    #[serde(default, rename = "type")]
    type_only: bool,
    #[serde(default)]
    line: u32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HeldRequest {
    value: String,
    kind: String,
    #[serde(default)]
    bindings: Vec<HeldBinding>,
    #[serde(default)]
    line: u32,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    guessed: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    item: bool,
    /// `republishes` in `read.rs`; absent is an import, as JavaScript writes none for one.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    republishes: bool,
}

/// `TextSpan` in `harvest.ts`; an end JavaScript did not write reads as absent,
/// and so does a text it did not keep.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct HeldSpan {
    #[serde(skip_serializing_if = "Option::is_none")]
    start: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HeldExport {
    #[serde(skip_serializing_if = "Option::is_none")]
    exported: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    local: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    imported: Option<String>,
    #[serde(default, rename = "type")]
    type_only: bool,
    #[serde(default)]
    line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<HeldSpan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    doc: Option<HeldSpan>,
    #[serde(default, rename = "roles", deserialize_with = "crate::declared_role::deserialize", serialize_with = "crate::declared_role::serialize", skip_serializing_if = "no_roles")]
    tags: u8,
    #[serde(default, rename = "lineText", skip_serializing_if = "Option::is_none")]
    line_text: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HeldSymbol {
    name: String,
    kind: String,
    #[serde(default)]
    line: u32,
    #[serde(default, rename = "endLine")]
    end_line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<HeldSpan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    doc: Option<HeldSpan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reach: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HeldNested {
    name: String,
    kind: String,
    #[serde(default)]
    line: u32,
    #[serde(default, rename = "endLine")]
    end_line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<HeldSpan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    doc: Option<HeldSpan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    holder: Option<String>,
    #[serde(default, rename = "holderLine")]
    holder_line: u32,
}

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct HeldMocks {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    minus: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    plus: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HeldMember {
    #[serde(default)]
    request: u32,
    name: String,
    #[serde(default)]
    line: u32,
    #[serde(default, rename = "throughDefault", skip_serializing_if = "std::ops::Not::not")]
    through_default: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HeldMemberDeclaration {
    name: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    line: u32,
    #[serde(default, rename = "endLine")]
    end_line: u32,
    #[serde(default)]
    on: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    doc: Option<HeldSpan>,
    #[serde(default, rename = "lineText", skip_serializing_if = "Option::is_none")]
    line_text: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HeldMemberUse {
    name: String,
    #[serde(default)]
    line: u32,
    #[serde(default)]
    of: String,
    #[serde(default)]
    how: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HeldOwnUse {
    name: String,
    #[serde(default)]
    line: u32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HeldBindingMember {
    #[serde(default)]
    request: u32,
    binding: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    within: Vec<String>,
    name: String,
    #[serde(default)]
    line: u32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HeldParse {
    requests: Vec<HeldRequest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exports: Option<Vec<HeldExport>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    symbols: Vec<HeldSymbol>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    harvested: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    declares: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "HeldMocks::is_empty")]
    mocks: HeldMocks,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    members: Vec<HeldMember>,
    #[serde(default, rename = "memberDeclarations", skip_serializing_if = "Vec::is_empty")]
    member_declarations: Vec<HeldMemberDeclaration>,
    #[serde(default, rename = "memberUses", skip_serializing_if = "Vec::is_empty")]
    member_uses: Vec<HeldMemberUse>,
    #[serde(default, rename = "ownUses", skip_serializing_if = "Vec::is_empty")]
    own_uses: Vec<HeldOwnUse>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    nested: Vec<HeldNested>,
    #[serde(default, rename = "bindingMembers", skip_serializing_if = "Vec::is_empty")]
    binding_members: Vec<HeldBindingMember>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unknown: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    size: Option<crate::source_size::Size>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    doc: Option<HeldSpan>,
}

#[path = "held_read.rs"]
mod read;

fn no_roles(tags: &u8) -> bool {
    *tags == 0
}

impl HeldMocks {
    fn is_empty(&self) -> bool {
        self.minus.is_empty() && self.plus.is_empty()
    }
}

/// Both ends, each `NONE` where JavaScript's `optional` would write it, and the text.
fn raw(value: &Option<HeldSpan>) -> Option<(u32, u32, Option<&str>)> {
    use crate::segment::NONE;
    value.as_ref().map(|span| (span.start.unwrap_or(NONE), span.end.unwrap_or(NONE), span.text.as_deref()))
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
        for declared in &self.member_declarations {
            values.insert(&declared.name);
            values.insert(&declared.kind);
            values.insert(&declared.on);
        }
        for used in &self.member_uses {
            values.insert(&used.name);
            values.insert(&used.of);
            values.insert(&used.how);
        }
        values.extend(self.own_uses.iter().map(|used| used.name.as_str()));
        for nested in &self.nested {
            values.insert(&nested.name);
            values.insert(&nested.kind);
            values.extend(nested.holder.as_deref());
        }
        for read in &self.binding_members {
            values.insert(&read.binding);
            values.extend(read.within.iter().map(String::as_str));
            values.insert(&read.name);
        }
        values.extend(self.declares.iter().flatten().map(String::as_str));
        values.extend(self.unknown.as_deref());
    }

    fn write(&self, strings: &Strings, into: &mut ParseColumns) {
        let id = |value: &str| strings.id(value);
        let span = raw;
        for request in &self.requests {
            into.request(
                id(&request.value),
                id(&request.kind),
                request.line,
                crate::parse_columns::request_flags(request.guessed, request.item),
                request.republishes,
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
                span(&export.signature),
                span(&export.doc),
                export.tags,
                export.line_text.as_deref(),
            );
        }
        for symbol in &self.symbols {
            into.symbol(id(&symbol.name), id(&symbol.kind), (symbol.line, symbol.end_line), span(&symbol.signature), span(&symbol.doc), crate::harvest::reach_code(symbol.reach.as_deref()));
        }
        for name in self.declares.iter().flatten() {
            into.declare(id(name));
        }
        into.mock(self.mocks.minus.iter().map(|value| id(value)), self.mocks.plus.iter().map(|value| id(value)));
        for member in &self.members {
            into.member(member.request, id(&member.name), member.line, member.through_default);
        }
        for declared in &self.member_declarations {
            into.member_declaration(id(&declared.name), id(&declared.kind), (declared.line, declared.end_line), id(&declared.on), span(&declared.doc), declared.line_text.as_deref());
        }
        for used in &self.member_uses {
            into.member_use(id(&used.name), used.line, id(&used.of), id(&used.how));
        }
        for used in &self.own_uses {
            into.own_use(id(&used.name), used.line);
        }
        for nested in &self.nested {
            let holder = strings.optional(nested.holder.as_deref());
            into.nested(id(&nested.name), id(&nested.kind), (nested.line, nested.end_line), span(&nested.signature), span(&nested.doc), holder, nested.holder_line);
        }
        for read in &self.binding_members {
            into.binding_member(read.request, id(&read.binding), read.within.iter().map(|name| id(name)), id(&read.name), read.line);
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

    fn doc(&self) -> Option<(u32, u32, Option<&str>)> {
        raw(&self.doc)
    }

    /// Cut from the text JavaScript kept of each doc; unknown for a doc it spanned without one.
    fn words(&self, item: crate::name_table::Item, at: usize) -> Option<Option<std::borrow::Cow<'_, str>>> {
        use crate::name_table::Item;
        let doc = match item {
            Item::Module => self.doc.as_ref(),
            Item::Symbol => self.symbols.get(at).and_then(|symbol| symbol.doc.as_ref()),
            Item::Nested => self.nested.get(at).and_then(|nested| nested.doc.as_ref()),
            Item::Member => self.member_declarations.get(at).and_then(|member| member.doc.as_ref()),
        };
        crate::parse_columns::words_at(doc.map(|doc| doc.text.as_deref()))
    }
}
