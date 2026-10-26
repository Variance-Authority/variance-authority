//! The declaration an export binds.
//!
//! `export const clamp = …` binds `clamp` to the file's own declaration;
//! `function taxOf…; export { taxOf as levy }` binds `levy` to `taxOf` in the
//! same file; `export { taxOf as levy } from './tax.js'` exports `levy` and
//! declares nothing: the declaration is `taxOf` in the file the request
//! resolved to. The importers of a name are walked forward from its declaration
//! (`help_usage.rs`); this walks the other way, from one export back through
//! each `export … from` that passes it on, and each import a file exports
//! again, to the file whose own export list binds the name to a top-level
//! declaration. The parse says which name each export passes on as which and
//! which name each import binds, and the file's record says which file each
//! request resolved to.
//!
//! The walk is ECMAScript's export resolution (`resolve_export.rs`), run over
//! the index's parses.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

use napi_derive::napi;

use crate::compact::Layer;
use crate::help_declared::span;
use crate::package_graph::{fold, join_parses, passed_on, At, Crossing};
use crate::package_owners::NO_OWNER;
use crate::resolve_export::{resolve_export, Bound, Exports, Modules, Passes};

/// The declaration an export binds: the file that declares it, the name it
/// has there, its line and kind, and the spans of its signature and doc
/// comment in the file's UTF-16 offsets, when the parser kept them.
#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExportedDeclaration {
    pub at: String,
    pub name: String,
    pub line: u32,
    /// As the parser harvested it: `function`, `const`, …
    pub kind: String,
    pub signature_start: Option<u32>,
    pub signature_end: Option<u32>,
    pub doc_start: Option<u32>,
    pub doc_end: Option<u32>,
}

/// The declaration the export `name` of `file` binds: the file's own, under
/// its own name or another, or the one it passes on through every file that
/// passes it on or imports it and exports it again, renamed or not and
/// type-only or not. `None` when the walk ends anywhere but at a declaration:
/// at a namespace (`export * as`, `import * as`), at a request that resolved to
/// no file of the checkout, at a file the index holds no export list of, at a
/// file that does not export the name, back at a file it already passed
/// through, or at stars that reach different declarations.
pub(crate) fn declaration_exported(layers: &[Layer], file: &str, name: &str) -> Option<ExportedDeclaration> {
    let index = Index { layers, folded: fold(layers) };
    let (&file, _) = index.folded.get_key_value(file)?;
    resolve_export(&index, &file, name).declaration()
}

/// The source index's layers, folded to each file's newest record.
struct Index<'a> {
    layers: &'a [Layer<'a>],
    folded: HashMap<&'a str, At>,
}

impl<'a> Modules for Index<'a> {
    type File = &'a str;
    type Declaration = ExportedDeclaration;

    /// A file whose parse never recorded its export list answers by its
    /// top-level declarations alone, and passes nothing on.
    fn exports(&self, file: &&'a str, name: &str) -> Exports<&'a str, ExportedDeclaration> {
        let Some(parsed) = Parsed::of(self.layers, &self.folded, file) else { return Exports::Unread };
        match parsed.exports_locally(name) {
            Some(Bound::Declared(symbol)) => Exports::Own(Bound::Declared(parsed.declaration(file, symbol))),
            Some(Bound::Imported(to, imported)) => Exports::Own(Bound::Imported(to, imported)),
            Some(Bound::Unbound) => Exports::Own(Bound::Unbound),
            None => parsed.passes(name).map_or(Exports::Unread, Exports::Passes),
        }
    }
}

/// One file's newest record joined to its parse.
struct Parsed<'a> {
    layer: &'a Layer<'a>,
    row: usize,
    /// The file each request resolved to, in the parse's request order.
    resolved: Vec<Option<&'a str>>,
}

