//! Grammar facts reconstructed directly from a binary parse store row.

// compass: variance-authority.reach.source-index

use crate::harvest::{reach_of, SourceSymbol, TextSpan};
use crate::languages::shape::{Binding, Export, Kind, Read, Request};
use crate::parse_columns::{request_flags, ParseRow};
use super::ParseView;

pub(super) fn read(view: &ParseView<'_, '_>) -> Option<Read> {
    let (stored, columns, row) = (view.stored, view.columns, view.row);
    let mut requests = Vec::new();
    for at in columns.requests.range(row) {
        let flags = columns.request_flags[at];
        if flags & !request_flags(true, true) != 0 { return None }
        let kind = match stored.text(columns.request_kind.at(at)) {
            "imports" => Kind::Imports,
            "reexports" => Kind::Reexports,
            "dynamic" => Kind::Dynamic,
            "type" => Kind::Type,
            _ => return None,
        };
        requests.push(Request {
            value: stored.text(columns.request_value.at(at)).to_owned(), kind,
            bindings: columns.request_bindings.range(at).map(|binding| Binding {
                imported: stored.text(columns.binding_imported.at(binding)).to_owned(),
                local: stored.text(columns.binding_local.at(binding)).to_owned(),
                type_only: columns.binding_type[binding] == 1,
                line: columns.binding_line.at(binding),
            }).collect(),
            line: columns.request_line.at(at),
            guessed: flags & request_flags(true, false) != 0,
            item: flags & request_flags(false, true) != 0,
        });
    }
    let exports = view.exports_present().then(|| columns.exports.range(row).map(|at| Export {
        exported: stored.optional(columns.export_exported.at(at)).map(str::to_owned),
        local: stored.optional(columns.export_local.at(at)).map(str::to_owned),
        from: stored.optional(columns.export_from.at(at)).map(str::to_owned),
        imported: stored.optional(columns.export_imported.at(at)).map(str::to_owned),
        type_only: columns.export_type[at] == 1,
        line: columns.export_line.at(at),
        line_text: stored.kept(columns.export_line_text.at(at)).map(std::sync::Arc::from),
    }).collect());
    let mut symbols = Vec::new();
    for at in columns.symbols.range(row) {
        // These are the grammar reader's declaration names. A future kind that
        // this build does not know is reparsed rather than renamed.
        let kind = ["function", "struct", "enum", "union", "trait", "type", "const", "static", "module", "macro", "class", "interface", "record", "annotation", "object", "protocol", "property", "variable", "actor"]
            .into_iter().find(|kind| *kind == stored.text(columns.symbol_kind.at(at)))?;
        let span = |ends| crate::compact::span(stored, ends, at).map(|(start, end, text)| TextSpan { start, end, text: text.map(std::sync::Arc::from) });
        symbols.push(SourceSymbol {
            name: stored.text(columns.symbol_name.at(at)).to_owned(), kind,
            line: columns.symbol_line.at(at),
            signature: span(columns.symbol_signature), doc: span(columns.symbol_doc),
            reach: reach_of(columns.symbol_reach[at]),
        });
    }
    Some(Read {
        requests, exports, unknown: view.unknown().map(str::to_owned), symbols,
        harvested: view.harvested(), size: view.size(),
        own_uses: columns.own_uses.range(row).map(|at| crate::help_own_uses::OwnUse {
            name: stored.text(columns.own_use_name.at(at)).to_owned(), line: columns.own_use_line.at(at),
        }).collect(),
    })
}
