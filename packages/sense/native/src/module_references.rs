//! Where a file references what it imports, by the specifier each import
//! names.
//!
//! A reference is an evaluation of an imported binding: where an inline
//! `require` would load the module. Passing the value on, storing it in a map
//! or comparing it is a reference; calling it later is not another one. The
//! parse erases every type first, so a name in one is never a reference. A
//! reference inside a function runs when the function is called; any other
//! runs when the file loads.
//!
//! Shadowing is not resolved, so a parameter named like an import counts as a
//! reference to it; that charges an import more, never less.

use std::collections::BTreeSet;

use napi_derive::napi;

use crate::module_shape::Lines;

use super::{reading_of, Import, Reading, Reexport};

/// One reference to an imported binding.
#[napi(object)]
#[derive(PartialEq, Eq, PartialOrd, Ord)]
pub struct ModuleReference {
    /// 1-based.
    pub line: u32,
    /// The specifier the import names, as written.
    pub source: String,
    /// The name taken from it: `default`, a member read through a namespace, or `*` for a namespace used whole.
    pub name: String,
    /// Runs when the file loads, rather than when a function is called.
    pub load: bool,
}

/// A name the file hands on from a source, which its importers use.
#[napi(object)]
#[derive(PartialEq, Eq, PartialOrd, Ord)]
pub struct ModulePassed {
    pub source: String,
    /// The name taken from the source, `*` for all.
    pub name: String,
}

/// What one file references of what it imports.
#[napi(object)]
pub struct ModuleReferences {
    /// Every reference, by line.
    pub references: Vec<ModuleReference>,
    /// Imported names the file exports again, and every `export … from`.
    pub passed: Vec<ModulePassed>,
    /// Every specifier the file loads, side effects and re-exports included, and no type.
    pub sources: Vec<String>,
    /// Every specifier imported with no binding, `import './x'`: loaded for its effect.
    pub effects: Vec<String>,
    /// A `require`, an `import()` or an `import x = require()` no name reaches.
    pub untraced: bool,
}

fn references_in(reading: &Reading) -> ModuleReferences {
    let value = |local: &str| reading.imports.iter().find(|it| it.local == local);
    let mut references = BTreeSet::new();
    for read in &reading.reads {
        let taken = match read.name.split_once('.') {
            Some((namespace, member)) => value(namespace).map(|it| (it, member.to_string())),
            None => value(&read.name).map(|it| (it, it.imported.clone())),
        };
        let Some((Import { source, .. }, name)) = taken else { continue };
        references.insert(ModuleReference { line: read.line, source: source.clone(), name, load: !read.nested });
    }
    let mut passed = BTreeSet::new();
    for import in &reading.imports {
        if reading.exports.contains_key(&import.local) {
            passed.insert(ModulePassed { source: import.source.clone(), name: import.imported.clone() });
        }
    }
    for Reexport { taken, source, .. } in &reading.reexports {
        passed.insert(ModulePassed { source: source.clone(), name: taken.clone() });
    }
    ModuleReferences {
        references: references.into_iter().collect(),
        passed: passed.into_iter().collect(),
        sources: reading.sources.iter().cloned().collect(),
        effects: reading.effects.iter().cloned().collect(),
        untraced: reading.untraced,
    }
}

/// Every reference one file makes to what it imports. Nothing when the text
/// does not parse.
#[napi(catch_unwind)]
pub fn module_references(file: String, text: String) -> Option<ModuleReferences> {
    let allocator = oxc_allocator::Allocator::default();
    let program = crate::module_shape::parse(&allocator, &file, &text, true)?;
    Some(references_in(&reading_of(&program, &Lines::new(&text))))
}
