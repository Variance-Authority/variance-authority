//! What a change did to the module's own evaluation, read from both texts.
//!
//! A module block's crossings are every test that loaded the file, so charging
//! one says *this change reached everything that imported the module*. That is
//! true of an import kept for its effect, a top-level call, a class with a new
//! decorator. It is not true of a comment, a type, a function added beside the
//! others, an import of a name, or an edit inside a function body; those change what runs when
//! something calls, and the regions the calls enter already answer for them.
//!
//! So each text is parsed twice: whole, and with every function emptied
//! (`module_shape.rs`). The whole programs equal under `ContentEq` is a change
//! nothing runs. Otherwise the emptied program — what the module does when it
//! is loaded — is reduced to two things:
//!
//! - the **sequence**: every statement that evaluates something when the module
//!   runs — an import that binds nothing, which is there for what loading it
//!   does; a call; a declaration whose initializer calls, reads a property, spreads or
//!   destructures; a class that extends, decorates or computes; an enum or a
//!   namespace that is emitted;
//! - the **bindings**: each name a pure declaration binds, and what it is bound
//!   to — an import, a function, a value whose evaluation runs nothing;
//! - the **order**: the sequence and every binding that is not hoisted, as they
//!   are written. Two declarations that trade places can read each other before
//!   either is initialized, which throws as the module loads.
//!
//! An import that binds names is a binding and nothing else. Loading a module
//! is assumed to do nothing but declare what it exports, so the module it loads
//! reaches this one only through the names read from it, and a name nothing
//! reads yet has no audience: importing a new module and calling it in one
//! function is a change to that function. A module whose loading does
//! something is charged for that in its own reading.
//!
//! A different sequence is a load-time change, and the module is charged. An
//! equal sequence with a binding whose value changed is a changed value, and
//! the value is what moved: the functions that read it are the audience, not
//! the module (`module_readers.rs`). An exported name that disappears or is
//! bound to something else moves under every importer that reads it, so it is
//! reported beside the values. Equal on every count, and what differs runs only
//! when something calls.
//!
//! A name on one side only is a declaration added or removed. Who reads it is
//! the linter's and the compiler's to say, with one exception the parser can see
//! and they cannot flag: a top-level name added over a global the old text
//! already read, or removed from under a read the new text still makes. Those
//! reads changed meaning without their lines changing, so the name counts as a
//! changed value.

use std::collections::{BTreeMap, BTreeSet};

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
use oxc_span::ContentEq;
use napi_derive::napi;

use crate::module_readers::{bound, declared, interface_of};
use crate::module_shape::{parse, plain_class, pure, Lines};

pub enum Verdict {
    /// No text that runs differs: comments, types, spelling, formatting.
    None,
    /// The load is the same but for these bindings' values and these exports;
    /// with both empty, what differs runs only when something calls. `gone` is
    /// the exports the new text no longer has. `imported` is every source an
    /// import binds from on one side only: loading it is a use only when its
    /// package declares so, which is the manifest's to answer, not the text's.
    Values { names: Vec<String>, exports: Vec<String>, gone: Vec<String>, imported: Vec<String> },
    /// What the module does when it is loaded is different.
    Load,
}

/// One step of the module's evaluation, compared by the parser's own equality.
enum Step<'s, 'a> {
    /// An import that binds nothing: `import './x'`, `import {} from './x'`.
    Import(&'s str),
    /// A re-export loads its source.
    From(&'s str),
    Declaration(&'s Declaration<'a>),
    Statement(&'s Statement<'a>),
    Declarator(VariableDeclarationKind, &'s VariableDeclarator<'a>),
    Default(&'s ExportDefaultDeclaration<'a>),
}

impl PartialEq for Step<'_, '_> {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Step::Import(a), Step::Import(b)) => a == b,
            (Step::From(a), Step::From(b)) => a == b,
            (Step::Declaration(a), Step::Declaration(b)) => a.content_eq(b),
            (Step::Statement(a), Step::Statement(b)) => a.content_eq(b),
            (Step::Declarator(k, a), Step::Declarator(l, b)) => k == l && a.content_eq(b),
            (Step::Default(a), Step::Default(b)) => a.content_eq(b),
            _ => false,
        }
    }
}

/// What a pure binding is bound to.
enum Bound<'s, 'a> {
    Import(String),
    Function,
    /// The kind is part of the value: `let` to `const` makes every function
    /// that assigns it throw.
    Value(Option<VariableDeclarationKind>, Option<&'s Expression<'a>>),
    /// A plain class is its members with every function emptied: what a `new`
    /// makes, and which methods it has. A method's body is a region of its own.
    Class(&'s Class<'a>),
    /// Computed at load: the sequence is the one to compare.
    Evaluated,
}

