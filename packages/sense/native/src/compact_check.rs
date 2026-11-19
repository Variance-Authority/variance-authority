//! Whether one layer reads: the one rule every reader of a source-index
//! segment shares, made by [`super::Layer::open`] before any reader sees the
//! layer.
//!
//! A layer reads when it carries a text heap, its key columns ascend with no
//! key twice — every lookup searches them — no key is both put and deleted,
//! each package is named as `package_of` names it, and every row names only what the
//! segment holds: each id one the dictionary or the heap holds, absent only
//! where its column allows it, each span with both ends or neither and running
//! forward, and each member naming a request of its own row. A layer one row of
//! which does not read does not read at all: the chain is cut there, and the
//! index is damaged — rebuilt by `variance index`, refused by CI — as it is for
//! any other damaged segment.
//!
//! Every row is checked at open, column by column rather than row by row: a
//! column is one pass with no early exit, which vectorises, so a reader of a
//! few rows pays little for the rows it never reads, and a reader of any row
//! needs no check of its own.

// compass: variance-authority.reach.source-index

use crate::segment::NONE;
use crate::stored::{Stored, U32s};

use super::parses::{Ends, Parses};
use super::{Directories, Records};

/// Whether the layer whose columns these are reads.
pub(super) fn layer(stored: &Stored, parses: &Parses, records: &Records, directories: &Directories) -> Result<(), String> {
    need(stored.has_texts(), "a text heap")?;
    ascending(stored, parses.key.len(), |row| (parses.key.at(row), parses.way.at(row)), "parse keys")?;
    ascending(stored, parses.deleted.len(), |row| (parses.deleted.at(row), parses.deleted_way.at(row)), "deleted parse keys")?;
    for (column, what) in [
        (&records.file, "record files"),
        (&records.deleted, "deleted record files"),
        (&directories.path, "directory paths"),
        (&directories.deleted, "deleted directory paths"),
    ] {
        // A key of one column pairs with the first id, which every dictionary holds.
        ascending(stored, column.len(), |row| (column.at(row), 0), what)?;
    }
    // No writer deletes a key in the segment that puts it: its deletes are what its puts do not hold.
    apart(parses.key.len(), parses.deleted.len(), |row| (parses.key.at(row), parses.way.at(row)), |row| (parses.deleted.at(row), parses.deleted_way.at(row)), "parse keys both put and deleted")?;
    apart(records.file.len(), records.deleted.len(), |row| (records.file.at(row), 0), |row| (records.deleted.at(row), 0), "record files both put and deleted")?;
    apart(directories.path.len(), directories.deleted.len(), |row| (directories.path.at(row), 0), |row| (directories.deleted.at(row), 0), "directory paths both put and deleted")?;
    held(stored, directories.digest, "directory digests")?;
    parse_rows(stored, parses)?;
    records.check(stored)
}

/// Whether every id `column` holds is one the dictionary holds.
pub(super) fn held(stored: &Stored, column: U32s, what: &str) -> Result<(), String> {
    let strings = stored.string_count();
    need(column.every(|id| (id as usize) < strings), what)
}

/// Whether every id `column` holds is absent or one the dictionary holds.
pub(super) fn maybe(stored: &Stored, column: U32s, what: &str) -> Result<(), String> {
    let strings = stored.string_count();
    need(column.every(|id| id == NONE || (id as usize) < strings), what)
}

/// Whether every id `column` holds is absent or a text the heap holds.
fn kept(stored: &Stored, column: U32s, what: &str) -> Result<(), String> {
    let texts = stored.text_count();
    need(column.every(|id| id == NONE || (id as usize) < texts), what)
}

/// Whether every span in `ends` has both ends or neither, runs forward, and
/// names a text the heap holds or none; with `present`, both ends always.
fn spans(stored: &Stored, [starts, ends, texts]: Ends, present: bool, what: &str) -> Result<(), String> {
    kept(stored, texts, what)?;
    let mut reads = true;
    for at in 0..starts.len() {
        let (start, end) = (starts.at(at), ends.at(at));
        reads &= if start == NONE { end == NONE && !present } else { end != NONE && end >= start };
    }
    need(reads, what)
}

