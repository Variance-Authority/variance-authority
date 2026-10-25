//! One row of one layer's parse columns (`compact_parses.rs`), written again
//! into the compacted generation (`compact.rs`).
//!
//! A row is copied as `decodeSourceIndex` reads it rather than as it lies: the
//! export and declare lists only where the row marks them present, and a span
//! only where it has an end. Everything else is the row's own ids, looked up in
//! the new dictionary.

// compass: variance-authority.reach.source-index

use crate::parse_columns::{ParseColumns, ParseRow};
use crate::segment::{Collected, Strings};
use crate::stored::{Stored, U32s};

use super::parses::Parses;
use super::{flag, span};

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

    fn write(&self, strings: &Strings, into: &mut ParseColumns) {
        let (stored, columns, row) = (self.stored, self.columns, self.row);
        let id = |column: U32s, at: usize| strings.id(stored.text(column.at(at)));
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
                span(columns.export_signature[0], columns.export_signature[1], export),
                span(columns.export_doc[0], columns.export_doc[1], export),
                columns.export_tags[export],
            );
        }
        for symbol in columns.symbols.range(row) {
            into.symbol(
                id(columns.symbol_name, symbol),
                id(columns.symbol_kind, symbol),
                columns.symbol_line.at(symbol),
                span(columns.symbol_signature[0], columns.symbol_signature[1], symbol),
                span(columns.symbol_doc[0], columns.symbol_doc[1], symbol),
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
                span(columns.nested_signature[0], columns.nested_signature[1], at),
                span(columns.nested_doc[0], columns.nested_doc[1], at),
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

    fn doc(&self) -> crate::parse_columns::Span {
        span(self.columns.doc[0], self.columns.doc[1], self.row)
    }
}
