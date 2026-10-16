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
//! the import, and `export { name }` or `export default name` passes the name
//! on, which is no use either. A property key or a member, `o.name`, is no
//! reference at all.

// compass: variance-authority.reach.relations

use std::collections::HashSet;

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_syntax::symbol::SymbolId;
use serde::Serialize;

use crate::read::Lines;

/// One line that uses a name the module declares at its top level.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
pub struct OwnUse {
    pub(crate) name: String,
    pub(crate) line: u32,
}

/// Every line `program` uses one of its top-level names on, once per name and
/// line, by line and then by name in code units.
pub(crate) fn own_uses_in(program: &Program<'_>, lines: &Lines) -> Vec<OwnUse> {
    // A file that declares nothing at its top level has nothing to use, and no
    // scope tree is built for it.
    if !program.body.iter().any(|statement| statement.is_declaration() || matches!(statement, Statement::ExportNamedDeclaration(_) | Statement::ExportDefaultDeclaration(_))) {
        return Vec::new();
    }
    let built = SemanticBuilder::new().build(program);
    let scoping = built.semantic.scoping();
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
