//! The parse half of a source-index segment, as columns: the part of
//! `encodeSourceIndex` from `parses.key` to `declares.name`, with the harvest,
//! mock and member columns `source-index-harvest.ts`, `-mocks.ts` and
//! `-members.ts` add.
//!
//! Two kinds of row are written into it. The graph walk's own reads
//! (`index.rs`), whose absences are empty lists, and the parses JavaScript
//! held for the files the walk did not reach (`held.rs`), whose absences are
//! absent fields. Each row type says what it holds through `ParseRow`, and the
//! columns are laid out once, here, so the two cannot drift into two layouts
//! of one format.

// compass: variance-authority.reach.source-index

use crate::segment::{u32s, u8s, Collected, Column, Strings, NONE};
use crate::source_size::Size;

/// One parse row, as the encoder asks for it.
pub trait ParseRow {
    /// Every string the row's columns will name, the key's two parts excluded.
    fn strings<'s>(&'s self, into: &mut Collected<'s>);
    /// The row's columns. `row` has already been called for it.
    fn write(&self, strings: &Strings, into: &mut ParseColumns);
    /// Whether the row wrote an export list — present, even when empty.
    fn exports_present(&self) -> bool;
    fn declares_present(&self) -> bool;
    fn unknown(&self) -> Option<&str>;
    fn harvested(&self) -> bool;
    /// How big the module is; absent for a row whose reader did not measure it.
    fn size(&self) -> Option<Size>;
}

/// A text span's two ends, or `NONE` twice when there is no span.
pub type Span = Option<(u32, u32)>;

#[derive(Default)]
pub struct ParseColumns {
    digest: Vec<u32>,
    way: Vec<u32>,
    requests: Vec<u32>,
    exports: Vec<u32>,
    exports_present: Vec<u8>,
    declares: Vec<u32>,
    declares_present: Vec<u8>,
    unknown: Vec<u32>,
    harvested: Vec<u8>,
    bytes: Vec<u32>,
    lines: Vec<u32>,
    blocks: Vec<u32>,
    request_value: Vec<u32>,
    request_kind: Vec<u32>,
    request_line: Vec<u32>,
    request_bindings: Vec<u32>,
    binding_imported: Vec<u32>,
    binding_local: Vec<u32>,
    binding_type: Vec<u8>,
    binding_line: Vec<u32>,
    export_exported: Vec<u32>,
    export_local: Vec<u32>,
    export_from: Vec<u32>,
    export_imported: Vec<u32>,
    export_type: Vec<u8>,
    export_line: Vec<u32>,
    export_signature: [Vec<u32>; 2],
    export_doc: [Vec<u32>; 2],
    export_tags: Vec<u8>,
    symbols: Vec<u32>,
    symbol_name: Vec<u32>,
    symbol_kind: Vec<u32>,
    symbol_line: Vec<u32>,
    symbol_signature: [Vec<u32>; 2],
    symbol_doc: [Vec<u32>; 2],
    mocks_minus: Vec<u32>,
    mocks_plus: Vec<u32>,
    mock_minus: Vec<u32>,
    mock_plus: Vec<u32>,
    members: Vec<u32>,
    member_request: Vec<u32>,
    member_name: Vec<u32>,
    member_line: Vec<u32>,
    declare_name: Vec<u32>,
}

fn span(into: &mut [Vec<u32>; 2], value: Span) {
    into[0].push(value.map_or(NONE, |(start, _)| start));
    into[1].push(value.map_or(NONE, |(_, end)| end));
}

impl ParseColumns {
    /// Every row, keyed and sorted by the caller, written in that order.
    pub fn of<P: ParseRow>(rows: &[(&str, &P)], strings: &Strings) -> Self {
        let mut columns = Self { request_bindings: vec![0], ..Self::default() };
        for (key, row) in rows {
            let (digest, way) = key.split_once('\0').unwrap_or((key, ""));
            columns.row(strings.id(digest), strings.id(way));
            columns.exports_present.push(u8::from(row.exports_present()));
            columns.declares_present.push(u8::from(row.declares_present()));
            columns.unknown.push(strings.optional(row.unknown()));
            columns.harvested.push(u8::from(row.harvested()));
            let size = row.size();
            columns.bytes.push(size.map_or(NONE, |size| size.bytes));
            columns.lines.push(size.map_or(NONE, |size| size.lines));
            columns.blocks.push(size.and_then(|size| size.blocks).unwrap_or(NONE));
            row.write(strings, &mut columns);
        }
        columns.close();
        columns
    }

    /// A row's offsets: each list's length where the row starts.
    fn row(&mut self, digest: u32, way: u32) {
        self.digest.push(digest);
        self.way.push(way);
        self.close();
    }

    fn close(&mut self) {
        self.requests.push(self.request_value.len() as u32);
        self.exports.push(self.export_exported.len() as u32);
        self.declares.push(self.declare_name.len() as u32);
        self.symbols.push(self.symbol_name.len() as u32);
        self.mocks_minus.push(self.mock_minus.len() as u32);
        self.mocks_plus.push(self.mock_plus.len() as u32);
        self.members.push(self.member_name.len() as u32);
    }

