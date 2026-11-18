//! The parse half of a source-index segment, as columns: the part of
//! `encodeSourceIndex` from `parses.key` to `declares.name`, with the harvest,
//! mock, member, member-declaration, member-use, own-use, nested and
//! binding-member columns `source-index-harvest.ts`, `-mocks.ts`,
//! `-members.ts`, `-member-declarations.ts`, `-member-uses.ts`,
//! `-own-uses.ts`, `-nested.ts` and `-binding-members.ts` add.
//!
//! Two kinds of row are written into it. The graph walk's own reads
//! (`index.rs`), whose absences are empty lists, and the parses JavaScript
//! held for the files the walk did not reach (`held.rs`), whose absences are
//! absent fields. Each row type says what it holds through `ParseRow`, and the
//! columns are laid out once, here, so the two cannot drift into two layouts
//! of one format.

// compass: variance-authority.reach.source-index

use std::borrow::Cow;

use rayon::prelude::*;

use crate::name_table::{Item, NameColumn};
use crate::segment::{u32s, u8s, Collected, Column, Strings, NONE};
use crate::source_size::Size;

/// One parse row, as the encoder asks for it.
pub trait ParseRow: Sync {
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
    /// The module's own doc comment, inside its marks, and its text when the
    /// row holds it; absent when it writes none.
    fn doc(&self) -> Option<(u32, u32, Option<&str>)>;
    /// The words of the doc of the `at`-th row of `item` this row writes:
    /// `Some(None)` for a row with no doc or none left once cut, and `None`,
    /// unknown, for a doc the row spans without its text.
    fn words(&self, item: Item, at: usize) -> Option<Option<Cow<'_, str>>>;
}

/// A text span's two ends and the text it holds, when the row kept it; absent
/// when there is no span.
pub type Span<'t> = Option<(u32, u32, Option<&'t str>)>;

/// The text heap: the signatures, docs and lines the parse cut, each where
/// its row put it. Not the dictionary: these are long, mostly unique and
/// never looked up by value, and sorting them into it was most of what they
/// cost to write.
#[derive(Default)]
struct Heap {
    blob: Vec<u8>,
    ends: Vec<u32>,
}

impl Heap {
    /// The id of `text` once appended, or `NONE` when there is none.
    fn push(&mut self, text: Option<&str>) -> u32 {
        let Some(text) = text else { return NONE };
        self.blob.extend_from_slice(text.as_bytes());
        self.ends.push(self.blob.len() as u32);
        self.ends.len() as u32 - 1
    }

    /// `texts.blob` and `texts.off`: the `id`-th text runs from offset `id`
    /// to offset `id + 1`, and the first offset is 0.
    /// `other` after these, each id it gave moved past the ones these hold.
    fn append(&mut self, other: Heap) -> u32 {
        let (ids, bytes) = (self.ends.len() as u32, self.blob.len() as u32);
        self.blob.extend(other.blob);
        self.ends.extend(other.ends.into_iter().map(|end| end + bytes));
        ids
    }

    fn columns(self) -> [Column; 2] {
        let mut off = Vec::with_capacity(self.ends.len() + 1);
        off.push(0);
        off.extend(self.ends);
        [u8s("texts.blob", self.blob), u32s("texts.off", off)]
    }
}

