//! One row of one layer's parse columns (`compact_parses.rs`), written again
//! into the compacted generation (`compact.rs`).
//!
//! A row is copied as `decodeSourceIndex` reads it rather than as it lies: the
//! export and declare lists only where the row marks them present, and a span
//! only where it has an end. Everything else is the row's own ids, looked up in
//! the new dictionary.

// compass: variance-authority.reach.source-index

use crate::parse_columns::{ParseColumns, ParseRow};
use crate::read::{Binding, Kind, Read, Request};
use crate::segment::{Collected, Strings};
use crate::stored::{Stored, U32s};

use super::parses::Parses;
use super::{flag, span};

#[cfg(feature = "grammars")]
#[path = "compact_language_read.rs"]
mod language_read;

/// One row of one layer, the newest for its key.
pub(crate) struct ParseView<'s, 'a> {
    pub(crate) stored: &'s Stored<'a>,
    pub(crate) columns: &'s Parses<'a>,
    pub(crate) row: usize,
}

impl<'s, 'a> ParseView<'s, 'a> {
    /// The row `row` of `layer`'s parses.
    pub(crate) fn of(layer: &'s super::Layer<'a>, row: usize) -> Self {
        ParseView { stored: &layer.stored, columns: &layer.parses, row }
    }

    /// The native resolver facts a store row already supplies, without a source read.
    pub(crate) fn source_read(&self, file: &str) -> Option<crate::source_read::SourceRead> {
        if crate::source_read::language(file).is_some() {
            #[cfg(feature = "grammars")]
            return language_read::read(self).map(crate::source_read::SourceRead::Language);
            #[cfg(not(feature = "grammars"))]
            return None;
        }
        self.read().map(crate::source_read::SourceRead::Module)
    }

