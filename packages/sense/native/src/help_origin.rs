//! Where a name a file only passes on is declared.
//!
//! `export { taxOf as levy } from './tax.js'` exports `levy` and declares
//! nothing: the declaration is `taxOf` in the file the request resolved to.
//! The importers of a name are walked forward from its declaration
//! (`help_usage.rs`); this walks the other way, from one export back through
//! each `export … from` that passes it on, to a file whose top-level
//! declarations hold the name. The parse says which name each export of a
//! request passes on as which, and the file's record says which file the
//! request resolved to.

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
/// that passes it on, renamed or not and type-only or not. A file passes a name
/// on by naming it in `export { … } from`, or by `export * from` when no named
/// export of that file passes it. `None` when `file` declares the name itself,
/// and when the walk ends anywhere but at a declaration: at a namespace
/// (`export * as`), at a request that resolved to no file of the checkout, at
/// a file that neither declares nor passes the name, back at a file it
/// already passed through, or at two stars that reach different declarations.
pub(crate) fn declaration_passed_on(layers: &[Layer], file: &str, name: &str) -> Option<PassedOnDeclaration> {
    let folded = fold(layers);
    let start = Parsed::of(layers, &folded, file)?;
    if start.declares(name).is_some() {
        return None;
    }
    let mut passed = HashSet::from([(file.to_owned(), name.to_owned())]);
    walk(layers, &folded, &start, name, &mut passed)
}

/// Depth first through what `from` passes `name` on from. A named export
/// shadows every star, as in ECMAScript's export resolution; two stars that
/// reach different declarations make the name ambiguous, and an ambiguous name
/// names none.
fn walk(layers: &[Layer], folded: &HashMap<&str, At>, from: &Parsed, name: &str, passed: &mut HashSet<(String, String)>) -> Option<PassedOnDeclaration> {
    let (named, stars) = from.passes(name);
    for (to, imported) in named {
        if let Some(found) = step(layers, folded, to, imported, passed) {
            return Some(found);
        }
    }
    let mut reached: Option<PassedOnDeclaration> = None;
    for (to, imported) in stars {
        let Some(found) = step(layers, folded, to, imported, passed) else { continue };
        if reached.as_ref().is_some_and(|first| *first != found) {
            return None;
        }
        reached = Some(found);
    }
    reached
}

/// The declaration of `name` in `to`, or the one `to` passes it on from; `None`
/// when the walk already passed through `to` under that name.
fn step(layers: &[Layer], folded: &HashMap<&str, At>, to: &str, name: String, passed: &mut HashSet<(String, String)>) -> Option<PassedOnDeclaration> {
    if !passed.insert((to.to_owned(), name.clone())) {
        return None;
    }
    let next = Parsed::of(layers, folded, to)?;
    if let Some(line) = next.declares(&name) {
        return Some(PassedOnDeclaration { at: to.to_owned(), name, line });
    }
    walk(layers, folded, &next, &name, passed)
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

    /// Each file and name this file passes `name` on from: the named exports
    /// of its requests that pass it, and apart, the `export *` of each. A file
    /// whose parse never recorded its export list passes nothing here: it names
    /// no declaration rather than guess one.
    fn passes(&self, name: &str) -> (Vec<(&'a str, String)>, Vec<(&'a str, String)>) {
        let (text, parses) = (&self.layer.stored, &self.layer.parses);
        let (mut named, mut stars) = (Vec::new(), Vec::new());
        let first = parses.requests.at(self.row) as usize;
        for request in parses.requests.range(self.row) {
            // A re-export that carries only types is recorded as a `type` request;
            // its exports say which of those requests pass a name on.
            if !matches!(text.text(parses.request_kind.at(request)), "reexports" | "type") {
                continue;
            }
            let Some(to) = self.resolved[request - first] else { continue };
            for (imported, exported, _) in passed_on_with_types(self.layer, self.row, request).unwrap_or_default() {
                match (imported, exported) {
                    ("*", None) => stars.push((to, name.to_owned())),
                    // `export * as ns` passes a namespace: the name is a member read off it.
                    ("*", Some(_)) => {}
                    (imported, Some(exported)) if exported == name => named.push((to, imported.to_owned())),
                    _ => {}
                }
            }
        }
        (named, stars)
    }
}
