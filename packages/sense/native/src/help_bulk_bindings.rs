//! What a Rust request binds in bulk, which a request's named bindings do not
//! say: a glob `use a::b::*` binds every item of `a::b` under its own name,
//! and `mod b;` or `use a::b;` binds the module itself under its local.
//! `importers_of` in `help_usage.rs` asks it for each request that is no
//! re-export.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

use crate::compact::Layer;
use crate::help_usage::{NameUse, Taken};

/// The name `wanted` asks for a file's module itself by: a request that binds
/// the whole module answers it, under the local the module is bound to.
pub(crate) const MODULE: &str = "*";

/// Whether a Rust `use` path names the module `target` is, by the whole path
/// past its head: `crate::shapes` is `…/shapes.rs` or `…/shapes/mod.rs`, and
/// `crate::config::config` is an item of `config.rs`, not the file. The head
/// is `crate`, `self` or a run of `super`, or else the crate's name.
pub(crate) fn names_module(value: &str, target: &str) -> bool {
    let names: Vec<&str> = value.split("::").collect();
    let skip = match names.first() {
        Some(&"crate") | Some(&"self") => 1,
        Some(&"super") => names.iter().take_while(|&&name| name == "super").count(),
        _ => 1,
    };
    let rest = names[skip.min(names.len())..].join("/");
    if rest.is_empty() { return false; }
    target.ends_with(&format!("/{rest}.rs")) || target.ends_with(&format!("/{rest}/mod.rs")) || target == format!("{rest}.rs")
}

/// What a request binds in bulk, which `taken` leaves out. A Rust glob
/// `use a::b::*` binds every item of the file under its own name, so each
/// wanted name is taken as itself, unless the file declares the name or binds
/// it by name, which shadows the glob; `mod b;` and `use a::b;` bind the
/// module, so the module is taken under its local.
#[allow(clippy::too_many_arguments)]
pub(crate) fn wholesale(
    layer: &Layer,
    row: usize,
    request: usize,
    key: &str,
    names: &HashMap<String, HashMap<usize, bool>>,
    module: bool,
    by: &str,
    at: &str,
    kind: &str,
) -> Vec<Taken> {
    let (text, parses) = (&layer.stored, &layer.parses);
    let mut found = Vec::new();
    // A name a type-only re-export passed on is a type use, as `taken`'s are.
    let mut take = |name: &str, local: &str, line: u32, origins: &HashMap<usize, bool>| {
        for (&origin, &typed) in origins {
            let taken = NameUse { key: key.to_owned(), name: name.to_owned(), by: by.to_owned(), at: at.to_owned(), line, r#type: typed, kind: kind.to_owned(), through: None, through_line: 0 };
            found.push(Taken { origin, taken, local: local.to_owned() });
        }
    };
    for binding in parses.request_bindings.range(request) {
        let imported = text.text(parses.binding_imported.at(binding));
        let local = text.text(parses.binding_local.at(binding));
        let line = parses.binding_line.at(binding);
        if imported == "*" && local == "*" {
            let shadowed = |name: &str| {
                parses.symbols.range(row).any(|symbol| text.text(parses.symbol_name.at(symbol)) == name)
                    || parses.requests.range(row).flat_map(|other| parses.request_bindings.range(other)).any(|other| {
                        text.text(parses.binding_imported.at(other)) != "*" && text.text(parses.binding_local.at(other)) == name
                    })
            };
            for (name, origins) in names {
                if name != MODULE && name != "default" && !shadowed(name) {
                    take(name, name, line, origins);
                }
            }
        } else if imported == "*" || module {
            if let Some(origins) = names.get(MODULE) {
                take(MODULE, local, line, origins);
            }
        }
    }
    found
}