/// What [`ParseRow::words`] answers of a doc: absent when there is no span,
/// unknown when the span has no text, else the words of its cut.
pub fn words_at(doc: Option<Option<&str>>) -> Option<Option<Cow<'static, str>>> {
    match doc {
        None => Some(None),
        Some(None) => None,
        Some(Some(text)) => Some(crate::dependency_namespace::cut(text).map(|cut| Cow::Owned(crate::name_table::words_of(&cut)))),
    }
}

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
    doc: [Vec<u32>; 3],
    request_value: Vec<u32>,
    request_kind: Vec<u32>,
    request_line: Vec<u32>,
    request_flags: Vec<u8>,
    request_bindings: Vec<u32>,
    request_republishes: Vec<u8>,
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
    export_signature: [Vec<u32>; 3],
    export_doc: [Vec<u32>; 3],
    export_tags: Vec<u8>,
    export_line_text: Vec<u32>,
    symbols: Vec<u32>,
    symbol_name: Vec<u32>,
    symbol_kind: Vec<u32>,
    symbol_line: Vec<u32>,
    symbol_signature: [Vec<u32>; 3],
    symbol_doc: [Vec<u32>; 3],
    symbol_reach: Vec<u8>,
    mocks_minus: Vec<u32>,
    mocks_plus: Vec<u32>,
    mock_minus: Vec<u32>,
    mock_plus: Vec<u32>,
    members: Vec<u32>,
    member_request: Vec<u32>,
    member_name: Vec<u32>,
    member_line: Vec<u32>,
    member_through_default: Vec<u8>,
    member_declarations: Vec<u32>,
    member_declaration_name: Vec<u32>,
    member_declaration_line: Vec<u32>,
    member_declaration_on: Vec<u32>,
    member_declaration_doc: [Vec<u32>; 3],
    member_declaration_line_text: Vec<u32>,
    member_uses: Vec<u32>,
    member_use_name: Vec<u32>,
    member_use_line: Vec<u32>,
    member_use_of: Vec<u32>,
    member_use_how: Vec<u32>,
    own_uses: Vec<u32>,
    own_use_name: Vec<u32>,
    own_use_line: Vec<u32>,
    nested: Vec<u32>,
    nested_name: Vec<u32>,
    nested_kind: Vec<u32>,
    nested_line: Vec<u32>,
    nested_signature: [Vec<u32>; 3],
    nested_doc: [Vec<u32>; 3],
    nested_holder: Vec<u32>,
    nested_holder_line: Vec<u32>,
    binding_members: Vec<u32>,
    binding_member_request: Vec<u32>,
    binding_member_binding: Vec<u32>,
    binding_member_name: Vec<u32>,
    binding_member_line: Vec<u32>,
    binding_member_within: Vec<u32>,
    binding_within_name: Vec<u32>,
    declare_name: Vec<u32>,
    /// The name table, one column per [`Item`].
    names: [NameColumn; 4],
    texts: Heap,
}

fn span(into: &mut [Vec<u32>; 3], texts: &mut Heap, value: Span) {
    into[0].push(value.map_or(NONE, |(start, _, _)| start));
    into[1].push(value.map_or(NONE, |(_, end, _)| end));
    into[2].push(texts.push(value.and_then(|(_, _, text)| text)));
}

impl ParseColumns {
    /// Every row, keyed and sorted by the caller, written in that order. Runs
    /// of rows are written side by side and joined: the bytes are the ones one
    /// pass in order writes.
    pub fn of<P: ParseRow>(rows: &[(&str, &P)], strings: &Strings) -> Self {
        Self::in_runs(rows, strings, rows.len().div_ceil(rayon::current_num_threads() * 4).max(1024))
    }

    pub(crate) fn in_runs<P: ParseRow>(rows: &[(&str, &P)], strings: &Strings, run: usize) -> Self {
        let mut runs = rows.par_chunks(run).map(|rows| Self::run(rows, strings)).collect::<Vec<_>>().into_iter();
        let mut columns = runs.next().unwrap_or_else(|| Self::run::<P>(&[], strings));
        for next in runs {
            columns.append(next);
        }
        columns
    }

