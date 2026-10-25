//! The parse columns of one layer, opened and checked so that a row read from
//! them (`compact_parse_view.rs`) is a row in bounds.

// compass: variance-authority.reach.source-index

use crate::stored::{same_length, Stored, U32s};

use super::span;

/// A span column's two ends.
type Ends<'a> = [U32s<'a>; 2];

pub(crate) struct Parses<'a> {
    pub key: U32s<'a>,
    pub way: U32s<'a>,
    pub deleted: U32s<'a>,
    pub deleted_way: U32s<'a>,
    pub requests: U32s<'a>,
    pub exports: U32s<'a>,
    pub exports_present: &'a [u8],
    pub declares: U32s<'a>,
    pub declares_present: &'a [u8],
    pub unknown: U32s<'a>,
    pub harvested: &'a [u8],
    pub bytes: U32s<'a>,
    pub lines: U32s<'a>,
    pub blocks: U32s<'a>,
    pub doc: Ends<'a>,
    pub request_value: U32s<'a>,
    pub request_kind: U32s<'a>,
    pub request_line: U32s<'a>,
    pub request_flags: &'a [u8],
    pub request_bindings: U32s<'a>,
    pub request_republishes: &'a [u8],
    pub binding_imported: U32s<'a>,
    pub binding_local: U32s<'a>,
    pub binding_type: &'a [u8],
    pub binding_line: U32s<'a>,
    pub export_exported: U32s<'a>,
    pub export_local: U32s<'a>,
    pub export_from: U32s<'a>,
    pub export_imported: U32s<'a>,
    pub export_type: &'a [u8],
    pub export_line: U32s<'a>,
    pub export_signature: Ends<'a>,
    pub export_doc: Ends<'a>,
    pub export_tags: &'a [u8],
    pub symbols: U32s<'a>,
    pub symbol_name: U32s<'a>,
    pub symbol_kind: U32s<'a>,
    pub symbol_line: U32s<'a>,
    pub symbol_signature: Ends<'a>,
    pub symbol_doc: Ends<'a>,
    /// A symbol's reach as [`crate::harvest::reach_code`] stores it.
    pub symbol_reach: &'a [u8],
    pub mocks_minus: U32s<'a>,
    pub mocks_plus: U32s<'a>,
    pub mock_minus: U32s<'a>,
    pub mock_plus: U32s<'a>,
    pub members: U32s<'a>,
    pub member_request: U32s<'a>,
    pub member_name: U32s<'a>,
    pub member_line: U32s<'a>,
    /// A member read off the module's `default`, as [`crate::members::Member`] says.
    pub member_through_default: &'a [u8],
    pub member_declarations: U32s<'a>,
    pub member_declaration_name: U32s<'a>,
    pub member_declaration_line: U32s<'a>,
    pub member_declaration_on: U32s<'a>,
    pub member_uses: U32s<'a>,
    pub member_use_name: U32s<'a>,
    pub member_use_line: U32s<'a>,
    pub member_use_of: U32s<'a>,
    pub member_use_how: U32s<'a>,
    pub own_uses: U32s<'a>,
    pub own_use_name: U32s<'a>,
    pub own_use_line: U32s<'a>,
    pub nested: U32s<'a>,
    pub nested_name: U32s<'a>,
    pub nested_kind: U32s<'a>,
    pub nested_line: U32s<'a>,
    pub nested_signature: Ends<'a>,
    pub nested_doc: Ends<'a>,
    /// The holder's name, or `NONE` when nothing names it.
    pub nested_holder: U32s<'a>,
    pub nested_holder_line: U32s<'a>,
    pub binding_members: U32s<'a>,
    pub binding_member_request: U32s<'a>,
    pub binding_member_binding: U32s<'a>,
    pub binding_member_name: U32s<'a>,
    pub binding_member_line: U32s<'a>,
    pub binding_member_within: U32s<'a>,
    pub binding_within_name: U32s<'a>,
    pub declare_name: U32s<'a>,
}

