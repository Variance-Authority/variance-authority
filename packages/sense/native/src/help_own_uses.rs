//! Where a module uses a name it declares at its top level.
//!
//! An import names a declaration in another file; a use in the declaring file
//! names it by scope, and only scope tells it from a local of the same name. So
//! the scope is oxc's: `oxc_semantic` binds every identifier reference to the
//! symbol it resolves to, innermost binding first, and a use here is a
//! reference whose symbol is one the file's own scope declares — a call, a
//! value, a type, a `typeof`, a JSX tag. A parameter, a `const`, a catch
//! binding or an inner function of the same name is another symbol, so what it
//! shadows is no use. An import binding is the other file's name, answered by
//! the import, and `export { name }`, `export default name` or a key of the
//! object `export =` or `module.exports =` hands out passes the name on, which
//! is no use either. A property key or a member, `o.name`, is no
//! reference at all.

// compass: variance-authority.reach.relations

use std::collections::HashSet;

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::Scoping;
use oxc_syntax::symbol::SymbolId;
use serde::Serialize;

use crate::read::Lines;
use crate::top_level::top_level;

/// One line that uses a name the module declares at its top level.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
pub struct OwnUse {
    pub(crate) name: String,
    pub(crate) line: u32,
}

/// Every line `program` uses one of its top-level names on, once per name and
/// line, by line and then by name in code units.
pub(crate) fn own_uses_in(program: &Program<'_>, scoping: &Scoping, lines: &Lines) -> Vec<OwnUse> {
    // A file whose own statements bind no name has nothing to use. Which
    // statement binds a name is `top_level`'s answer, the one every reader of
    // the declarations takes.
    let mut binds = false;
    top_level(program, |_| binds = true);
    if !binds {
        return Vec::new();
    }
    let root = scoping.root_scope_id();
    let own: HashSet<SymbolId> = scoping
        .get_bindings(root)
        .values()
        .copied()
        .filter(|symbol| !scoping.symbol_flags(*symbol).is_import())
        .collect();
    if own.is_empty() {
        return Vec::new();
    }

    let mut walker = Walker { scoping, own, lines, seen: HashSet::new() };
    walker.visit_program(program);
    let mut found: Vec<OwnUse> = walker.seen.into_iter().map(|(name, line)| OwnUse { name, line }).collect();
    found.sort_by(|a, b| a.line.cmp(&b.line).then_with(|| crate::order::code_unit(&a.name, &b.name)));
    found
}

struct Walker<'s> {
    scoping: &'s Scoping,
    own: HashSet<SymbolId>,
    lines: &'s Lines,
    seen: HashSet<(String, u32)>,
}

impl<'a> Visit<'a> for Walker<'_> {
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        let Some(reference) = it.reference_id.get() else { return };
        let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else { return };
        if self.own.contains(&symbol) {
            self.seen.insert((it.name.to_string(), self.lines.at(it.span.start)));
        }
    }

    // An object the module hands out whole, every key spelled, passes on each
    // declaration a key names, as `export { name }` does; one with a key no
    // reader can spell exports nothing, so naming a declaration in it is a use.
    fn visit_program(&mut self, it: &Program<'a>) {
        for statement in &it.body {
            let Some(object) = crate::assigned_object::assigned(statement).filter(|it| crate::assigned_object::spelled(it)) else {
                self.visit_statement(statement);
                continue;
            };
            for property in &object.properties {
                match property {
                    ObjectPropertyKind::ObjectProperty(property) if crate::assigned_object::named(property).is_some() => {
                        self.visit_property_key(&property.key);
                    }
                    _ => self.visit_object_property_kind(property),
                }
            }
        }
    }

    // `export { name }` and `export { name as other }` pass the name on.
    fn visit_export_specifier(&mut self, _: &ExportSpecifier<'a>) {}

    // So does `export default name`; any other default is an expression that may use one.
    fn visit_export_default_declaration(&mut self, it: &ExportDefaultDeclaration<'a>) {
        if matches!(it.declaration, ExportDefaultDeclarationKind::Identifier(_)) {
            return;
        }
        walk::walk_export_default_declaration(self, it);
    }
}

#[cfg(test)]
#[path = "help_own_uses_tests.rs"]
mod tests;
