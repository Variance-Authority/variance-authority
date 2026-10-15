//! Where a member of an interface, a type literal or a class is declared.
//!
//! A member is never imported, so the import graph names nobody who declares
//! or uses one. Its declarations are a fact of the parse: a property or method
//! signature, a class method, property or accessor, or a constructor parameter
//! property, each on the interface, type alias or class that holds it. The
//! files are chosen by the caller — ripgrep owns finding the text — and read
//! from the working tree; a file that does not read or does not parse declares
//! nothing.

// compass: variance-authority.reach.relations

use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::GetSpan;
use rayon::prelude::*;

use crate::help_usage::kind_of;
use crate::module_shape::Lines;
use crate::orient_map_read::beside;
use crate::package_owners::{owners, NO_OWNER};

/// One declaration of a member, `on` the container that declares it.
#[napi(object)]
pub struct MemberSite {
    pub at: String,
    pub line: u32,
    /// The package of the file, or empty when no package holds it.
    pub by: String,
    /// `story`, `test` or `source`, by the file's name.
    pub kind: String,
    /// The interface, type alias or class the member is on, or how it is
    /// written when it has no name.
    pub on: String,
}

/// Every declaration of a member named `name` in `files`, repo-relative and
/// read from the working tree at `root`, ordered by file in code units, then
/// by line.
#[napi]
pub fn member_declarations_of(root: String, files: Vec<String>, name: String) -> Vec<MemberSite> {
    let mut files: Vec<&str> = files.iter().map(String::as_str).filter(|file| crate::read::dialect(file).is_some()).collect();
    files.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    files.dedup();
    let found: Vec<(&str, Vec<(u32, String)>)> = files
        .par_iter()
        .filter_map(|&file| {
            let text = std::fs::read_to_string(std::path::Path::new(&root).join(file)).ok()?;
            let declared = declared(file, &text, &name);
            (!declared.is_empty()).then_some((file, declared))
        })
        .collect();
    let paths = beside(&root, found.iter().map(|&(file, _)| file));
    let owners = owners(&root, &paths);
    let by = |file: &str| match owners.files.get(file) {
        Some(&(owner, _)) if owner != NO_OWNER => owners.packages[owner as usize].name.clone(),
        _ => String::new(),
    };
    found
        .into_iter()
        .flat_map(|(file, declared)| {
            let by = by(file);
            declared.into_iter().map(move |(line, on)| MemberSite { at: file.to_owned(), line, by: by.clone(), kind: kind_of(file).to_owned(), on })
        })
        .collect()
}

/// The declarations of member `name` in one file, by line and container; none when it does not parse.
fn declared(file: &str, text: &str, name: &str) -> Vec<(u32, String)> {
    let allocator = Allocator::default();
    let source_type = crate::read::dialect(file).unwrap_or_default();
    let parsed = Parser::new(&allocator, text, source_type).parse();
    if parsed.panicked { return Vec::new(); }
    let lines = Lines::new(text);
    let mut walker = Walker { name, lines: &lines, containers: Vec::new(), alias: None, declared: Vec::new() };
    walker.visit_program(&parsed.program);
    walker.declared
}

struct Walker<'n> {
    name: &'n str,
    lines: &'n Lines,
    /// The containers the walk is inside, innermost last.
    containers: Vec<String>,
    /// The type alias whose own body is the type literal visited next.
    alias: Option<String>,
    declared: Vec<(u32, String)>,
}

impl Walker<'_> {
    fn declare(&mut self, key: Option<std::borrow::Cow<'_, str>>, at: u32) {
        if key.is_some_and(|key| key == self.name) {
            let on = self.containers.last().cloned().unwrap_or_default();
            self.declared.push((self.lines.at(at), on));
        }
    }

    fn within(&mut self, container: String, walk: impl FnOnce(&mut Self)) {
        self.containers.push(container);
        walk(self);
        self.containers.pop();
    }
}

impl<'a> Visit<'a> for Walker<'_> {
    fn visit_ts_interface_declaration(&mut self, it: &TSInterfaceDeclaration<'a>) {
        self.within(it.id.name.to_string(), |walker| walk::walk_ts_interface_declaration(walker, it));
    }

    // The alias names its own body only: a type literal in a type parameter's
    // constraint is walked first and is not the alias.
    fn visit_ts_type_alias_declaration(&mut self, it: &TSTypeAliasDeclaration<'a>) {
        if let Some(parameters) = &it.type_parameters { self.visit_ts_type_parameter_declaration(parameters); }
        if matches!(it.type_annotation, TSType::TSTypeLiteral(_)) { self.alias = Some(it.id.name.to_string()); }
        self.visit_ts_type(&it.type_annotation);
        self.alias = None;
    }

    fn visit_ts_type_literal(&mut self, it: &TSTypeLiteral<'a>) {
        let container = self.alias.take().unwrap_or_else(|| "a type literal".to_owned());
        self.within(container, |walker| walk::walk_ts_type_literal(walker, it));
    }

    fn visit_class(&mut self, it: &Class<'a>) {
        let container = it.id.as_ref().map_or_else(|| "a class".to_owned(), |id| id.name.to_string());
        self.within(container, |walker| walk::walk_class(walker, it));
    }

    fn visit_ts_property_signature(&mut self, it: &TSPropertySignature<'a>) {
        self.declare(it.key.static_name(), it.key.span().start);
        walk::walk_ts_property_signature(self, it);
    }

    fn visit_ts_method_signature(&mut self, it: &TSMethodSignature<'a>) {
        self.declare(it.key.static_name(), it.key.span().start);
        walk::walk_ts_method_signature(self, it);
    }

    fn visit_method_definition(&mut self, it: &MethodDefinition<'a>) {
        self.declare(it.key.static_name(), it.key.span().start);
        walk::walk_method_definition(self, it);
    }

    fn visit_property_definition(&mut self, it: &PropertyDefinition<'a>) {
        self.declare(it.key.static_name(), it.key.span().start);
        walk::walk_property_definition(self, it);
    }

    fn visit_accessor_property(&mut self, it: &AccessorProperty<'a>) {
        self.declare(it.key.static_name(), it.key.span().start);
        walk::walk_accessor_property(self, it);
    }

    // `constructor(private m: T)` declares the member `m` on the class.
    fn visit_formal_parameter(&mut self, it: &FormalParameter<'a>) {
        if it.accessibility.is_some() || it.readonly || it.r#override {
            if let Some(id) = it.pattern.get_binding_identifier() {
                self.declare(Some(std::borrow::Cow::Borrowed(id.name.as_str())), id.span.start);
            }
        }
        walk::walk_formal_parameter(self, it);
    }
}

#[cfg(test)]
#[path = "help_members_tests.rs"]
mod tests;