impl<'a> Parses<'a> {
    /// Every column, and every length and offset the decoder checks, so a
    /// row read later is a row in bounds.
    pub fn open(stored: &Stored<'a>) -> Result<Self, String> {
        let u32s = |name: &str| stored.u32s(name);
        let ends = |start: &str, end: &str| -> Result<Ends<'a>, String> { Ok([u32s(start)?, u32s(end)?]) };
        let key = u32s("parses.key")?;
        let rows = key.len();
        let (request_value, binding_imported) = (u32s("requests.value")?, u32s("bindings.imported")?);
        let (export_exported, symbol_name) = (u32s("exports.exported")?, u32s("symbols.name")?);
        let (mock_minus, mock_plus) = (u32s("mocks.minus")?, u32s("mocks.plus")?);
        let (member_name, declare_name) = (u32s("members.name")?, u32s("declares.name")?);
        let member_declaration_name = u32s("member-declarations.name")?;
        let member_use_name = u32s("member-uses.name")?;
        let own_use_name = u32s("own-uses.name")?;
        let nested_name = u32s("nested.name")?;
        let binding_member_name = u32s("binding-members.name")?;
        let binding_within_name = u32s("binding-within.name")?;
        let parses = Parses {
            key,
            way: u32s("parses.key-way")?,
            deleted: stored.maybe_u32s("parses.deleted")?,
            deleted_way: stored.maybe_u32s("parses.deleted-way")?,
            requests: stored.offsets("parses.requests", rows, request_value.len())?,
            exports: stored.offsets("parses.exports", rows, export_exported.len())?,
            exports_present: stored.u8s("parses.exports-present")?,
            declares: stored.offsets("parses.declares", rows, declare_name.len())?,
            declares_present: stored.u8s("parses.declares-present")?,
            unknown: u32s("parses.unknown")?,
            harvested: stored.u8s("parses.harvested")?,
            bytes: u32s("parses.bytes")?,
            lines: u32s("parses.lines")?,
            blocks: u32s("parses.blocks")?,
            doc: ends("parses.doc-start", "parses.doc-end")?,
            request_kind: u32s("requests.kind")?,
            request_line: u32s("requests.line")?,
            request_flags: stored.u8s("requests.flags")?,
            request_republishes: stored.u8s("requests.republishes")?,
            request_bindings: stored.offsets("requests.bindings", request_value.len(), binding_imported.len())?,
            request_value,
            binding_local: u32s("bindings.local")?,
            binding_type: stored.u8s("bindings.type")?,
            binding_line: u32s("bindings.line")?,
            binding_imported,
            export_local: u32s("exports.local")?,
            export_from: u32s("exports.from")?,
            export_imported: u32s("exports.imported")?,
            export_type: stored.u8s("exports.type")?,
            export_line: u32s("exports.line")?,
            export_signature: ends("exports.signature-start", "exports.signature-end")?,
            export_doc: ends("exports.doc-start", "exports.doc-end")?,
            export_tags: stored.u8s("exports.tags")?,
            export_exported,
            symbols: stored.offsets("parses.symbols", rows, symbol_name.len())?,
            symbol_kind: u32s("symbols.kind")?,
            symbol_line: u32s("symbols.line")?,
            symbol_signature: ends("symbols.signature-start", "symbols.signature-end")?,
            symbol_doc: ends("symbols.doc-start", "symbols.doc-end")?,
            symbol_reach: stored.u8s("symbols.reach")?,
            symbol_name,
            mocks_minus: stored.offsets("parses.mocks-minus", rows, mock_minus.len())?,
            mocks_plus: stored.offsets("parses.mocks-plus", rows, mock_plus.len())?,
            mock_minus,
            mock_plus,
            members: stored.offsets("parses.members", rows, member_name.len())?,
            member_request: u32s("members.request")?,
            member_line: u32s("members.line")?,
            member_through_default: stored.u8s("members.through-default")?,
            member_name,
            member_declarations: stored.offsets("parses.member-declarations", rows, member_declaration_name.len())?,
            member_declaration_line: u32s("member-declarations.line")?,
            member_declaration_on: u32s("member-declarations.on")?,
            member_declaration_name,
            member_uses: stored.offsets("parses.member-uses", rows, member_use_name.len())?,
            member_use_line: u32s("member-uses.line")?,
            member_use_of: u32s("member-uses.of")?,
            member_use_how: u32s("member-uses.how")?,
            member_use_name,
            own_uses: stored.offsets("parses.own-uses", rows, own_use_name.len())?,
            own_use_line: u32s("own-uses.line")?,
            own_use_name,
            nested: stored.offsets("parses.nested", rows, nested_name.len())?,
            nested_kind: u32s("nested.kind")?,
            nested_line: u32s("nested.line")?,
            nested_signature: ends("nested.signature-start", "nested.signature-end")?,
            nested_doc: ends("nested.doc-start", "nested.doc-end")?,
            nested_holder: u32s("nested.holder")?,
            nested_holder_line: u32s("nested.holder-line")?,
            nested_name,
            binding_members: stored.offsets("parses.binding-members", rows, binding_member_name.len())?,
            binding_member_request: u32s("binding-members.request")?,
            binding_member_binding: u32s("binding-members.binding")?,
            binding_member_line: u32s("binding-members.line")?,
            binding_member_within: stored.offsets("binding-members.within", binding_member_name.len(), binding_within_name.len())?,
            binding_within_name,
            binding_member_name,
            declare_name,
        };
        parses.lengths()?;
        Ok(parses)
    }

    /// The lines of `row` that hold code, as its parse stored them; absent
    /// when the parse stored no size, which is not a size of nothing.
    pub fn code_lines(&self, row: usize) -> Option<u32> {
        let (bytes, lines) = (self.bytes.at(row), self.lines.at(row));
        (bytes != crate::segment::NONE && lines != crate::segment::NONE).then_some(lines)
    }

