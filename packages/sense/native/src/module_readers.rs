//! Who reads a binding whose value changed, in its own file and in a file that
//! imports it.
//!
//! A changed constant ran nothing when it changed. What it changes is every
//! place that reads it, and the recording already holds a region for each of
//! those places: the function the read sits in is where the new value is
//! observed. So the change is moved there, and charged to the reader rather than
//! to the module that declares the value — which would be every test that ever
//! loaded the file.
//!
//! A read is what the parser calls one: an `IdentifierReference`. Shadowing is
//! not resolved, so a parameter of the same name counts as a read; that selects
//! more, never less. A read the walk cannot place in a function is placed on the
//! module:
//!
//! - a read at top level that the module evaluates when it loads — an argument,
//!   a condition, an initializer that calls — happened at load, so every test
//!   that loaded the file saw it;
//! - a read into another pure binding — `const B = { a: A }` — moves the change
//!   to `B`, and `B`'s readers are asked in turn;
//! - a read the module converts as it loads — `const B = A * 2`, `` `${A}` ``,
//!   `-A`, `{ [A]: 1 }` — is a load as well: the conversion can throw or run the
//!   value's own code, so a test that never reads `B` still sees the change;
//! - a name the file exports is the caller's to ask of the files that import it,
//!   and there only by the names they import it under.
//!
//! A namespace import is read through its members: `ns.A` is a read of `A`, and
//! `ns` handed anywhere else is an object nobody can follow, which is charged as
//! a load. So is a `require` or an `import()`: a binding reached that way has no
//! name the parser can match.

use std::collections::{BTreeMap, BTreeSet};

use oxc_ast::ast::*;
use napi_derive::napi;

use crate::module_shape::Lines;

#[path = "module_readers_walk.rs"]
mod walker;
use walker::reading_of;

#[path = "module_references.rs"]
mod references;

#[derive(Clone, Copy, PartialEq)]
enum Where {
    Function,
    Top,
    Escape,
}

struct Read {
    name: String,
    line: u32,
    at: Where,
    into: Option<String>,
    /// Converted as the module loads, by an operator or a template.
    converted: bool,
    /// Inside a function or an instance field, so it runs when that is called, not when the module loads.
    nested: bool,
}

/// One name an import declaration binds.
struct Import {
    local: String,
    /// The name it imports, `default` or `*`.
    imported: String,
    /// The specifier, as written.
    source: String,
}

/// One `export … from`.
struct Reexport {
    /// The name taken from the source, `*` for all.
    taken: String,
    /// The name given, if any.
    given: Option<String>,
    source: String,
}

/// One walk over a file, which every question about its readers is asked of.
pub struct Reading {
    reads: Vec<Read>,
    /// Local name to the names the module exports it as.
    exports: BTreeMap<String, Vec<String>>,
    /// Every name a value import binds.
    imports: Vec<Import>,
    reexports: Vec<Reexport>,
    /// Every specifier a value import or re-export names, side effects included.
    sources: BTreeSet<String>,
    /// Every specifier an import with no braces or binding names, `import './x'`, loaded for its effect.
    effects: BTreeSet<String>,
    /// A `require`, an `import()` or an `import x = require()`: a binding no name reaches.
    pub untraced: bool,
}

/// Where the change to some names is observed in one file. Every name is
/// paired with the seed it was reached from, which is the changed name a
/// reason reports.
pub struct Readers {
    /// Lines of reads inside functions, in the file's own coordinates.
    pub lines: BTreeSet<(u32, String)>,
    /// The changed names the module read when it loaded.
    pub load: BTreeSet<String>,
    /// Names the file exports whose value moved with the change.
    pub exported: BTreeMap<String, String>,
}