impl Bound<'_, '_> {
    fn same(&self, other: &Self) -> bool {
        match (self, other) {
            (Bound::Import(a), Bound::Import(b)) => a == b,
            (Bound::Function, Bound::Function) | (Bound::Evaluated, Bound::Evaluated) => true,
            (Bound::Value(k, a), Bound::Value(l, b)) => k == l && same_value(*a, *b),
            (Bound::Class(a), Bound::Class(b)) => a.content_eq(b),
            _ => false,
        }
    }
}

fn same_value(a: Option<&Expression>, b: Option<&Expression>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => a.content_eq(b),
        (a, b) => a.is_none() && b.is_none(),
    }
}

struct View<'s, 'a> {
    sequence: Vec<Step<'s, 'a>>,
    bindings: BTreeMap<String, Bound<'s, 'a>>,
    /// Each non-hoisted binding and each step, as written: `None` is a step.
    order: Vec<Option<String>>,
    /// The sources an import binds names from.
    imports: BTreeSet<&'s str>,
}

impl<'s, 'a> View<'s, 'a> {
    fn step(&mut self, step: Step<'s, 'a>) {
        self.sequence.push(step);
        self.order.push(None);
    }

    fn bind(&mut self, name: String, bound: Bound<'s, 'a>) {
        // A function and an import exist before the first statement runs.
        if !matches!(bound, Bound::Function | Bound::Import(_)) {
            self.order.push(Some(name.clone()));
        }
        self.bindings.insert(name, bound);
    }

    /// The order, over the bindings both texts make: a name added or removed is
    /// not a move.
    fn order_over(&self, other: &View) -> Vec<Option<&String>> {
        let kept = |name: &String| other.bindings.contains_key(name);
        self.order.iter().filter(|at| at.as_ref().is_none_or(kept)).map(Option::as_ref).collect()
    }
}

pub fn verdict(file: &str, before: &str, after: &str) -> Option<Verdict> {
    let allocator = Allocator::default();
    let (old, now) = (parse(&allocator, file, before, true)?, parse(&allocator, file, after, true)?);
    if old.directives.content_eq(&now.directives) && old.body.content_eq(&now.body) {
        return Some(Verdict::None);
    }
    let (old_reads, now_reads) = (reads_of(&old), reads_of(&now));
    let (old_lines, now_lines) = (Lines::new(before), Lines::new(after));
    let (old_interface, now_interface) = (interface_of(&old, &old_lines), interface_of(&now, &now_lines));

    let (old, now) = (parse(&allocator, file, before, false)?, parse(&allocator, file, after, false)?);
    if !old.directives.content_eq(&now.directives) {
        return Some(Verdict::Load);
    }
    let (was, is) = (view_of(&old), view_of(&now));
    if was.sequence != is.sequence || was.order_over(&is) != is.order_over(&was) {
        return Some(Verdict::Load);
    }

    let mut names = Vec::new();
    let all: BTreeSet<&String> = was.bindings.keys().chain(is.bindings.keys()).collect();
    for name in all {
        let (a, b) = (was.bindings.get(name), is.bindings.get(name));
        if let (Some(a), Some(b)) = (a, b) {
            if a.same(b) {
                continue;
            }
        }
        if matches!(a, Some(Bound::Evaluated)) || matches!(b, Some(Bound::Evaluated)) {
            return Some(Verdict::Load);
        }
        let read = match (a, b) {
            (Some(_), Some(_)) => true,
            (None, _) => old_reads.contains(name),
            (_, None) => now_reads.contains(name),
        };
        if read {
            names.push(name.clone());
        }
    }

    // A name exported for the first time moves too: a namespace handed on whole
    // is read for every name it holds, the new one included.
    let moved = old_interface.iter().filter(|(name, bound)| now_interface.get(*name) != Some(bound));
    let added = now_interface.keys().filter(|name| !old_interface.contains_key(*name));
    let exports = moved.map(|(name, _)| name).chain(added).cloned().collect();
    let gone = old_interface.keys().filter(|name| !now_interface.contains_key(*name)).cloned().collect();
    let imported = was.imports.symmetric_difference(&is.imports).map(|source| source.to_string()).collect();
    Some(Verdict::Values { names, exports, gone, imported })
}