    fn run<P: ParseRow>(rows: &[(&str, &P)], strings: &Strings) -> Self {
        let mut columns = Self { request_bindings: vec![0], binding_member_within: vec![0], ..Self::default() };
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
            span(&mut columns.doc, &mut columns.texts, row.doc());
            columns.names[Item::Module as usize].push("", row.doc().is_some(), row.words(Item::Module, 0).as_ref().map(|words| words.as_deref()));
            let before = [columns.symbol_name.len(), columns.nested_name.len(), columns.member_declaration_name.len()];
            row.write(strings, &mut columns);
            columns.name(strings, *row, before);
        }
        columns.close();
        columns
    }

    /// `next`'s rows after these. Every list of offsets runs from 0 to its
    /// list's length, so `next`'s first is this one's last, and every text
    /// id `next` gave moves past the texts these rows hold.
    fn append(&mut self, next: Self) {
        fn values<T>(into: &mut Vec<T>, from: Vec<T>) {
            into.extend(from);
        }
        fn offsets(into: &mut Vec<u32>, from: Vec<u32>) {
            let base = into.pop().unwrap_or(0);
            into.extend(from.into_iter().map(|offset| offset + base));
        }
        fn texts(into: &mut Vec<u32>, from: Vec<u32>, base: u32) {
            into.extend(from.into_iter().map(|id| if id == NONE { NONE } else { id + base }));
        }
        fn spans(into: &mut [Vec<u32>; 3], from: [Vec<u32>; 3], base: u32) {
            let [start, end, text] = from;
            values(&mut into[0], start);
            values(&mut into[1], end);
            texts(&mut into[2], text, base);
        }
        let Self {
            digest, way, requests, exports, exports_present, declares, declares_present, unknown, harvested, bytes, lines, blocks, doc,
            request_value, request_kind, request_line, request_flags, request_bindings, request_republishes,
            binding_imported, binding_local, binding_type, binding_line,
            export_exported, export_local, export_from, export_imported, export_type, export_line, export_signature, export_doc, export_tags, export_line_text,
            symbols, symbol_name, symbol_kind, symbol_line, symbol_signature, symbol_doc, symbol_reach,
            mocks_minus, mocks_plus, mock_minus, mock_plus,
            members, member_request, member_name, member_line, member_through_default,
            member_declarations, member_declaration_name, member_declaration_line, member_declaration_on, member_declaration_doc, member_declaration_line_text,
            member_uses, member_use_name, member_use_line, member_use_of, member_use_how,
            own_uses, own_use_name, own_use_line,
            nested, nested_name, nested_kind, nested_line, nested_signature, nested_doc, nested_holder, nested_holder_line,
            binding_members, binding_member_request, binding_member_binding, binding_member_name, binding_member_line, binding_member_within, binding_within_name,
            declare_name, names, texts: heap,
        } = next;
        let base = self.texts.append(heap);
        for (into, from) in [
            (&mut self.requests, requests), (&mut self.exports, exports), (&mut self.declares, declares), (&mut self.symbols, symbols),
            (&mut self.mocks_minus, mocks_minus), (&mut self.mocks_plus, mocks_plus), (&mut self.members, members),
            (&mut self.member_declarations, member_declarations), (&mut self.member_uses, member_uses), (&mut self.own_uses, own_uses),
            (&mut self.nested, nested), (&mut self.binding_members, binding_members),
            (&mut self.request_bindings, request_bindings), (&mut self.binding_member_within, binding_member_within),
        ] {
            offsets(into, from);
        }
        for (into, from) in [
            (&mut self.digest, digest), (&mut self.way, way), (&mut self.unknown, unknown), (&mut self.bytes, bytes), (&mut self.lines, lines), (&mut self.blocks, blocks),
            (&mut self.request_value, request_value), (&mut self.request_kind, request_kind), (&mut self.request_line, request_line),
            (&mut self.binding_imported, binding_imported), (&mut self.binding_local, binding_local), (&mut self.binding_line, binding_line),
            (&mut self.export_exported, export_exported), (&mut self.export_local, export_local), (&mut self.export_from, export_from),
            (&mut self.export_imported, export_imported), (&mut self.export_line, export_line),
            (&mut self.symbol_name, symbol_name), (&mut self.symbol_kind, symbol_kind), (&mut self.symbol_line, symbol_line),
            (&mut self.mock_minus, mock_minus), (&mut self.mock_plus, mock_plus),
            (&mut self.member_request, member_request), (&mut self.member_name, member_name), (&mut self.member_line, member_line),
            (&mut self.member_declaration_name, member_declaration_name), (&mut self.member_declaration_line, member_declaration_line),
            (&mut self.member_declaration_on, member_declaration_on),
            (&mut self.member_use_name, member_use_name), (&mut self.member_use_line, member_use_line), (&mut self.member_use_of, member_use_of),
            (&mut self.member_use_how, member_use_how), (&mut self.own_use_name, own_use_name), (&mut self.own_use_line, own_use_line),
            (&mut self.nested_name, nested_name), (&mut self.nested_kind, nested_kind), (&mut self.nested_line, nested_line),
            (&mut self.nested_holder, nested_holder), (&mut self.nested_holder_line, nested_holder_line),
            (&mut self.binding_member_request, binding_member_request), (&mut self.binding_member_binding, binding_member_binding),
            (&mut self.binding_member_name, binding_member_name), (&mut self.binding_member_line, binding_member_line),
            (&mut self.binding_within_name, binding_within_name), (&mut self.declare_name, declare_name),
        ] {
            values(into, from);
        }
        for (into, from) in [
            (&mut self.exports_present, exports_present), (&mut self.declares_present, declares_present), (&mut self.harvested, harvested),
            (&mut self.request_flags, request_flags), (&mut self.request_republishes, request_republishes), (&mut self.binding_type, binding_type),
            (&mut self.export_type, export_type), (&mut self.export_tags, export_tags), (&mut self.symbol_reach, symbol_reach),
            (&mut self.member_through_default, member_through_default),
        ] {
            values(into, from);
        }
        texts(&mut self.export_line_text, export_line_text, base);
        texts(&mut self.member_declaration_line_text, member_declaration_line_text, base);
        for (into, from) in [
            (&mut self.doc, doc), (&mut self.export_signature, export_signature), (&mut self.export_doc, export_doc),
            (&mut self.symbol_signature, symbol_signature), (&mut self.symbol_doc, symbol_doc), (&mut self.member_declaration_doc, member_declaration_doc),
            (&mut self.nested_signature, nested_signature), (&mut self.nested_doc, nested_doc),
        ] {
            spans(into, from, base);
        }
        for (into, from) in self.names.iter_mut().zip(names) {
            into.append(from);
        }
    }

    /// The name-table entries of the children `row` just wrote, from where each table stood before it.
    fn name<P: ParseRow>(&mut self, strings: &Strings, row: &P, before: [usize; 3]) {
        let tables = [
            (Item::Symbol, &self.symbol_name, &self.symbol_doc[0]),
            (Item::Nested, &self.nested_name, &self.nested_doc[0]),
            (Item::Member, &self.member_declaration_name, &self.member_declaration_doc[0]),
        ];
        for ((item, names, docs), start) in tables.into_iter().zip(before) {
            for at in start..names.len() {
                self.names[item as usize].push(strings.text(names[at]), docs[at] != NONE, row.words(item, at - start).as_ref().map(|words| words.as_deref()));
            }
        }
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
        self.member_declarations.push(self.member_declaration_name.len() as u32);
        self.member_uses.push(self.member_use_name.len() as u32);
        self.own_uses.push(self.own_use_name.len() as u32);
        self.nested.push(self.nested_name.len() as u32);
        self.binding_members.push(self.binding_member_name.len() as u32);
    }

    /// One request; `flags` is [`request_flags`] of what its reader said about
    /// it, and `republishes` marks an `export … from`.
    pub fn request(&mut self, value: u32, kind: u32, line: u32, flags: u8, republishes: bool, bindings: impl IntoIterator<Item = (u32, u32, bool, u32)>) {
        self.request_value.push(value);
        self.request_kind.push(kind);
        self.request_line.push(line);
        self.request_flags.push(flags);
        self.request_republishes.push(u8::from(republishes));
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
    /// `line_text` is the text of the line it is written on, when the row kept it.
    pub fn export(&mut self, names: [u32; 4], type_only: bool, line: u32, signature: Span, doc: Span, tags: u8, line_text: Option<&str>) {
        let [exported, local, from, imported] = names;
        self.export_exported.push(exported);
        self.export_local.push(local);
        self.export_from.push(from);
        self.export_imported.push(imported);
        self.export_type.push(u8::from(type_only));
        self.export_line.push(line);
        span(&mut self.export_signature, &mut self.texts, signature);
        span(&mut self.export_doc, &mut self.texts, doc);
        self.export_tags.push(tags);
        self.export_line_text.push(self.texts.push(line_text));
    }

    /// `reach` as [`crate::harvest::reach_code`] stores it.
    pub fn symbol(&mut self, name: u32, kind: u32, line: u32, signature: Span, doc: Span, reach: u8) {
        self.symbol_name.push(name);
        self.symbol_kind.push(kind);
        self.symbol_line.push(line);
        span(&mut self.symbol_signature, &mut self.texts, signature);
        span(&mut self.symbol_doc, &mut self.texts, doc);
        self.symbol_reach.push(reach);
    }

    pub fn declare(&mut self, name: u32) {
        self.declare_name.push(name);
    }

    pub fn mock(&mut self, minus: impl IntoIterator<Item = u32>, plus: impl IntoIterator<Item = u32>) {
        self.mock_minus.extend(minus);
        self.mock_plus.extend(plus);
    }

    pub fn member(&mut self, request: u32, name: u32, line: u32, through_default: bool) {
        self.member_request.push(request);
        self.member_name.push(name);
        self.member_line.push(line);
        self.member_through_default.push(u8::from(through_default));
    }

    /// `line_text` is as [`Self::export`] takes it.
    pub fn member_declaration(&mut self, name: u32, line: u32, on: u32, doc: Span, line_text: Option<&str>) {
        self.member_declaration_name.push(name);
        self.member_declaration_line.push(line);
        self.member_declaration_on.push(on);
        span(&mut self.member_declaration_doc, &mut self.texts, doc);
        self.member_declaration_line_text.push(self.texts.push(line_text));
    }

    pub fn member_use(&mut self, name: u32, line: u32, of: u32, how: u32) {
        self.member_use_name.push(name);
        self.member_use_line.push(line);
        self.member_use_of.push(of);
        self.member_use_how.push(how);
    }

    pub fn own_use(&mut self, name: u32, line: u32) {
        self.own_use_name.push(name);
        self.own_use_line.push(line);
    }

    /// One function a function's body declares; `holder` is an id, or `NONE`
    /// when nothing names the function that holds it.
    #[allow(clippy::too_many_arguments, reason = "one column each, in the encoder's order")]
    pub fn nested(&mut self, name: u32, kind: u32, line: u32, signature: Span, doc: Span, holder: u32, holder_line: u32) {
        self.nested_name.push(name);
        self.nested_kind.push(kind);
        self.nested_line.push(line);
        span(&mut self.nested_signature, &mut self.texts, signature);
        span(&mut self.nested_doc, &mut self.texts, doc);
        self.nested_holder.push(holder);
        self.nested_holder_line.push(holder_line);
    }

    /// One name read off a value inside a module; `within` are the names read
    /// off `binding` to reach the value, nearest first.
    pub fn binding_member(&mut self, request: u32, binding: u32, within: impl IntoIterator<Item = u32>, name: u32, line: u32) {
        self.binding_member_request.push(request);
        self.binding_member_binding.push(binding);
        self.binding_member_name.push(name);
        self.binding_member_line.push(line);
        self.binding_within_name.extend(within);
        self.binding_member_within.push(self.binding_within_name.len() as u32);
    }

    /// The columns in `encodeSourceIndex`'s order, the deleted keys between
    /// the key columns and the request offsets where that order puts them.
    pub fn columns(self, deleted: [Column; 2]) -> Vec<Column> {
        let [deleted_digest, deleted_way] = deleted;
        let [export_signature_start, export_signature_end, export_signature_text] = self.export_signature;
        let [export_doc_start, export_doc_end, export_doc_text] = self.export_doc;
        let [symbol_signature_start, symbol_signature_end, symbol_signature_text] = self.symbol_signature;
        let [symbol_doc_start, symbol_doc_end, symbol_doc_text] = self.symbol_doc;
        let [doc_start, doc_end, doc_text] = self.doc;
        let [nested_signature_start, nested_signature_end, nested_signature_text] = self.nested_signature;
        let [nested_doc_start, nested_doc_end, nested_doc_text] = self.nested_doc;
        let [member_declaration_doc_start, member_declaration_doc_end, member_declaration_doc_text] = self.member_declaration_doc;
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
            u32s("parses.doc-start", doc_start),
            u32s("parses.doc-end", doc_end),
            u32s("parses.doc-text", doc_text),
            u32s("requests.value", self.request_value),
            u32s("requests.kind", self.request_kind),
            u32s("requests.line", self.request_line),
            u8s("requests.flags", self.request_flags),
            u32s("requests.bindings", self.request_bindings),
            u8s("requests.republishes", self.request_republishes),
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
            u32s("symbols.signature-text", symbol_signature_text),
            u32s("symbols.doc-start", symbol_doc_start),
            u32s("symbols.doc-end", symbol_doc_end),
            u32s("symbols.doc-text", symbol_doc_text),
            u8s("symbols.reach", self.symbol_reach),
            u32s("exports.signature-start", export_signature_start),
            u32s("exports.signature-end", export_signature_end),
            u32s("exports.signature-text", export_signature_text),
            u32s("exports.doc-start", export_doc_start),
            u32s("exports.doc-end", export_doc_end),
            u32s("exports.doc-text", export_doc_text),
            u8s("exports.tags", self.export_tags),
            u32s("exports.line-text", self.export_line_text),
            u32s("parses.mocks-minus", self.mocks_minus),
            u32s("parses.mocks-plus", self.mocks_plus),
            u32s("mocks.minus", self.mock_minus),
            u32s("mocks.plus", self.mock_plus),
            u32s("parses.members", self.members),
            u32s("members.request", self.member_request),
            u32s("members.name", self.member_name),
            u32s("members.line", self.member_line),
            u8s("members.through-default", self.member_through_default),
            u32s("parses.member-declarations", self.member_declarations),
            u32s("member-declarations.name", self.member_declaration_name),
            u32s("member-declarations.line", self.member_declaration_line),
            u32s("member-declarations.on", self.member_declaration_on),
            u32s("member-declarations.doc-start", member_declaration_doc_start),
            u32s("member-declarations.doc-end", member_declaration_doc_end),
            u32s("member-declarations.doc-text", member_declaration_doc_text),
            u32s("member-declarations.line-text", self.member_declaration_line_text),
            u32s("parses.member-uses", self.member_uses),
            u32s("member-uses.name", self.member_use_name),
            u32s("member-uses.line", self.member_use_line),
            u32s("member-uses.of", self.member_use_of),
            u32s("member-uses.how", self.member_use_how),
            u32s("parses.own-uses", self.own_uses),
            u32s("own-uses.name", self.own_use_name),
            u32s("own-uses.line", self.own_use_line),
            u32s("parses.nested", self.nested),
            u32s("nested.name", self.nested_name),
            u32s("nested.kind", self.nested_kind),
            u32s("nested.line", self.nested_line),
            u32s("nested.signature-start", nested_signature_start),
            u32s("nested.signature-end", nested_signature_end),
            u32s("nested.signature-text", nested_signature_text),
            u32s("nested.doc-start", nested_doc_start),
            u32s("nested.doc-end", nested_doc_end),
            u32s("nested.doc-text", nested_doc_text),
            u32s("nested.holder", self.nested_holder),
            u32s("nested.holder-line", self.nested_holder_line),
            u32s("parses.binding-members", self.binding_members),
            u32s("binding-members.request", self.binding_member_request),
            u32s("binding-members.binding", self.binding_member_binding),
            u32s("binding-members.name", self.binding_member_name),
            u32s("binding-members.line", self.binding_member_line),
            u32s("binding-members.within", self.binding_member_within),
            u32s("binding-within.name", self.binding_within_name),
            u32s("declares.name", self.declare_name),
        ]
        .into_iter()
        .chain(NameColumn::columns(self.names))
        .chain(self.texts.columns())
        .collect()
    }
}

/// A guessed request sets the low bit and an item asked for by its whole path
/// the next, as `guessed` and `item` on `Request` in `read.ts` say them.
pub fn request_flags(guessed: bool, item: bool) -> u8 {
    u8::from(guessed) | (u8::from(item) << 1)
}

#[cfg(test)]
#[path = "parse_columns_tests.rs"]
mod tests;