    /// The module's own doc comment span, in UTF-16 units of its file;
    /// absent when it writes none.
    pub fn doc_of_module(&self, row: usize) -> Option<crate::harvest::TextSpan> {
        span(self.doc[0], self.doc[1], row).map(|(start, end)| crate::harvest::TextSpan { start, end })
    }

    /// The doc comment span of one export, in UTF-16 units of its file;
    /// absent when the reader found none.
    pub fn doc_of_export(&self, export: usize) -> Option<crate::harvest::TextSpan> {
        span(self.export_doc[0], self.export_doc[1], export).map(|(start, end)| crate::harvest::TextSpan { start, end })
    }

    /// The doc comment span of one declaration, as [`Self::doc_of_export`]
    /// is of an export.
    pub fn doc_of_symbol(&self, symbol: usize) -> Option<crate::harvest::TextSpan> {
        span(self.symbol_doc[0], self.symbol_doc[1], symbol).map(|(start, end)| crate::harvest::TextSpan { start, end })
    }

    fn lengths(&self) -> Result<(), String> {
        let rows = self.key.len();
        same_length(rows, &[
            ("parses.key-way", self.way.len()),
            ("parses.exports-present", self.exports_present.len()),
            ("parses.declares-present", self.declares_present.len()),
            ("parses.unknown", self.unknown.len()),
            ("parses.harvested", self.harvested.len()),
            ("parses.bytes", self.bytes.len()),
            ("parses.lines", self.lines.len()),
            ("parses.blocks", self.blocks.len()),
            ("parses.doc-start", self.doc[0].len()),
            ("parses.doc-end", self.doc[1].len()),
        ])?;
        same_length(self.deleted.len(), &[("parses.deleted-way", self.deleted_way.len())])?;
        same_length(self.request_value.len(), &[
            ("requests.kind", self.request_kind.len()),
            ("requests.line", self.request_line.len()),
            ("requests.flags", self.request_flags.len()),
            ("requests.republishes", self.request_republishes.len()),
        ])?;
        same_length(self.binding_imported.len(), &[
            ("bindings.local", self.binding_local.len()),
            ("bindings.type", self.binding_type.len()),
            ("bindings.line", self.binding_line.len()),
        ])?;
        let [signature_start, signature_end] = self.export_signature;
        let [doc_start, doc_end] = self.export_doc;
        same_length(self.export_exported.len(), &[
            ("exports.local", self.export_local.len()),
            ("exports.from", self.export_from.len()),
            ("exports.imported", self.export_imported.len()),
            ("exports.type", self.export_type.len()),
            ("exports.line", self.export_line.len()),
            ("exports.signature-start", signature_start.len()),
            ("exports.signature-end", signature_end.len()),
            ("exports.doc-start", doc_start.len()),
            ("exports.doc-end", doc_end.len()),
            ("exports.tags", self.export_tags.len()),
        ])?;
        let [signature_start, signature_end] = self.symbol_signature;
        let [doc_start, doc_end] = self.symbol_doc;
        same_length(self.symbol_name.len(), &[
            ("symbols.kind", self.symbol_kind.len()),
            ("symbols.line", self.symbol_line.len()),
            ("symbols.signature-start", signature_start.len()),
            ("symbols.signature-end", signature_end.len()),
            ("symbols.doc-start", doc_start.len()),
            ("symbols.doc-end", doc_end.len()),
            ("symbols.reach", self.symbol_reach.len()),
        ])?;
        same_length(self.member_name.len(), &[
            ("members.request", self.member_request.len()),
            ("members.line", self.member_line.len()),
            ("members.through-default", self.member_through_default.len()),
        ])?;
        same_length(self.member_declaration_name.len(), &[
            ("member-declarations.line", self.member_declaration_line.len()),
            ("member-declarations.on", self.member_declaration_on.len()),
        ])?;
        same_length(self.member_use_name.len(), &[
            ("member-uses.line", self.member_use_line.len()),
            ("member-uses.of", self.member_use_of.len()),
            ("member-uses.how", self.member_use_how.len()),
        ])?;
        same_length(self.own_use_name.len(), &[("own-uses.line", self.own_use_line.len())])?;
        same_length(self.nested_name.len(), &[
            ("nested.kind", self.nested_kind.len()),
            ("nested.line", self.nested_line.len()),
            ("nested.signature-start", self.nested_signature[0].len()),
            ("nested.signature-end", self.nested_signature[1].len()),
            ("nested.doc-start", self.nested_doc[0].len()),
            ("nested.doc-end", self.nested_doc[1].len()),
            ("nested.holder", self.nested_holder.len()),
            ("nested.holder-line", self.nested_holder_line.len()),
        ])?;
        same_length(self.binding_member_name.len(), &[
            ("binding-members.request", self.binding_member_request.len()),
            ("binding-members.binding", self.binding_member_binding.len()),
            ("binding-members.line", self.binding_member_line.len()),
        ])
    }
}