fn view_of<'s, 'a>(program: &'s Program<'a>) -> View<'s, 'a> {
    let mut view = View { sequence: Vec::new(), bindings: BTreeMap::new(), order: Vec::new(), imports: BTreeSet::new() };
    for statement in &program.body {
        match statement {
            Statement::ImportDeclaration(it) => {
                if it.specifiers.as_ref().is_none_or(|specifiers| specifiers.is_empty()) {
                    view.step(Step::Import(it.source.value.as_str()));
                } else if !it.import_kind.is_type() {
                    view.imports.insert(it.source.value.as_str());
                }
                for specifier in it.specifiers.iter().flatten() {
                    let (local, imported) = match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(it) => (&it.local, it.imported.name().to_string()),
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(it) => (&it.local, "default".to_string()),
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(it) => (&it.local, "*".to_string()),
                    };
                    view.bind(local.name.to_string(), Bound::Import(format!("{} {imported}", it.source.value)));
                }
            }
            // FIXME: a re-export that binds names is a use by whoever imports
            // them, as an import that binds names is; adding or removing one of
            // an undeclared module charges every test that loaded this file.
            Statement::ExportFromDeclaration(it) => view.step(Step::From(it.source.value.as_str())),
            Statement::ExportAllDeclaration(it) => view.step(Step::From(it.source.value.as_str())),
            // An export list without a source runs nothing.
            Statement::ExportNamedDeclaration(_) => {}
            Statement::ExportDeclaration(it) => declaration(&mut view, &it.declaration),
            Statement::ExportDefaultDeclaration(it) => {
                let (id, bound) = match &it.declaration {
                    ExportDefaultDeclarationKind::TSInterfaceDeclaration(_) => continue,
                    ExportDefaultDeclarationKind::FunctionDeclaration(function) => (function.id.as_ref(), Bound::Function),
                    ExportDefaultDeclarationKind::ClassDeclaration(class) if plain_class(class) => {
                        (class.id.as_ref(), Bound::Class(class))
                    }
                    ExportDefaultDeclarationKind::ClassDeclaration(class) => (class.id.as_ref(), Bound::Evaluated),
                    declaration if pure(declaration.to_expression()) => {
                        (None, Bound::Value(None, Some(declaration.to_expression())))
                    }
                    _ => (None, Bound::Evaluated),
                };
                if matches!(bound, Bound::Evaluated) {
                    view.step(Step::Default(it));
                }
                if let Some(id) = id {
                    let named = match &bound {
                        Bound::Class(class) => Bound::Class(class),
                        Bound::Function => Bound::Function,
                        _ => Bound::Evaluated,
                    };
                    view.bind(id.name.to_string(), named);
                }
                view.bind("default".to_string(), bound);
            }
            statement => match statement.as_declaration() {
                Some(it) => declaration(&mut view, it),
                None => view.step(Step::Statement(statement)),
            },
        }
    }
    view
}

fn declaration<'s, 'a>(view: &mut View<'s, 'a>, it: &'s Declaration<'a>) {
    match it {
        Declaration::FunctionDeclaration(function) => {
            if let Some(id) = &function.id {
                view.bind(id.name.to_string(), Bound::Function);
            }
        }
        Declaration::ClassDeclaration(class) if plain_class(class) => {
            if let Some(id) = &class.id {
                view.bind(id.name.to_string(), Bound::Class(class));
            }
        }
        Declaration::VariableDeclaration(variables) => {
            for declarator in &variables.declarations {
                match &declarator.id {
                    BindingPattern::BindingIdentifier(id) if declarator.init.as_ref().is_none_or(pure) => {
                        let bound = Bound::Value(Some(variables.kind), declarator.init.as_ref());
                        view.bind(id.name.to_string(), bound);
                    }
                    _ => {
                        view.step(Step::Declarator(variables.kind, declarator));
                        let mut names = Vec::new();
                        bound(&declarator.id, &mut names);
                        for name in names {
                            view.bind(name, Bound::Evaluated);
                        }
                    }
                }
            }
        }
        it => {
            view.step(Step::Declaration(it));
            for name in declared(it) {
                view.bind(name, Bound::Evaluated);
            }
        }
    }
}

/// Every name the text reads, in function bodies too: a global a body reads
/// changes meaning when a declaration of that name appears beside it.
fn reads_of(program: &Program) -> BTreeSet<String> {
    struct Names(BTreeSet<String>);
    impl<'a> Visit<'a> for Names {
        fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
            self.0.insert(it.name.to_string());
        }
    }
    let mut names = Names(BTreeSet::new());
    names.visit_program(program);
    names.0
}

/// What a change did to a module's load, as the selector reads it.
#[napi(object)]
pub struct ModuleVerdict {
    /// `none`, `bodies`, `values` or `load`.
    pub kind: String,
    /// Bindings whose value moved: their readers answer for the change.
    pub names: Vec<String>,
    /// Exports that moved or disappeared: their importers' readers answer.
    pub exports: Vec<String>,
    /// Exports the new text no longer has.
    pub gone: Vec<String>,
    /// Sources an import binds names from on one side only.
    pub imported: Vec<String>,
}

/// The verdict on one file's change, or nothing when either text does not parse.
#[napi]
pub fn module_verdict(file: String, before: String, after: String) -> Option<ModuleVerdict> {
    let (kind, names, exports, gone, imported) = match verdict(&file, &before, &after)? {
        Verdict::None => ("none", Vec::new(), Vec::new(), Vec::new(), Vec::new()),
        Verdict::Load => ("load", Vec::new(), Vec::new(), Vec::new(), Vec::new()),
        Verdict::Values { names, exports, gone, imported } => {
            let kind = if names.is_empty() && exports.is_empty() { "bodies" } else { "values" };
            (kind, names, exports, gone, imported)
        }
    };
    Some(ModuleVerdict { kind: kind.to_string(), names, exports, gone, imported })
}
