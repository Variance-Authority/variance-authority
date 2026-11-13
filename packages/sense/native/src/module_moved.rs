//! Which of a module's exports behave differently after a change, read at the
//! grain of a file.
//!
//! The verdict (`module_verdict.rs`) says which bindings' values moved. A walk
//! over the file graph needs one more answer: which **exports** an importer
//! would see move, because an importer reaches this file only through the names
//! it imports. An export moves when its own declaration changed — a value, or a
//! function body, which the verdict does not look inside — or when it refers,
//! directly or through other top-level bindings of this file, to one that did.
//!
//! References are what the parser calls them, `IdentifierReference`s, and
//! shadowing is not resolved: a parameter named like a changed binding counts,
//! which moves more, never less. Two more rules keep the closure from moving
//! less than runs:
//!
//! - a changed binding that refers to a `let` or a `var` may write it, so that
//!   binding moves too, and so does everything that reads it;
//! - a top-level statement that binds nothing and refers to a moved binding —
//!   `window.handler = handler` — hands it somewhere no import names, so the
//!   answer is *every export*, and the caller charges the file whole.

use std::collections::{BTreeMap, BTreeSet};

use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
use oxc_span::ContentEq;
use oxc_syntax::scope::ScopeFlags;

use crate::module_readers::bound;

/// A top-level binding's whole declaration, bodies included.
enum Definition<'s, 'a> {
    Function(&'s Function<'a>),
    Class(&'s Class<'a>),
    Declarator(&'s VariableDeclarator<'a>),
    Expression(&'s Expression<'a>),
    Declaration(&'s Declaration<'a>),
}

impl Definition<'_, '_> {
    fn same(&self, other: &Self) -> bool {
        match (self, other) {
            (Definition::Function(a), Definition::Function(b)) => a.content_eq(b),
            (Definition::Class(a), Definition::Class(b)) => a.content_eq(b),
            (Definition::Declarator(a), Definition::Declarator(b)) => a.content_eq(b),
            (Definition::Expression(a), Definition::Expression(b)) => a.content_eq(b),
            (Definition::Declaration(a), Definition::Declaration(b)) => a.content_eq(b),
            _ => false,
        }
    }
}

/// One text's top level: each binding's declaration and what it refers to.
pub struct Top<'s, 'a> {
    definitions: BTreeMap<String, Definition<'s, 'a>>,
    refers: BTreeMap<String, BTreeSet<String>>,
    /// Names referred to by statements that bind nothing.
    loose: BTreeSet<String>,
    /// Bindings declared with `let` or `var`.
    mutable: BTreeSet<String>,
}

#[derive(Default)]
struct References(BTreeSet<String>);

impl<'a> Visit<'a> for References {
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        self.0.insert(it.name.to_string());
    }
}

fn references(visit: impl FnOnce(&mut References)) -> BTreeSet<String> {
    let mut found = References::default();
    visit(&mut found);
    found.0
}