/// Every name the module exports, to what it is bound: a local name, or the
/// source and name a re-export takes. `export *` has no names and is keyed by
/// its source.
pub fn interface_of(program: &Program, lines: &Lines) -> BTreeMap<String, String> {
    let reading = reading_of(program, lines);
    let mut interface = BTreeMap::new();
    for (local, names) in &reading.exports {
        for name in names {
            interface.insert(name.clone(), format!("local {local}"));
        }
    }
    for statement in &program.body {
        match statement {
            Statement::ExportAllDeclaration(it) => {
                let from = &it.source.value;
                let key = it.exported.as_ref().map_or_else(|| format!("* {from}"), |name| name.name().to_string());
                interface.insert(key, format!("from {from} *"));
            }
            Statement::ExportFromDeclaration(it) => {
                for specifier in &it.specifiers {
                    let bound = format!("from {} {}", it.source.value, specifier.local.name());
                    interface.insert(specifier.exported.name().to_string(), bound);
                }
            }
            _ => {}
        }
    }
    interface
}

/// Where the change to these names is observed in this file: the lines of the
/// functions that read them, whether the module read them as it loaded, and the
/// names it exports them as. A name read into another pure binding brings that
/// binding along, until nothing new is brought.
pub fn readers_of(reading: &Reading, seeds: impl IntoIterator<Item = (String, String)>) -> Readers {
    let mut names: BTreeMap<String, String> = BTreeMap::new();
    for (name, origin) in seeds {
        names.entry(name).or_insert(origin);
    }
    let mut grew = true;
    while grew {
        grew = false;
        for read in &reading.reads {
            let Some(into) = &read.into else { continue };
            if let Some(origin) = names.get(&read.name).cloned() {
                if !names.contains_key(into) {
                    names.insert(into.clone(), origin);
                    grew = true;
                }
            }
        }
    }

    let mut lines = BTreeSet::new();
    let mut load = BTreeSet::new();
    for read in &reading.reads {
        let Some(origin) = names.get(&read.name) else { continue };
        match read.at {
            Where::Function => {
                lines.insert((read.line, origin.clone()));
            }
            Where::Escape => {
                load.insert(origin.clone());
            }
            Where::Top if read.into.is_none() || read.converted => {
                load.insert(origin.clone());
            }
            Where::Top => {}
        }
    }
    let mut exported = BTreeMap::new();
    for (name, origin) in &names {
        if name == "default" {
            exported.entry(name.clone()).or_insert_with(|| origin.clone());
        }
        for alias in reading.exports.get(name).into_iter().flatten() {
            exported.entry(alias.clone()).or_insert_with(|| origin.clone());
        }
    }
    Readers { lines, load, exported }
}

/// The local names an importer holds these exports under. Matched by the
/// imported name whatever the specifier says, because which module a specifier
/// resolves to is the resolver's answer and not the parser's; a name imported
/// from somewhere else only ever adds a reader. Every namespace is a candidate
/// for the same reason, member by member, and the namespace itself is the seed
/// whose other uses are an escape.
pub fn imported_as(reading: &Reading, exported: &[String]) -> Vec<(String, String)> {
    let mut seeds = Vec::new();
    for Import { local, imported, .. } in &reading.imports {
        if imported == "*" {
            seeds.extend(exported.iter().map(|name| (format!("{local}.{name}"), name.clone())));
            // The namespace itself, handed on whole, carries every changed name.
            seeds.extend(exported.first().map(|name| (local.clone(), name.clone())));
        } else if exported.contains(imported) {
            seeds.push((local.clone(), imported.clone()));
        }
    }
    seeds
}

/// The names a declaration binds at top level, through any destructuring.
pub fn declared(declaration: &Declaration) -> Vec<String> {
    let mut names = Vec::new();
    match declaration {
        Declaration::VariableDeclaration(it) => it.declarations.iter().for_each(|it| bound(&it.id, &mut names)),
        Declaration::FunctionDeclaration(it) => names.extend(it.id.as_ref().map(|id| id.name.to_string())),
        Declaration::ClassDeclaration(it) => names.extend(it.id.as_ref().map(|id| id.name.to_string())),
        Declaration::TSEnumDeclaration(it) => names.push(it.id.name.to_string()),
        Declaration::TSNamespaceDeclaration(it) => names.push(it.id.name.to_string()),
        Declaration::TSImportEqualsDeclaration(it) => names.push(it.id.name.to_string()),
        _ => {}
    }
    names
}

