//! The parse columns of one layer, and one row of them written again into the
//! compacted generation (`compact.rs`).
//!
//! A row is copied as `decodeSourceIndex` reads it rather than as it lies: the
//! export and declare lists only where the row marks them present, and a span
//! only where it has an end. Everything else is the row's own ids, looked up in
//! the new dictionary.

// compass: variance-authority.reach.source-index

use crate::parse_columns::{ParseColumns, ParseRow};
use crate::segment::{Collected, Strings};
use crate::stored::{same_length, Stored, U32s};

use super::{flag, span};

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
    declares: U32s<'a>,
    declares_present: &'a [u8],
    pub unknown: U32s<'a>,
    harvested: &'a [u8],
    bytes: U32s<'a>,
    lines: U32s<'a>,
    blocks: U32s<'a>,
    pub request_value: U32s<'a>,
    pub request_kind: U32s<'a>,
    pub request_line: U32s<'a>,
    pub request_bindings: U32s<'a>,
    pub binding_imported: U32s<'a>,
    binding_local: U32s<'a>,
    pub binding_type: &'a [u8],
    pub binding_line: U32s<'a>,
    pub export_exported: U32s<'a>,
    export_local: U32s<'a>,
    pub export_from: U32s<'a>,
    pub export_imported: U32s<'a>,
    pub export_type: &'a [u8],
    pub export_line: U32s<'a>,
    export_signature: Ends<'a>,
    export_doc: Ends<'a>,
    symbols: U32s<'a>,
    symbol_name: U32s<'a>,
    symbol_kind: U32s<'a>,
    symbol_line: U32s<'a>,
    symbol_signature: Ends<'a>,
    symbol_doc: Ends<'a>,
    mocks_minus: U32s<'a>,
    mocks_plus: U32s<'a>,
    mock_minus: U32s<'a>,
    mock_plus: U32s<'a>,
    pub members: U32s<'a>,
    pub member_request: U32s<'a>,
    pub member_name: U32s<'a>,
    pub member_line: U32s<'a>,
    declare_name: U32s<'a>,
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
            request_kind: u32s("requests.kind")?,
            request_line: u32s("requests.line")?,
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
            export_exported,
            symbols: stored.offsets("parses.symbols", rows, symbol_name.len())?,
            symbol_kind: u32s("symbols.kind")?,
            symbol_line: u32s("symbols.line")?,
            symbol_signature: ends("symbols.signature-start", "symbols.signature-end")?,
            symbol_doc: ends("symbols.doc-start", "symbols.doc-end")?,
            symbol_name,
            mocks_minus: stored.offsets("parses.mocks-minus", rows, mock_minus.len())?,
            mocks_plus: stored.offsets("parses.mocks-plus", rows, mock_plus.len())?,
            mock_minus,
            mock_plus,
            members: stored.offsets("parses.members", rows, member_name.len())?,
            member_request: u32s("members.request")?,
            member_line: u32s("members.line")?,
            member_name,
            declare_name,
        };
        parses.lengths()?;
        Ok(parses)
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
        ])?;
        same_length(self.deleted.len(), &[("parses.deleted-way", self.deleted_way.len())])?;
        same_length(self.request_value.len(), &[
            ("requests.kind", self.request_kind.len()),
            ("requests.line", self.request_line.len()),
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
        ])?;
        same_length(self.member_name.len(), &[
            ("members.request", self.member_request.len()),
            ("members.line", self.member_line.len()),
        ])
    }
}

/// One row of one layer, the newest for its key.
pub(super) struct ParseView<'s, 'a> {
    pub stored: &'s Stored<'a>,
    pub columns: &'s Parses<'a>,
    pub row: usize,
}

impl ParseView<'_, '_> {
    fn exports(&self) -> std::ops::Range<usize> {
        if self.exports_present() { self.columns.exports.range(self.row) } else { 0..0 }
    }

    fn declares(&self) -> std::ops::Range<usize> {
        if self.declares_present() { self.columns.declares.range(self.row) } else { 0..0 }
    }
}

