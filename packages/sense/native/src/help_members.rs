//! Where a member of an interface, a type literal or a class is declared.
//!
//! A member is never imported, so the import graph names nobody who declares
//! or uses one. Its declarations are a fact of the parse: a property or method
//! signature, a class method, property or accessor, or a constructor parameter
//! property, each on the interface, type alias or class that holds it. The
//! scan records every one with the file's parse (`read.rs`), and a question
//! reads them off the chain the index wrote.
//!
//! A declaration on a named container is answered with its uses as well: the
//! lines that read, write or destructure the member through a value whose
//! type the line writes as that container (`help_member_uses.rs`). The name
//! the line writes is joined to the declaration the way an import is, in the
//! declaring file under its own name and in every file that imports it,
//! through each `export … from` that passes it on, under the name the import
//! binds; so `Props.size` and `Other.size` are told apart, and a same-named
//! type of another file is neither. A container that carries the declaring
//! one — an interface that extends it, an alias that intersects it, a class
//! that implements it, a component that takes it as props, `memo` or
//! `forwardRef` of such a component, a class component of it, `Pick` of it
//! that keeps the member — is joined the same way, so `wide.size` through
//! `Wide extends Props` and `<Button size />` through `Button: FC<Props>` are
//! uses of `Props.size`. A container with no name has no uses.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use napi_derive::napi;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;
use serde::Serialize;

use crate::compact::Layer;
use crate::help_usage::{importers_from, kind_of};
use crate::orient_map_read::beside;
use crate::package_graph::{fold, join_parses, At, Crossing};
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

/// What a member on a container with no name is said to be on.
const A_TYPE_LITERAL: &str = "a type literal";
const A_CLASS: &str = "a class";

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
    /// Every use of the member through a value whose type is written as its
    /// container, ordered by file in code units, then by line; absent for a
    /// container with no name, which no line can write.
    pub uses: Option<Vec<MemberUseSite>>,
}

/// One line that uses a member, `how`: `read`, `write` or `destructure`.
#[napi(object)]
#[derive(Clone)]
pub struct MemberUseSite {
    pub at: String,
    pub line: u32,
    /// The package of the file, or empty when no package holds it.
    pub by: String,
    /// `story`, `test` or `source`, by the file's name.
    pub kind: String,
    pub how: String,
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
                uses: None,
            })
            .collect();
        sites.sort_by_key(|site| site.line);
        found.extend(sites);
    }
    used(root, layers, name, &mut found);
    found
}

/// Where each origin is written: by file, by the name the file writes it as.
type Written = HashMap<String, HashMap<String, HashSet<usize>>>;

fn write(into: &mut Written, file: &str, name: &str, origin: usize) -> bool {
    into.entry(file.to_owned()).or_default().entry(name.to_owned()).or_default().insert(origin)
}