impl<'s, 'a> Top<'s, 'a> {
    /// The top level of a program parsed with its bodies kept.
    pub fn of(program: &'s Program<'a>) -> Top<'s, 'a> {
        let mut top = Top {
            definitions: BTreeMap::new(),
            refers: BTreeMap::new(),
            loose: BTreeSet::new(),
            mutable: BTreeSet::new(),
        };
        for statement in &program.body {
            match statement {
                Statement::ImportDeclaration(_)
                | Statement::ExportFromDeclaration(_)
                | Statement::ExportAllDeclaration(_)
                | Statement::ExportNamedDeclaration(_) => {}
                Statement::ExportDeclaration(it) => top.declaration(&it.declaration),
                Statement::ExportDefaultDeclaration(it) => match &it.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                        let name = function.id.as_ref().map_or("default".to_string(), |id| id.name.to_string());
                        let refers = references(|found| found.visit_function(function, ScopeFlags::Function));
                        top.define(name, Definition::Function(function), refers);
                    }
                    ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                        let name = class.id.as_ref().map_or("default".to_string(), |id| id.name.to_string());
                        top.define(name, Definition::Class(class), references(|found| found.visit_class(class)));
                    }
                    ExportDefaultDeclarationKind::TSInterfaceDeclaration(_) => {}
                    // `export default name` hands on a binding the interface names.
                    ExportDefaultDeclarationKind::Identifier(_) => {}
                    declaration => {
                        let expression = declaration.to_expression();
                        let refers = references(|found| found.visit_expression(expression));
                        top.define("default".to_string(), Definition::Expression(expression), refers);
                    }
                },
                statement => match statement.as_declaration() {
                    Some(declaration) => top.declaration(declaration),
                    None => top.loose.extend(references(|found| found.visit_statement(statement))),
                },
            }
        }
        top
    }

    fn define(&mut self, name: String, definition: Definition<'s, 'a>, refers: BTreeSet<String>) {
        self.definitions.insert(name.clone(), definition);
        self.refers.insert(name, refers);
    }

    fn declaration(&mut self, it: &'s Declaration<'a>) {
        match it {
            Declaration::FunctionDeclaration(function) => {
                if let Some(id) = &function.id {
                    let refers = references(|found| found.visit_function(function, ScopeFlags::Function));
                    self.define(id.name.to_string(), Definition::Function(function), refers);
                }
            }
            Declaration::ClassDeclaration(class) => {
                if let Some(id) = &class.id {
                    self.define(id.name.to_string(), Definition::Class(class), references(|found| found.visit_class(class)));
                }
            }
            Declaration::VariableDeclaration(variables) => {
                for declarator in &variables.declarations {
                    let mut names = Vec::new();
                    bound(&declarator.id, &mut names);
                    let refers = references(|found| found.visit_variable_declarator(declarator));
                    for name in names {
                        if variables.kind != VariableDeclarationKind::Const {
                            self.mutable.insert(name.clone());
                        }
                        self.define(name, Definition::Declarator(declarator), refers.clone());
                    }
                }
            }
            it => {
                let refers = references(|found| found.visit_declaration(it));
                for name in crate::module_readers::declared(it) {
                    self.define(name, Definition::Declaration(it), refers.clone());
                }
            }
        }
    }

    /// Bindings both texts declare whose declaration differs, bodies included.
    pub fn changed(&self, other: &Top) -> Vec<String> {
        let differs = |(name, definition): (&String, &Definition)| {
            other.definitions.get(name).is_some_and(|was| !was.same(definition)).then(|| name.clone())
        };
        self.definitions.iter().filter_map(differs).collect()
    }

    /// Every binding of this text that moves with `seeds`, or nothing when a
    /// statement that binds nothing hands one of them on.
    pub fn moved(&self, seeds: impl IntoIterator<Item = String>) -> Option<BTreeSet<String>> {
        let mut moved: BTreeSet<String> = seeds.into_iter().collect();
        loop {
            let mut grew = Vec::new();
            for (name, refers) in &self.refers {
                if moved.contains(name) {
                    // A changed binding may write any `let` or `var` it names.
                    grew.extend(refers.iter().filter(|it| self.mutable.contains(*it) && !moved.contains(*it)).cloned());
                } else if refers.iter().any(|it| moved.contains(it)) {
                    grew.push(name.clone());
                }
            }
            if grew.is_empty() {
                break;
            }
            moved.extend(grew);
        }
        self.loose.is_disjoint(&moved).then_some(moved)
    }
}

/// The exported names whose bindings moved, read off the new text's interface:
/// `local X` entries, and `default` when the default export has no name.
pub fn exported(interface: &BTreeMap<String, String>, moved: &BTreeSet<String>) -> BTreeSet<String> {
    let mut names: BTreeSet<String> = interface
        .iter()
        .filter(|(_, bound)| bound.strip_prefix("local ").is_some_and(|local| moved.contains(local)))
        .map(|(name, _)| name.clone())
        .collect();
    if moved.contains("default") {
        names.insert("default".to_string());
    }
    names
}
