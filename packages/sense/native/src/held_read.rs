//! A parse row of a stored layer read back as the [`HeldParse`] JavaScript
//! holds, so the index reader
//! (`index_reader.rs`) hands JavaScript one row as JSON it reads with
//! `JSON.parse`.
//!
//! Absence keeps JavaScript's meaning: an export or declare list the row marks
//! present is present when empty, a span is present when it has ends, and a
//! zero line is a line. The row is one of a layer [`crate::compact::Layer::open`] read, every row of which was checked there.

// compass: variance-authority.reach.source-index

use crate::compact::{flag, span, ParseView};
use crate::harvest::reach_of;
use crate::parse_columns::ParseRow;
use crate::stored::U32s;

use super::*;

fn held(value: Option<(u32, u32, Option<&str>)>) -> Option<HeldSpan> {
    value.map(|(start, end, text)| HeldSpan { start: Some(start), end: Some(end), text: text.map(str::to_owned) })
}

impl HeldParse {
    /// The row `view` names, as JavaScript holds it.
    pub(crate) fn of(view: &ParseView) -> HeldParse {
        let (stored, columns, row) = (view.stored, view.columns, view.row);
        let text = |column: U32s, at: usize| stored.text(column.at(at)).to_owned();
        let optional = |column: U32s, at: usize| stored.optional(column.at(at)).map(str::to_owned);
        let kept = |column: U32s, at: usize| stored.kept(column.at(at)).map(str::to_owned);
        let spanned = |ends, at: usize| held(span(stored, ends, at));
        let requests = columns
            .requests
            .range(row)
            .map(|request| {
                let flags = columns.request_flags[request];
                HeldRequest {
                    value: text(columns.request_value, request),
                    kind: text(columns.request_kind, request),
                    bindings: columns
                        .request_bindings
                        .range(request)
                        .map(|binding| HeldBinding {
                            imported: text(columns.binding_imported, binding),
                            local: text(columns.binding_local, binding),
                            type_only: flag(columns.binding_type, binding),
                            line: columns.binding_line.at(binding),
                        })
                        .collect(),
                    line: columns.request_line.at(request),
                    guessed: flags & 1 != 0,
                    item: flags & 2 != 0,
                    republishes: flag(columns.request_republishes, request),
                }
            })
            .collect();
        let exports = view.exports_present().then(|| {
            columns
                .exports
                .range(row)
                .map(|at| HeldExport {
                    exported: optional(columns.export_exported, at),
                    local: optional(columns.export_local, at),
                    from: optional(columns.export_from, at),
                    imported: optional(columns.export_imported, at),
                    type_only: flag(columns.export_type, at),
                    line: columns.export_line.at(at),
                    signature: spanned(columns.export_signature, at),
                    doc: spanned(columns.export_doc, at),
                    tags: columns.export_tags[at],
                    line_text: kept(columns.export_line_text, at),
                })
                .collect()
        });
        let symbols = columns
            .symbols
            .range(row)
            .map(|at| HeldSymbol {
                name: text(columns.symbol_name, at),
                kind: text(columns.symbol_kind, at),
                line: columns.symbol_line.at(at),
                signature: spanned(columns.symbol_signature, at),
                doc: spanned(columns.symbol_doc, at),
                reach: reach_of(columns.symbol_reach[at]).map(str::to_owned),
            })
            .collect();
        let declares = view.declares_present().then(|| columns.declares.range(row).map(|at| text(columns.declare_name, at)).collect());
        let mocks = HeldMocks {
            minus: columns.mocks_minus.range(row).map(|at| text(columns.mock_minus, at)).collect(),
            plus: columns.mocks_plus.range(row).map(|at| text(columns.mock_plus, at)).collect(),
        };
        let members = columns
            .members
            .range(row)
            .map(|at| HeldMember {
                request: columns.member_request.at(at),
                name: text(columns.member_name, at),
                line: columns.member_line.at(at),
                through_default: columns.member_through_default[at] == 1,
            })
            .collect();
        let member_declarations = columns
            .member_declarations
            .range(row)
            .map(|at| HeldMemberDeclaration {
                name: text(columns.member_declaration_name, at),
                line: columns.member_declaration_line.at(at),
                on: text(columns.member_declaration_on, at),
                doc: spanned(columns.member_declaration_doc, at),
                line_text: kept(columns.member_declaration_line_text, at),
            })
            .collect();
        let member_uses = columns
            .member_uses
            .range(row)
            .map(|at| HeldMemberUse {
                name: text(columns.member_use_name, at),
                line: columns.member_use_line.at(at),
                of: text(columns.member_use_of, at),
                how: text(columns.member_use_how, at),
            })
            .collect();
        let own_uses = columns
            .own_uses
            .range(row)
            .map(|at| HeldOwnUse { name: text(columns.own_use_name, at), line: columns.own_use_line.at(at) })
            .collect();
        let nested = columns
            .nested
            .range(row)
            .map(|at| HeldNested {
                name: text(columns.nested_name, at),
                kind: text(columns.nested_kind, at),
                line: columns.nested_line.at(at),
                signature: spanned(columns.nested_signature, at),
                doc: spanned(columns.nested_doc, at),
                holder: optional(columns.nested_holder, at),
                holder_line: columns.nested_holder_line.at(at),
            })
            .collect();
        let binding_members = columns
            .binding_members
            .range(row)
            .map(|at| HeldBindingMember {
                request: columns.binding_member_request.at(at),
                binding: text(columns.binding_member_binding, at),
                within: columns.binding_member_within.range(at).map(|within| text(columns.binding_within_name, within)).collect(),
                name: text(columns.binding_member_name, at),
                line: columns.binding_member_line.at(at),
            })
            .collect();
        HeldParse {
            requests,
            exports,
            symbols,
            harvested: view.harvested(),
            declares,
            mocks,
            members,
            member_declarations,
            member_uses,
            own_uses,
            nested,
            binding_members,
            unknown: view.unknown().map(str::to_owned),
            size: view.size(),
            doc: held(view.doc()),
        }
    }
}