/// Each declaration of `name` on a named container given its uses: the
/// member-use rows of member `name` whose type is written as the container, or
/// as a container that carries it, in the file that declares that one, or as
/// the name an import of it binds, in a file that imports it.
///
/// The names are reached as a closure: each name reached is followed through
/// its imports, and each container a reached file declares carrying a reached
/// name (`interface Wide extends Props`, a component taking `Props`) is reached
/// in turn, until a round reaches nothing new. A carry over `Pick` or `Omit`
/// reaches the container only when it keeps `name`.
fn used(root: &str, layers: &[Layer], name: &str, found: &mut [MemberSite]) {
    // One origin per declaring file and container, which several declarations can share.
    let mut origins: Vec<(String, String)> = Vec::new();
    let mut of: Vec<Option<usize>> = Vec::new();
    for site in found.iter() {
        if site.on == A_TYPE_LITERAL || site.on == A_CLASS { of.push(None); continue; }
        let origin = origins.iter().position(|(at, on)| *at == site.at && *on == site.on).unwrap_or_else(|| {
            origins.push((site.at.clone(), site.on.clone()));
            origins.len() - 1
        });
        of.push(Some(origin));
    }
    if origins.is_empty() { return; }
    let folded = fold(layers);
    let mut parses: HashMap<String, Option<(usize, usize)>> = HashMap::new();
    let mut written = Written::new();
    let mut frontier = Written::new();
    for (origin, (at, on)) in origins.iter().enumerate() {
        write(&mut written, at, on, origin);
        write(&mut frontier, at, on, origin);
    }
    while !frontier.is_empty() {
        let mut reached = frontier.clone();
        let (taken, _) = importers_from(root, layers, frontier);
        for one in taken {
            // A name read off a namespace is `ns.Props`, which no member-use row writes.
            if one.taken.through.is_some() || one.local.is_empty() { continue; }
            if write(&mut written, &one.taken.at, &one.local, one.origin) { write(&mut reached, &one.taken.at, &one.local, one.origin); }
        }
        let unread: Vec<&str> = reached.keys().filter(|file| !parses.contains_key(*file)).map(String::as_str).collect();
        parses.extend(parses_of(layers, &folded, &unread));
        frontier = Written::new();
        for (file, names) in &reached {
            let Some(Some((layer, row))) = parses.get(file).copied() else { continue };
            let (stored, columns) = (&layers[layer].stored, &layers[layer].parses);
            for at in columns.carries.range(row) {
                let Some(carried) = names.get(stored.text(columns.carry_of.at(at))) else { continue };
                // A carry over `Pick` or `Omit` holds only some members, and `name` may not be one.
                let (only, except) = (columns.carry_only.range(at), columns.carry_except.range(at));
                if !only.is_empty() && !only.into_iter().any(|key| stored.text(columns.carry_only_name.at(key)) == name) { continue; }
                if except.into_iter().any(|key| stored.text(columns.carry_except_name.at(key)) == name) { continue; }
                let on = stored.text(columns.carry_on.at(at));
                for &origin in carried {
                    if write(&mut written, file, on, origin) { write(&mut frontier, file, on, origin); }
                }
            }
        }
    }
    let files: Vec<&str> = written.keys().filter(|file| !parses.contains_key(*file)).map(String::as_str).collect();
    parses.extend(parses_of(layers, &folded, &files));
    let mut files: Vec<&str> = written.keys().map(String::as_str).collect();
    files.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    let paths = beside(root, files.iter().copied());
    let owners = owners(root, &paths);
    let mut uses: Vec<Vec<MemberUseSite>> = vec![Vec::new(); origins.len()];
    for file in files {
        let (Some(Some((layer, row))), Some(names)) = (parses.get(file).copied(), written.get(file)) else { continue };
        let (stored, parses) = (&layers[layer].stored, &layers[layer].parses);
        for at in parses.member_uses.range(row) {
            if stored.text(parses.member_use_name.at(at)) != name { continue; }
            let Some(origins) = names.get(stored.text(parses.member_use_of.at(at))) else { continue };
            for &origin in origins {
                uses[origin].push(MemberUseSite {
                    at: file.to_owned(),
                    line: parses.member_use_line.at(at),
                    by: owners.package_of(file).to_owned(),
                    kind: kind_of(file).to_owned(),
                    how: stored.text(parses.member_use_how.at(at)).to_owned(),
                });
            }
        }
    }
    for list in &mut uses {
        list.sort_by(|a, b| crate::order::code_unit(&a.at, &b.at).then(a.line.cmp(&b.line)).then(a.how.cmp(&b.how)));
        list.dedup_by(|a, b| a.at == b.at && a.line == b.line && a.how == b.how);
    }
    for (site, origin) in found.iter_mut().zip(of) {
        if let Some(origin) = origin { site.uses = Some(uses[origin].clone()); }
    }
}

/// The newest parse of each of `files` on the chain, as `(layer, row)`; absent
/// for a file the chain holds no parse of.
fn parses_of(layers: &[Layer], folded: &HashMap<&str, At>, files: &[&str]) -> Vec<(String, Option<(usize, usize)>)> {
    let mut crossings: Vec<Crossing> = files
        .iter()
        .filter_map(|file| folded.get_key_value(file))
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    join_parses(layers, &mut crossings);
    crossings.into_iter().map(|crossing| (crossing.file.to_owned(), crossing.parse)).collect()
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
        let container = self.alias.take().unwrap_or_else(|| A_TYPE_LITERAL.to_owned());
        self.within(container, |walker| walk::walk_ts_type_literal(walker, it));
    }

    fn visit_class(&mut self, it: &Class<'a>) {
        let container = it.id.as_ref().map_or_else(|| A_CLASS.to_owned(), |id| id.name.to_string());
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
