//! Whether one parse row of one layer reads: every id it names is one the
//! dictionary or the text heap holds, every span has both ends or neither and
//! runs forward, and every member names a request of its own row.
//!
//! The index reader (`index_reader.rs`) checks a row only when no newer layer
//! decided its key, so a row nothing reads costs nothing, and a row it hands to
//! JavaScript is one [`super::ParseView`] reads without a panic. A list a row
//! marks absent is checked all the same: it lies in the segment, and a damaged
//! one says the segment is damaged.

// compass: variance-authority.reach.source-index

use crate::segment::NONE;
use crate::stored::{Stored, U32s};

use super::parses::{Ends, Parses};

/// The parse at `row` of `columns`, checked before it is read.
pub(crate) fn parse(stored: &Stored, columns: &Parses, row: usize) -> Result<(), String> {
    let held = |column: U32s, at: usize, what: &str| need(stored.holds(column.at(at)), what);
    let maybe = |column: U32s, at: usize, what: &str| {
        let id = column.at(at);
        need(id == NONE || stored.holds(id), what)
    };
    let kept = |column: U32s, at: usize, what: &str| need(stored.keeps(column.at(at)), what);
    let span = |ends: Ends, at: usize, what: &str| reads(stored, ends, at).map(|_| ()).ok_or_else(|| format!("a parse whose {what} is not a span"));
    let requests = columns.requests.range(row);
    for request in requests.clone() {
        held(columns.request_value, request, "request value")?;
        held(columns.request_kind, request, "request kind")?;
        for binding in columns.request_bindings.range(request) {
            held(columns.binding_imported, binding, "imported binding")?;
            held(columns.binding_local, binding, "local binding")?;
        }
    }
    for export in columns.exports.range(row) {
        for column in [columns.export_exported, columns.export_local, columns.export_from, columns.export_imported] {
            maybe(column, export, "export name")?;
        }
        span(columns.export_signature, export, "export signature")?;
        span(columns.export_doc, export, "export doc")?;
        kept(columns.export_line_text, export, "export line")?;
    }
    for symbol in columns.symbols.range(row) {
        held(columns.symbol_name, symbol, "symbol name")?;
        held(columns.symbol_kind, symbol, "symbol kind")?;
        span(columns.symbol_signature, symbol, "symbol signature")?;
        span(columns.symbol_doc, symbol, "symbol doc")?;
        let reach = columns.symbol_reach[symbol];
        need(reach == 0 || crate::harvest::reach_of(reach).is_some(), "symbol reach")?;
    }
    for at in columns.declares.range(row) {
        held(columns.declare_name, at, "declared name")?;
    }
    maybe(columns.unknown, row, "unknown")?;
    for at in columns.mocks_minus.range(row) {
        held(columns.mock_minus, at, "mock")?;
    }
    for at in columns.mocks_plus.range(row) {
        held(columns.mock_plus, at, "mock")?;
    }
    for at in columns.members.range(row) {
        need((columns.member_request.at(at) as usize) < requests.len(), "member request")?;
        held(columns.member_name, at, "member name")?;
    }
    for at in columns.member_declarations.range(row) {
        held(columns.member_declaration_name, at, "member declaration name")?;
        held(columns.member_declaration_on, at, "member declaration holder")?;
        span(columns.member_declaration_doc, at, "member declaration doc")?;
        kept(columns.member_declaration_line_text, at, "member declaration line")?;
    }
    for at in columns.member_uses.range(row) {
        held(columns.member_use_name, at, "member use name")?;
        held(columns.member_use_of, at, "member use object")?;
        held(columns.member_use_how, at, "member use kind")?;
    }
    for at in columns.own_uses.range(row) {
        held(columns.own_use_name, at, "own use name")?;
    }
    for at in columns.nested.range(row) {
        held(columns.nested_name, at, "nested name")?;
        held(columns.nested_kind, at, "nested kind")?;
        span(columns.nested_signature, at, "nested signature")?;
        need(reads(stored, columns.nested_signature, at) == Some(Some(())), "nested signature")?;
        span(columns.nested_doc, at, "nested doc")?;
        maybe(columns.nested_holder, at, "nested holder")?;
    }
    for at in columns.binding_members.range(row) {
        need((columns.binding_member_request.at(at) as usize) < requests.len(), "binding member request")?;
        held(columns.binding_member_binding, at, "binding member binding")?;
        held(columns.binding_member_name, at, "binding member name")?;
        for within in columns.binding_member_within.range(at) {
            held(columns.binding_within_name, within, "binding member path")?;
        }
    }
    span(columns.doc, row, "module doc")
}

/// A span that reads: `Some(None)` when both ends are absent, `Some(Some(()))`
/// when both are present, run forward and name a text the heap keeps, and
/// `None` otherwise — as `index_reader.rs` reads a span.
fn reads(stored: &Stored, [starts, ends, texts]: Ends, at: usize) -> Option<Option<()>> {
    let (start, end) = (starts.at(at), ends.at(at));
    match (start == NONE, end == NONE) {
        (true, true) => Some(None),
        (false, false) if end >= start && stored.keeps(texts.at(at)) => Some(Some(())),
        _ => None,
    }
}

fn need(holds: bool, what: &str) -> Result<(), String> {
    if holds { Ok(()) } else { Err(format!("a parse whose {what} is not one the segment holds")) }
}