impl ParseRow for ParseView<'_, '_> {
    fn strings<'s>(&'s self, into: &mut Collected<'s>) {
        let (stored, columns, row) = (self.stored, self.columns, self.row);
        let mut text = |column: U32s, at: usize| {
            into.insert(stored.text(column.at(at)));
        };
        for request in columns.requests.range(row) {
            text(columns.request_value, request);
            text(columns.request_kind, request);
            for binding in columns.request_bindings.range(request) {
                text(columns.binding_imported, binding);
                text(columns.binding_local, binding);
            }
        }
        for symbol in columns.symbols.range(row) {
            text(columns.symbol_name, symbol);
            text(columns.symbol_kind, symbol);
        }
        for at in columns.mocks_minus.range(row) {
            text(columns.mock_minus, at);
        }
        for at in columns.mocks_plus.range(row) {
            text(columns.mock_plus, at);
        }
        for at in columns.members.range(row) {
            text(columns.member_name, at);
        }
        for at in self.declares() {
            text(columns.declare_name, at);
        }
        for export in self.exports() {
            for column in [columns.export_exported, columns.export_local, columns.export_from, columns.export_imported] {
                into.extend(stored.optional(column.at(export)));
            }
        }
        into.extend(self.unknown());
    }

    fn write(&self, strings: &Strings, into: &mut ParseColumns) {
        let (stored, columns, row) = (self.stored, self.columns, self.row);
        let id = |column: U32s, at: usize| strings.id(stored.text(column.at(at)));
        for request in columns.requests.range(row) {
            into.request(
                id(columns.request_value, request),
                id(columns.request_kind, request),
                columns.request_line.at(request),
                columns.request_bindings.range(request).map(|binding| {
                    (
                        id(columns.binding_imported, binding),
                        id(columns.binding_local, binding),
                        flag(columns.binding_type, binding),
                        columns.binding_line.at(binding),
                    )
                }),
            );
        }
        for export in self.exports() {
            into.export(
                [columns.export_exported, columns.export_local, columns.export_from, columns.export_imported]
                    .map(|column| strings.optional(stored.optional(column.at(export)))),
                flag(columns.export_type, export),
                columns.export_line.at(export),
                span(columns.export_signature[0], columns.export_signature[1], export),
                span(columns.export_doc[0], columns.export_doc[1], export),
            );
        }
        for symbol in columns.symbols.range(row) {
            into.symbol(
                id(columns.symbol_name, symbol),
                id(columns.symbol_kind, symbol),
                columns.symbol_line.at(symbol),
                span(columns.symbol_signature[0], columns.symbol_signature[1], symbol),
                span(columns.symbol_doc[0], columns.symbol_doc[1], symbol),
            );
        }
        for at in self.declares() {
            into.declare(id(columns.declare_name, at));
        }
        into.mock(
            columns.mocks_minus.range(row).map(|at| id(columns.mock_minus, at)),
            columns.mocks_plus.range(row).map(|at| id(columns.mock_plus, at)),
        );
        for at in columns.members.range(row) {
            into.member(columns.member_request.at(at), id(columns.member_name, at), columns.member_line.at(at));
        }
    }

    fn exports_present(&self) -> bool {
        flag(self.columns.exports_present, self.row)
    }

    fn declares_present(&self) -> bool {
        flag(self.columns.declares_present, self.row)
    }

    fn unknown(&self) -> Option<&str> {
        self.stored.optional(self.columns.unknown.at(self.row))
    }

    fn harvested(&self) -> bool {
        flag(self.columns.harvested, self.row)
    }

    fn size(&self) -> Option<crate::source_size::Size> {
        use crate::segment::NONE;
        let (bytes, lines, blocks) =
            (self.columns.bytes.at(self.row), self.columns.lines.at(self.row), self.columns.blocks.at(self.row));
        (bytes != NONE && lines != NONE)
            .then(|| crate::source_size::Size { bytes, lines, blocks: (blocks != NONE).then_some(blocks) })
    }
}