/// Whether every request a member of each row names is one of that row's.
fn own_requests(parses: &Parses, members: U32s, request: U32s, what: &str) -> Result<(), String> {
    let mut reads = true;
    for row in 0..parses.key.len() {
        let requests = parses.requests.range(row).len() as u32;
        for at in members.range(row) {
            reads &= request.at(at) < requests;
        }
    }
    need(reads, what)
}

fn parse_rows(stored: &Stored, columns: &Parses) -> Result<(), String> {
    for (column, what) in [
        (columns.request_value, "request values"),
        (columns.request_kind, "request kinds"),
        (columns.binding_imported, "imported bindings"),
        (columns.binding_local, "local bindings"),
        (columns.symbol_name, "symbol names"),
        (columns.symbol_kind, "symbol kinds"),
        (columns.declare_name, "declared names"),
        (columns.mock_minus, "mocks"),
        (columns.mock_plus, "mocks"),
        (columns.member_name, "member names"),
        (columns.member_declaration_name, "member declaration names"),
        (columns.member_declaration_on, "member declaration holders"),
        (columns.member_use_name, "member use names"),
        (columns.member_use_of, "member use objects"),
        (columns.member_use_how, "member use kinds"),
        (columns.own_use_name, "own use names"),
        (columns.nested_name, "nested names"),
        (columns.nested_kind, "nested kinds"),
        (columns.binding_member_binding, "binding member bindings"),
        (columns.binding_member_name, "binding member names"),
        (columns.binding_within_name, "binding member paths"),
    ] {
        held(stored, column, what)?;
    }
    for (column, what) in [
        (columns.export_exported, "export names"),
        (columns.export_local, "export names"),
        (columns.export_from, "export names"),
        (columns.export_imported, "export names"),
        (columns.unknown, "unknowns"),
        (columns.nested_holder, "nested holders"),
    ] {
        maybe(stored, column, what)?;
    }
    kept(stored, columns.export_line_text, "export lines")?;
    kept(stored, columns.member_declaration_line_text, "member declaration lines")?;
    for (ends, present, what) in [
        (columns.doc, false, "module docs"),
        (columns.export_signature, false, "export signatures"),
        (columns.export_doc, false, "export docs"),
        (columns.symbol_signature, false, "symbol signatures"),
        (columns.symbol_doc, false, "symbol docs"),
        (columns.member_declaration_doc, false, "member declaration docs"),
        (columns.nested_signature, true, "nested signatures"),
        (columns.nested_doc, false, "nested docs"),
    ] {
        spans(stored, ends, present, what)?;
    }
    own_requests(columns, columns.members, columns.member_request, "member requests")?;
    own_requests(columns, columns.binding_members, columns.binding_member_request, "binding member requests")
}

/// Whether `len` keys, read by `key`, name strings the dictionary holds and
/// ascend with no key twice: a binary search over them finds every one.
fn ascending(stored: &Stored, len: usize, key: impl Fn(usize) -> (u32, u32), what: &str) -> Result<(), String> {
    let mut before = None;
    for row in 0..len {
        let (first, second) = key(row);
        need(stored.holds(first) && stored.holds(second) && before < Some((first, second)), what)?;
        before = Some((first, second));
    }
    Ok(())
}

/// Whether two ascending key columns share no key: one walk over both.
fn apart(puts: usize, deletes: usize, put: impl Fn(usize) -> (u32, u32), delete: impl Fn(usize) -> (u32, u32), what: &str) -> Result<(), String> {
    let (mut at, mut gone) = (0, 0);
    while at < puts && gone < deletes {
        match put(at).cmp(&delete(gone)) {
            std::cmp::Ordering::Less => at += 1,
            std::cmp::Ordering::Greater => gone += 1,
            std::cmp::Ordering::Equal => return need(false, what),
        }
    }
    Ok(())
}

pub(super) fn need(reads: bool, what: &str) -> Result<(), String> {
    if reads { Ok(()) } else { Err(format!("{what} that do not read")) }
}
