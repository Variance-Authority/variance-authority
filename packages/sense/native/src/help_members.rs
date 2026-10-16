//! Where a member of an interface, a type literal or a class is declared.
//!
//! A member is never imported, so the import graph names nobody who declares
//! or uses one. Its declarations are a fact of the parse: a property or method
//! signature, a class method, property or accessor, or a constructor parameter
//! property, each on the interface, type alias or class that holds it. The
//! scan records every one with the file's parse (`read.rs`), and a question
//! reads them off the chain the index wrote.

// compass: variance-authority.reach.relations

use std::collections::HashSet;

use napi_derive::napi;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;
use serde::Serialize;

use crate::compact::Layer;
use crate::help_usage::kind_of;
use crate::orient_map_read::beside;
use crate::package_graph::{fold, join_parses, Crossing};
use crate::package_owners::{owners, NO_OWNER};
use crate::read::Lines;

/// One member declaration of a parse: its name, its line, and the container
/// it is `on`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MemberDeclaration {
    pub(crate) name: String,
    pub(crate) line: u32,
    /// The interface, type alias or class the member is on, or how it is
    /// written when it has no name.
    pub(crate) on: String,
}

/// Every member `program` declares, in source order.
pub(crate) fn member_declarations_in(program: &Program<'_>, lines: &Lines) -> Vec<MemberDeclaration> {
    let mut walker = Walker { lines, containers: Vec::new(), alias: None, declared: Vec::new() };
    walker.visit_program(program);
    walker.declared
}

/// One declaration of a member, `on` the container that declares it.
#[napi(object)]
pub struct MemberSite {
    pub at: String,
    pub line: u32,
    /// The package of the file, or empty when no package holds it.
    pub by: String,
    /// `story`, `test` or `source`, by the file's name.
    pub kind: String,
    pub on: String,
}

/// Every declaration of a member named `name` on the chain, ordered by file
/// in code units, then by line. A file whose parse the chain does not hold
/// declares nothing.
pub(crate) fn member_declarations(root: &str, layers: &[Layer], name: &str) -> Vec<MemberSite> {
    // The digests whose parse declares the name somewhere on the chain; the
    // file's newest parse is joined below and asked again.
    let mut declaring: HashSet<&str> = HashSet::new();
    for layer in layers {
        let (stored, parses) = (&layer.stored, &layer.parses);
        for row in 0..parses.key.len() {
            if parses.member_declarations.range(row).any(|at| stored.text(parses.member_declaration_name.at(at)) == name) {
                declaring.insert(stored.text(parses.key.at(row)));
            }
        }
    }
    if declaring.is_empty() { return Vec::new(); }
    let mut crossings: Vec<Crossing> = fold(layers)
        .into_iter()
        .filter(|&(_, (layer, row))| {
            let (stored, records) = (&layers[layer].stored, &layers[layer].records);
            stored.optional(records.digest.at(row)).is_some_and(|digest| declaring.contains(digest))
        })
        .map(|(file, at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let paths = beside(root, crossings.iter().map(|crossing| crossing.file));
    let owners = owners(root, &paths);
    let mut found = Vec::new();
    for crossing in &crossings {
        let Some((layer, row)) = crossing.parse else { continue };
        let (stored, parses) = (&layers[layer].stored, &layers[layer].parses);
        let by = owners.package_of(crossing.file);
        let mut sites: Vec<MemberSite> = parses
            .member_declarations
            .range(row)
            .filter(|&at| stored.text(parses.member_declaration_name.at(at)) == name)
            .map(|at| MemberSite {
                at: crossing.file.to_owned(),
                line: parses.member_declaration_line.at(at),
                by: by.to_owned(),
                kind: kind_of(crossing.file).to_owned(),
                on: stored.text(parses.member_declaration_on.at(at)).to_owned(),
            })
            .collect();
        sites.sort_by_key(|site| site.line);
        found.extend(sites);
    }
    found
}

struct Walker<'n> {
    lines: &'n Lines,
    /// The containers the walk is inside, innermost last.
    containers: Vec<String>,
    /// The type alias whose own body is the type literal visited next.
    alias: Option<String>,
    declared: Vec<MemberDeclaration>,
}

impl Walker<'_> {
    fn declare(&mut self, key: Option<std::borrow::Cow<'_, str>>, at: u32) {
        let Some(key) = key else { return };
        let on = self.containers.last().cloned().unwrap_or_default();
        self.declared.push(MemberDeclaration { name: key.into_owned(), line: self.lines.at(at), on });
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