impl<'a> Parsed<'a> {
    /// `None` when the file has no record or no parse, or when its record's
    /// targets do not line up with the parse's requests, which then answer
    /// none of them.
    fn of(layers: &'a [Layer<'a>], folded: &HashMap<&'a str, At>, file: &str) -> Option<Self> {
        let (&file, &at) = folded.get_key_value(file)?;
        let mut crossings = [Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None }];
        join_parses(layers, &mut crossings);
        let (layer, row) = crossings[0].parse?;
        let (stored, records) = (&layers[at.0].stored, &layers[at.0].records);
        if records.targets_present[at.1] != 1 {
            return None;
        }
        let resolved: Vec<Option<&str>> = records.targets.range(at.1).map(|target| stored.optional(records.target_path.at(target))).collect();
        let layer = &layers[layer];
        if resolved.len() != layer.parses.requests.range(row).len() {
            return None;
        }
        Some(Parsed { layer, row, resolved })
    }

    /// The file's top-level declaration of `name`: the one written on `line`
    /// when two share the name, `interface Rate` and `const Rate`, else the
    /// first.
    // FIXME: `export { Rate }` binds both `interface Rate` and `const Rate`,
    // and answers the first alone; spec 0104 answers each declaration apart.
    fn declares(&self, name: &str, line: Option<u32>) -> Option<usize> {
        let (text, parses) = (&self.layer.stored, &self.layer.parses);
        let mut named = parses.symbols.range(self.row).filter(|&symbol| text.text(parses.symbol_name.at(symbol)) == name);
        let first = named.next()?;
        Some(std::iter::once(first).chain(named).find(|&symbol| Some(parses.symbol_line.at(symbol)) == line).unwrap_or(first))
    }

    /// The declaration `symbol` of `file`, as [`ExportedDeclaration`] holds it.
    fn declaration(&self, file: &str, symbol: usize) -> ExportedDeclaration {
        let (text, parses) = (&self.layer.stored, &self.layer.parses);
        let (signature_start, signature_end) = span(parses.symbol_signature[0], parses.symbol_signature[1], symbol);
        let (doc_start, doc_end) = span(parses.symbol_doc[0], parses.symbol_doc[1], symbol);
        ExportedDeclaration {
            at: file.to_owned(),
            name: text.text(parses.symbol_name.at(symbol)).to_owned(),
            line: parses.symbol_line.at(symbol),
            kind: text.text(parses.symbol_kind.at(symbol)).to_owned(),
            signature_start,
            signature_end,
            doc_start,
            doc_end,
        }
    }

    /// How the file's own export list binds `name`, as [`Bound`] says; `None`
    /// when no export of it without a `from` names it. A file whose parse never
    /// recorded its export list answers by its top-level declarations alone.
    fn exports_locally(&self, name: &str) -> Option<Bound<&'a str, usize>> {
        let (text, parses) = (&self.layer.stored, &self.layer.parses);
        if parses.exports_present[self.row] != 1 {
            return self.declares(name, None).map(Bound::Declared);
        }
        let export = parses
            .exports
            .range(self.row)
            .find(|&export| text.optional(parses.export_from.at(export)).is_none() && text.optional(parses.export_exported.at(export)) == Some(name))?;
        let Some(local) = text.optional(parses.export_local.at(export)) else { return Some(Bound::Unbound) };
        Some(match self.declares(local, Some(parses.export_line.at(export))) {
            Some(symbol) => Bound::Declared(symbol),
            None => self.imports(local),
        })
    }

    /// The import that binds `local` in the file: the file its request
    /// resolved to and the name it has there, or unbound for a namespace
    /// import and for a name no import binds.
    fn imports(&self, local: &str) -> Bound<&'a str, usize> {
        let (text, parses) = (&self.layer.stored, &self.layer.parses);
        let first = parses.requests.at(self.row) as usize;
        for request in parses.requests.range(self.row) {
            if !matches!(text.text(parses.request_kind.at(request)), "imports" | "type") {
                continue;
            }
            for binding in parses.request_bindings.range(request) {
                if text.text(parses.binding_local.at(binding)) != local {
                    continue;
                }
                let imported = text.text(parses.binding_imported.at(binding));
                return if imported == "*" { Bound::Unbound } else { Bound::Imported(self.resolved[request - first], imported.to_owned()) };
            }
        }
        Bound::Unbound
    }

    /// What the file passes `name` on from, as [`Passes`] holds it; `None`
    /// when its parse never recorded its export list.
    fn passes(&self, name: &str) -> Option<Passes<&'a str>> {
        let (text, parses) = (&self.layer.stored, &self.layer.parses);
        if parses.exports_present[self.row] != 1 {
            return None;
        }
        let mut passes = Passes { named: None, stars: Vec::new() };
        let first = parses.requests.at(self.row) as usize;
        for request in parses.requests.range(self.row) {
            // A re-export that carries only types is recorded as a `type` request;
            // its exports say which of those requests pass a name on.
            if !matches!(text.text(parses.request_kind.at(request)), "reexports" | "type") {
                continue;
            }
            let to = self.resolved[request - first];
            // A walk to a declaration follows `export type { … } from` as it follows any other.
            for one in passed_on(self.layer, self.row, request).unwrap_or_default() {
                match (one.imported, one.exported) {
                    ("*", None) => passes.stars.push(to),
                    // A module exports a name once; a second is a syntax error, and the
                    // first is kept. `export * as ns` binds a namespace, no declaration.
                    (imported, Some(exported)) if exported == name && passes.named.is_none() => {
                        passes.named = Some(if imported == "*" { None } else { to.map(|to| (to, imported.to_owned())) });
                    }
                    _ => {}
                }
            }
        }
        Some(passes)
    }
}