    pub fn request(&mut self, value: u32, kind: u32, line: u32, bindings: impl IntoIterator<Item = (u32, u32, bool, u32)>) {
        self.request_value.push(value);
        self.request_kind.push(kind);
        self.request_line.push(line);
        for (imported, local, type_only, line) in bindings {
            self.binding_imported.push(imported);
            self.binding_local.push(local);
            self.binding_type.push(u8::from(type_only));
            self.binding_line.push(line);
        }
        self.request_bindings.push(self.binding_imported.len() as u32);
    }

    /// One export; each name is an id or `NONE`.
    #[allow(clippy::too_many_arguments, reason = "one column each, in the encoder's order")]
    pub fn export(&mut self, names: [u32; 4], type_only: bool, line: u32, signature: Span, doc: Span, tags: u8) {
        let [exported, local, from, imported] = names;
        self.export_exported.push(exported);
        self.export_local.push(local);
        self.export_from.push(from);
        self.export_imported.push(imported);
        self.export_type.push(u8::from(type_only));
        self.export_line.push(line);
        span(&mut self.export_signature, signature);
        span(&mut self.export_doc, doc);
        self.export_tags.push(tags);
    }

    pub fn symbol(&mut self, name: u32, kind: u32, line: u32, signature: Span, doc: Span) {
        self.symbol_name.push(name);
        self.symbol_kind.push(kind);
        self.symbol_line.push(line);
        span(&mut self.symbol_signature, signature);
        span(&mut self.symbol_doc, doc);
    }

    pub fn declare(&mut self, name: u32) {
        self.declare_name.push(name);
    }

    pub fn mock(&mut self, minus: impl IntoIterator<Item = u32>, plus: impl IntoIterator<Item = u32>) {
        self.mock_minus.extend(minus);
        self.mock_plus.extend(plus);
    }

    pub fn member(&mut self, request: u32, name: u32, line: u32) {
        self.member_request.push(request);
        self.member_name.push(name);
        self.member_line.push(line);
    }

    /// The columns in `encodeSourceIndex`'s order, the deleted keys between
    /// the key columns and the request offsets where that order puts them.
    pub fn columns(self, deleted: [Column; 2]) -> Vec<Column> {
        let [deleted_digest, deleted_way] = deleted;
        let [export_signature_start, export_signature_end] = self.export_signature;
        let [export_doc_start, export_doc_end] = self.export_doc;
        let [symbol_signature_start, symbol_signature_end] = self.symbol_signature;
        let [symbol_doc_start, symbol_doc_end] = self.symbol_doc;
        vec![
            u32s("parses.key", self.digest),
            u32s("parses.key-way", self.way),
            deleted_digest,
            deleted_way,
            u32s("parses.requests", self.requests),
            u32s("parses.exports", self.exports),
            u8s("parses.exports-present", self.exports_present),
            u32s("parses.declares", self.declares),
            u8s("parses.declares-present", self.declares_present),
            u32s("parses.unknown", self.unknown),
            u8s("parses.harvested", self.harvested),
            u32s("parses.bytes", self.bytes),
            u32s("parses.lines", self.lines),
            u32s("parses.blocks", self.blocks),
            u32s("requests.value", self.request_value),
            u32s("requests.kind", self.request_kind),
            u32s("requests.line", self.request_line),
            u32s("requests.bindings", self.request_bindings),
            u32s("bindings.imported", self.binding_imported),
            u32s("bindings.local", self.binding_local),
            u8s("bindings.type", self.binding_type),
            u32s("bindings.line", self.binding_line),
            u32s("exports.exported", self.export_exported),
            u32s("exports.local", self.export_local),
            u32s("exports.from", self.export_from),
            u32s("exports.imported", self.export_imported),
            u8s("exports.type", self.export_type),
            u32s("exports.line", self.export_line),
            u32s("parses.symbols", self.symbols),
            u32s("symbols.name", self.symbol_name),
            u32s("symbols.kind", self.symbol_kind),
            u32s("symbols.line", self.symbol_line),
            u32s("symbols.signature-start", symbol_signature_start),
            u32s("symbols.signature-end", symbol_signature_end),
            u32s("symbols.doc-start", symbol_doc_start),
            u32s("symbols.doc-end", symbol_doc_end),
            u32s("exports.signature-start", export_signature_start),
            u32s("exports.signature-end", export_signature_end),
            u32s("exports.doc-start", export_doc_start),
            u32s("exports.doc-end", export_doc_end),
            u8s("exports.tags", self.export_tags),
            u32s("parses.mocks-minus", self.mocks_minus),
            u32s("parses.mocks-plus", self.mocks_plus),
            u32s("mocks.minus", self.mock_minus),
            u32s("mocks.plus", self.mock_plus),
            u32s("parses.members", self.members),
            u32s("members.request", self.member_request),
            u32s("members.name", self.member_name),
            u32s("members.line", self.member_line),
            u32s("declares.name", self.declare_name),
        ]
    }
}
