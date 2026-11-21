//! Runs of parse rows written side by side and joined in order: every list
//! of offsets moved past the rows before it, and every text id to the one the
//! joined heap gives its text, so the joined columns are the bytes one pass in
//! order writes.

// compass: variance-authority.reach.source-index

use rayon::prelude::*;

use super::{ParseColumns, ParseRow};
use crate::segment::{Strings, NONE};

impl ParseColumns {
    pub(crate) fn in_runs<P: ParseRow>(rows: &[(&str, &P)], strings: &Strings, run: usize) -> Self {
        let mut runs = rows.par_chunks(run).map(|rows| Self::run(rows, strings)).collect::<Vec<_>>().into_iter();
        let mut columns = runs.next().unwrap_or_else(|| Self::run::<P>(&[], strings));
        for next in runs {
            columns.append(next);
        }
        columns
    }

    /// `next`'s rows after these. Every list of offsets runs from 0 to its
    /// list's length, so `next`'s first is this one's last, and every text
    /// id `next` gave becomes the id the joined heap gives its text.
    fn append(&mut self, next: Self) {
        fn values<T>(into: &mut Vec<T>, from: Vec<T>) {
            into.extend(from);
        }
        fn offsets(into: &mut Vec<u32>, from: Vec<u32>) {
            let base = into.pop().unwrap_or(0);
            into.extend(from.into_iter().map(|offset| offset + base));
        }
        fn texts(into: &mut Vec<u32>, from: Vec<u32>, ids: &[u32]) {
            into.extend(from.into_iter().map(|id| if id == NONE { NONE } else { ids[id as usize] }));
        }
        fn spans(into: &mut [Vec<u32>; 3], from: [Vec<u32>; 3], ids: &[u32]) {
            let [start, end, text] = from;
            values(&mut into[0], start);
            values(&mut into[1], end);
            texts(&mut into[2], text, ids);
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
        let ids = self.texts.append(heap);
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
        texts(&mut self.export_line_text, export_line_text, &ids);
        texts(&mut self.member_declaration_line_text, member_declaration_line_text, &ids);
        for (into, from) in [
            (&mut self.doc, doc), (&mut self.export_signature, export_signature), (&mut self.export_doc, export_doc),
            (&mut self.symbol_signature, symbol_signature), (&mut self.symbol_doc, symbol_doc), (&mut self.member_declaration_doc, member_declaration_doc),
            (&mut self.nested_signature, nested_signature), (&mut self.nested_doc, nested_doc),
        ] {
            spans(into, from, &ids);
        }
        for (into, from) in self.names.iter_mut().zip(names) {
            into.append(from);
        }
    }
}
