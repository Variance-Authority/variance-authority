//! Where a name a file only passes on is declared.
//!
//! `export { taxOf as levy } from './tax.js'` exports `levy` and declares
//! nothing: the declaration is `taxOf` in the file the request resolved to.
//! The importers of a name are walked forward from its declaration
//! (`help_usage.rs`); this walks the other way, from one export back through
//! each `export … from` that passes it on, to the file whose own export list
//! binds the name to a top-level declaration. The parse says which name each
//! export passes on as which, and the file's record says which file each
//! request resolved to.
//!
//! The walk is ECMAScript's export resolution: a file's own export of the
//! name decides first, then a named `export … from`, and only then its stars.
//! What the index cannot read — a request to no file of the checkout, a file
//! with no parse or no export list, a namespace — leaves the name undecided
//! rather than letting another star answer for it.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use napi_derive::napi;

use crate::compact::Layer;
use crate::package_graph::{fold, join_parses, passed_on_with_types, At, Crossing};
use crate::package_owners::NO_OWNER;

/// The declaration an export passes on: the file that declares it, the name
/// it has there, and the line of that declaration.
#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PassedOnDeclaration {
    pub at: String,
    pub name: String,
    pub line: u32,
}

/// The declaration the export `name` of `file` passes on, through every file
/// that passes it on, renamed or not and type-only or not. `None` when `file`'s
/// own export list binds the name, and when the walk ends anywhere but at a
/// declaration: at a namespace (`export * as`), at an import a file exports
/// again, at a request that resolved to no file of the checkout, at a file the
/// index holds no export list of, at a file that does not export the name,
/// back at a file it already passed through, or at stars that reach different
/// declarations.
pub(crate) fn declaration_passed_on(layers: &[Layer], file: &str, name: &str) -> Option<PassedOnDeclaration> {
    let folded = fold(layers);
    let start = Parsed::of(layers, &folded, file)?;
    if start.exports_locally(name).is_some() {
        return None;
    }
    let mut passed = HashSet::from([(file.to_owned(), name.to_owned())]);
    match walk(layers, &folded, &start, name, &mut passed) {
        Reached::Declaration(found) => Some(found),
        Reached::Undecided | Reached::Nothing => None,
    }
}

/// Where a walk ends. Undecided is kept apart from nothing because it carries
/// upward: a star that cannot say what it exports under the name makes the
/// file passing it on undecided too, where a star that does not export the
/// name is passed over.
#[derive(Debug, PartialEq, Eq)]
enum Reached {
    Declaration(PassedOnDeclaration),
    /// Two stars reach different declarations, or the walk reaches what the
    /// index cannot read or a binding that is no declaration.
    Undecided,
    /// The file does not export the name, or the walk already passed through it.
    Nothing,
}

/// What `from` passes `name` on from: its named `export … from` of the name
/// decides whatever it reaches, and its stars are read only when there is none;
/// no star passes `default`; two stars that reach different declarations, or
/// one that is undecided, leave the name undecided.
fn walk(layers: &[Layer], folded: &HashMap<&str, At>, from: &Parsed, name: &str, passed: &mut HashSet<(String, String)>) -> Reached {
    let Some(Passes { named, stars }) = from.passes(name) else { return Reached::Undecided };
    if let Some(hop) = named {
        return match hop {
            Some((to, imported)) => step(layers, folded, to, imported, passed),
            None => Reached::Undecided,
        };
    }
    if name == "default" {
        return Reached::Nothing;
    }
    let mut reached: Option<PassedOnDeclaration> = None;
    for star in stars {
        let Some(to) = star else { return Reached::Undecided };
        match step(layers, folded, to, name.to_owned(), passed) {
            Reached::Nothing => {}
            Reached::Undecided => return Reached::Undecided,
            Reached::Declaration(found) => {
                if reached.as_ref().is_some_and(|first| *first != found) {
                    return Reached::Undecided;
                }
                reached = Some(found);
            }
        }
    }
    reached.map_or(Reached::Nothing, Reached::Declaration)
}

/// The declaration `to` binds `name` to, or what `to` passes it on from;
/// nothing when the walk already passed through `to` under that name.
fn step(layers: &[Layer], folded: &HashMap<&str, At>, to: &str, name: String, passed: &mut HashSet<(String, String)>) -> Reached {
    if !passed.insert((to.to_owned(), name.clone())) {
        return Reached::Nothing;
    }
    let Some(next) = Parsed::of(layers, folded, to) else { return Reached::Undecided };
    match next.exports_locally(&name) {
        Some(Some((local, line))) => Reached::Declaration(PassedOnDeclaration { at: to.to_owned(), name: local, line }),
        Some(None) => Reached::Undecided,
        None => walk(layers, folded, &next, &name, passed),
    }
}

/// What one file passes a name on from.
struct Passes<'a> {
    /// Its named `export … from` of the name: the file the request resolved to
    /// and the name it has there, or `None` when that is nothing the walk can
    /// follow, a namespace (`export * as`) or a request to no file of the checkout.
    named: Option<Option<(&'a str, String)>>,
    /// The file each `export *` resolved to, `None` for one that resolved to
    /// no file of the checkout.
    stars: Vec<Option<&'a str>>,
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

    /// The line of the file's top-level declaration of `name`.
    fn declares(&self, name: &str) -> Option<u32> {
        let (text, parses) = (&self.layer.stored, &self.layer.parses);
        parses.symbols.range(self.row).find(|&symbol| text.text(parses.symbol_name.at(symbol)) == name).map(|symbol| parses.symbol_line.at(symbol))
    }

    /// How the file's own export list answers `name`: `None` when no export of
    /// it without a `from` names it, `Some(None)` when one does but binds no
    /// top-level declaration of the file (an import it exports again), and
    /// otherwise the declaration's name and line. A file whose parse never
    /// recorded its export list answers by its top-level declarations alone.
    fn exports_locally(&self, name: &str) -> Option<Option<(String, u32)>> {
        let (text, parses) = (&self.layer.stored, &self.layer.parses);
        if parses.exports_present[self.row] != 1 {
            return self.declares(name).map(|line| Some((name.to_owned(), line)));
        }
        let export = parses
            .exports
            .range(self.row)
            .find(|&export| text.optional(parses.export_from.at(export)).is_none() && text.optional(parses.export_exported.at(export)) == Some(name))?;
        let local = text.optional(parses.export_local.at(export));
        Some(local.and_then(|local| self.declares(local).map(|line| (local.to_owned(), line))))
    }

    /// What the file passes `name` on from, as [`Passes`] holds it; `None`
    /// when its parse never recorded its export list.
    fn passes(&self, name: &str) -> Option<Passes<'a>> {
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
            for (imported, exported, _) in passed_on_with_types(self.layer, self.row, request).unwrap_or_default() {
                match (imported, exported) {
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