pub fn bound(pattern: &BindingPattern, names: &mut Vec<String>) {
    match pattern {
        BindingPattern::BindingIdentifier(it) => names.push(it.name.to_string()),
        BindingPattern::ObjectPattern(it) => {
            it.properties.iter().for_each(|property| bound(&property.value, names));
            it.rest.iter().for_each(|rest| bound(&rest.argument, names));
        }
        BindingPattern::ArrayPattern(it) => {
            it.elements.iter().flatten().for_each(|element| bound(element, names));
            it.rest.iter().for_each(|rest| bound(&rest.argument, names));
        }
        BindingPattern::AssignmentPattern(it) => bound(&it.left, names),
    }
}

/// One read of a changed value inside a function.
#[napi(object)]
pub struct ModuleRead {
    /// 1-based.
    pub line: u32,
    /// The changed name the read traces back to, as the caller named it.
    pub name: String,
}

/// A name this file hands on, and the changed name it carries.
#[napi(object)]
pub struct ModuleExport {
    pub name: String,
    pub origin: String,
}

/// Where one file observes a change of value.
#[napi(object)]
pub struct ModuleReaders {
    /// Reads inside functions, by line.
    pub reads: Vec<ModuleRead>,
    /// The changed names the module read as it loaded.
    pub load: Vec<String>,
    /// Names this file exports whose value moved with the change.
    pub exported: Vec<ModuleExport>,
    /// A `require`, an `import()` or an `import x = require()` no name reaches.
    pub untraced: bool,
    /// Every name this file imports by name, `default` included.
    pub imports: Vec<String>,
    /// Names this file re-exports from a source, among those that moved.
    pub passed: Vec<ModuleExport>,
    /// Every name this file exports.
    pub interface: Vec<String>,
}

/// The readers of `names` in one file: bindings of its own when `imported` is
/// false, or exports of a module it imports when true. Nothing when the text
/// does not parse.
#[napi(catch_unwind)]
pub fn module_readers(file: String, text: String, names: Vec<String>, imported: bool) -> Option<ModuleReaders> {
    let allocator = oxc_allocator::Allocator::default();
    let program = crate::module_shape::parse(&allocator, &file, &text, true)?;
    let lines = Lines::new(&text);
    let interface = interface_of(&program, &lines).into_keys().filter(|name| !name.starts_with("* ")).collect();
    let reading = reading_of(&program, &lines);
    let seeds = if imported {
        imported_as(&reading, &names)
    } else {
        names.iter().map(|name| (name.clone(), name.clone())).collect()
    };
    let readers = readers_of(&reading, seeds);
    let mut passed = BTreeMap::new();
    if imported {
        for Reexport { taken, given, .. } in &reading.reexports {
            match (taken.as_str(), given) {
                ("*", Some(namespace)) => {
                    if let Some(first) = names.first() {
                        passed.entry(namespace.clone()).or_insert_with(|| first.clone());
                    }
                }
                ("*", None) => {
                    for name in names.iter().filter(|name| *name != "default") {
                        passed.entry(name.clone()).or_insert_with(|| name.clone());
                    }
                }
                (taken, given) if names.iter().any(|name| name == taken) => {
                    passed.entry(given.clone().unwrap_or_else(|| taken.to_string())).or_insert_with(|| taken.to_string());
                }
                _ => {}
            }
        }
    }
    let imports = reading.imports.iter().filter(|it| it.imported != "*").map(|it| it.imported.clone());
    let pairs = |map: BTreeMap<String, String>| {
        map.into_iter().map(|(name, origin)| ModuleExport { name, origin }).collect::<Vec<_>>()
    };
    Some(ModuleReaders {
        reads: readers.lines.into_iter().map(|(line, name)| ModuleRead { line, name }).collect(),
        load: readers.load.into_iter().collect(),
        exported: pairs(readers.exported),
        untraced: reading.untraced,
        imports: imports.collect::<BTreeSet<_>>().into_iter().collect(),
        passed: pairs(passed),
        interface,
    })
}