    /// The row as the walk reads a parse: its requests, the names it declares
    /// and why it is unknown — what a record is built and resolved from. `None`
    /// for a row this reader did not write, whose requests are derived (a
    /// nonzero flag), so it is read again rather than answered as one.
    pub(crate) fn read(&self) -> Option<Read> {
        let (stored, columns, row) = (self.stored, self.columns, self.row);
        let mut requests = Vec::new();
        for request in columns.requests.range(row) {
            if columns.request_flags[request] != 0 {
                return None;
            }
            let kind = stored.text(columns.request_kind.at(request));
            requests.push(Request {
                value: stored.text(columns.request_value.at(request)).to_owned(),
                kind: Kind::ALL.into_iter().find(|known| known.as_str() == kind)?,
                bindings: columns
                    .request_bindings
                    .range(request)
                    .map(|binding| Binding {
                        imported: stored.text(columns.binding_imported.at(binding)).to_owned(),
                        local: stored.text(columns.binding_local.at(binding)).to_owned(),
                        type_only: flag(columns.binding_type, binding),
                        line: columns.binding_line.at(binding),
                    })
                    .collect(),
                line: columns.request_line.at(request),
                republishes: flag(columns.request_republishes, request),
            });
        }
        Some(Read {
            requests,
            declares: self.declares().map(|at| stored.text(columns.declare_name.at(at)).to_owned()).collect(),
            unknown: self.unknown().map(str::to_owned),
            size: self.size(),
            ..Read::default()
        })
    }
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
        for at in columns.member_declarations.range(row) {
            text(columns.member_declaration_name, at);
            text(columns.member_declaration_on, at);
        }
        for at in columns.member_uses.range(row) {
            text(columns.member_use_name, at);
            text(columns.member_use_of, at);
            text(columns.member_use_how, at);
        }
        for at in columns.own_uses.range(row) {
            text(columns.own_use_name, at);
        }
        for at in columns.nested.range(row) {
            text(columns.nested_name, at);
            text(columns.nested_kind, at);
        }
        for at in columns.binding_members.range(row) {
            text(columns.binding_member_binding, at);
            text(columns.binding_member_name, at);
            for within in columns.binding_member_within.range(at) {
                text(columns.binding_within_name, within);
            }
        }
        for at in self.declares() {
            text(columns.declare_name, at);
        }
        for export in self.exports() {
            for column in [columns.export_exported, columns.export_local, columns.export_from, columns.export_imported] {
                into.extend(stored.optional(column.at(export)));
            }
        }
        for at in columns.nested.range(row) {
            into.extend(stored.optional(columns.nested_holder.at(at)));
        }
        into.extend(self.unknown());
    }

    fn write<'text>(&'text self, strings: &Strings, into: &mut ParseColumns<'text>) {
        let (stored, columns, row) = (self.stored, self.columns, self.row);
        let id = |column: U32s, at: usize| strings.id(stored.text(column.at(at)));
        let span = |ends, at: usize| span(stored, ends, at);
        let text = |column: U32s, at: usize| stored.kept(column.at(at));
        for request in columns.requests.range(row) {
            into.request(
                id(columns.request_value, request),
                id(columns.request_kind, request),
                columns.request_line.at(request),
                columns.request_flags[request],
                flag(columns.request_republishes, request),
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
                span(columns.export_signature, export),
                span(columns.export_doc, export),
                columns.export_tags[export],
                text(columns.export_line_text, export),
            );
        }
        for symbol in columns.symbols.range(row) {
            into.symbol(
                id(columns.symbol_name, symbol),
                id(columns.symbol_kind, symbol),
                columns.symbol_line.at(symbol),
                span(columns.symbol_signature, symbol),
                span(columns.symbol_doc, symbol),
                columns.symbol_reach[symbol],
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
            into.member(columns.member_request.at(at), id(columns.member_name, at), columns.member_line.at(at), columns.member_through_default[at] == 1);
        }
        for at in columns.member_declarations.range(row) {
            into.member_declaration(
                id(columns.member_declaration_name, at),
                columns.member_declaration_line.at(at),
                id(columns.member_declaration_on, at),
                span(columns.member_declaration_doc, at),
                text(columns.member_declaration_line_text, at),
            );
        }
        for at in columns.member_uses.range(row) {
            into.member_use(
                id(columns.member_use_name, at),
                columns.member_use_line.at(at),
                id(columns.member_use_of, at),
                id(columns.member_use_how, at),
            );
        }
        for at in columns.own_uses.range(row) {
            into.own_use(id(columns.own_use_name, at), columns.own_use_line.at(at));
        }
        for at in columns.nested.range(row) {
            into.nested(
                id(columns.nested_name, at),
                id(columns.nested_kind, at),
                columns.nested_line.at(at),
                span(columns.nested_signature, at),
                span(columns.nested_doc, at),
                strings.optional(stored.optional(columns.nested_holder.at(at))),
                columns.nested_holder_line.at(at),
            );
        }
        for at in columns.binding_members.range(row) {
            let (binding, name) = (id(columns.binding_member_binding, at), id(columns.binding_member_name, at));
            let within = columns.binding_member_within.range(at).map(|within| id(columns.binding_within_name, within));
            into.binding_member(columns.binding_member_request.at(at), binding, within, name, columns.binding_member_line.at(at));
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

    fn doc(&self) -> Option<(u32, u32, Option<&str>)> {
        span(self.stored, self.columns.doc, self.row)
    }

    /// Carried as the layer wrote them, so a compaction keeps what the writer held.
    fn words(&self, item: crate::name_table::Item, at: usize) -> Option<Option<std::borrow::Cow<'_, str>>> {
        use crate::name_table::{Doc, Item};
        let (columns, row) = (self.columns, self.row);
        let entry = match item {
            Item::Module => row,
            Item::Symbol => columns.symbols.range(row).start + at,
            Item::Nested => columns.nested.range(row).start + at,
            Item::Member => columns.member_declarations.range(row).start + at,
        };
        match columns.names[item as usize].doc(entry) {
            Doc::Absent => Some(None),
            Doc::Words(words) => Some(Some(std::borrow::Cow::Borrowed(words))),
            Doc::Unknown => None,
        }
    }
}

#[cfg(all(test, feature = "grammars"))]
mod source_read_tests {
    #[test]
    fn a_language_store_answers_resolution_without_reparsing() {
        for (language, file, source) in [
            ("rust", "src/lib.rs", "pub mod other;\npub struct Named;\nfn call() { crate::other::run(); }\n"),
            ("python", "main.py", "from other import named\n"),
            ("java", "Named.java", "package kit;\nimport other.Named;\npublic class Kit {}\n"),
            ("kotlin", "Named.kt", "package kit\nimport other.Named\nclass Kit\n"),
            ("swift", "Named.swift", "import Other\npublic struct Named {}\nactor Worker {}\n"),
        ] {
            let read = crate::languages::read(language, file, source).unwrap();
            let bytes = crate::index::parses_only(&[("digest", &read)]);
            let layer = crate::compact::Layer::open(&bytes).unwrap();
            let cached = super::ParseView::of(&layer, 0).source_read(file).expect("the native store answers a language row");
            let cached = cached.language().unwrap();
            assert_eq!(serde_json::to_value(&cached.requests).unwrap(), serde_json::to_value(&read.requests).unwrap(), "{language}");
            let names = |read: &crate::languages::shape::Read| read.symbols.iter().map(|symbol| (symbol.name.clone(), symbol.kind, symbol.line, symbol.reach)).collect::<Vec<_>>();
            assert_eq!(names(cached), names(&read), "{language}");
            assert_eq!(cached.harvested, read.harvested);
            assert_eq!(cached.unknown, read.unknown);
            assert_eq!(cached.size, read.size);
        }
    }
}
