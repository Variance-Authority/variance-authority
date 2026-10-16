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
//! type of another file is neither. A Rust glob binds every item of its
//! module, a bound module is written before the container, `shapes::Props`,
//! and a struct field whose type is the container reaches it through the
//! field, `Outer.inner`, in every file that writes the field's struct. A
//! container with no name has no uses.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use napi_derive::napi;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;
use serde::Serialize;

use crate::compact::Layer;
use crate::help_bulk_bindings::MODULE;
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
    /// A Rust enum's variant, which a path `Enum::Variant` names, where a
    /// field is reached by `.` or named in a struct literal or pattern.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub(crate) variant: bool,
    /// The type a Rust struct's field is annotated with, as the file writes
    /// it, which a field read through the field, `o.inner.size`, is a use
    /// of; absent where no annotation names one, and for every other member.
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub(crate) r#type: Option<String>,
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
    pub name: String,
    pub at: String,
    pub line: u32,
    /// The package of the file, or empty when no package holds it.
    pub by: String,
    /// `story`, `test` or `source`, by the file's name.
    pub kind: String,
    pub on: String,
    /// A Rust enum's variant, which only a path `Enum::Variant` uses.
    pub variant: bool,
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
    let mut found = declared_members(root, layers, |held| held == name, None);
    used(root, layers, name, &mut found);
    found
}

/// Every declaration of a member whose lowercased name holds `query`, which
/// the caller lowercased, in `files` when they are named, ordered by file in
/// code units, then by line; without its uses, which a search does not list.
pub(crate) fn member_declarations_containing(root: &str, layers: &[Layer], query: &str, files: Option<&[String]>) -> Vec<MemberSite> {
    declared_members(root, layers, |held| held.to_lowercase().contains(query), files)
}

/// Every declaration of a member whose name `matches`, in `files` when they
/// are named, ordered by file in code units, then by line.
fn declared_members(root: &str, layers: &[Layer], matches: impl Fn(&str) -> bool, files: Option<&[String]>) -> Vec<MemberSite> {
    let wanted: Option<HashSet<&str>> = files.map(|files| files.iter().map(String::as_str).collect());
    // The digests whose parse declares the name somewhere on the chain; the
    // file's newest parse is joined below and asked again.
    let mut declaring: HashSet<&str> = HashSet::new();
    for layer in layers {
        let (stored, parses) = (&layer.stored, &layer.parses);
        for row in 0..parses.key.len() {
            if parses.member_declarations.range(row).any(|at| matches(stored.text(parses.member_declaration_name.at(at)))) {
                declaring.insert(stored.text(parses.key.at(row)));
            }
        }
    }
    if declaring.is_empty() { return Vec::new(); }
    let mut crossings: Vec<Crossing> = fold(layers)
        .into_iter()
        .filter(|&(file, _)| wanted.as_ref().is_none_or(|wanted| wanted.contains(file)))
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
            .filter(|&at| matches(stored.text(parses.member_declaration_name.at(at))))
            .map(|at| MemberSite {
                name: stored.text(parses.member_declaration_name.at(at)).to_owned(),
                at: crossing.file.to_owned(),
                line: parses.member_declaration_line.at(at),
                by: by.to_owned(),
                kind: kind_of(crossing.file).to_owned(),
                on: stored.text(parses.member_declaration_on.at(at)).to_owned(),
                variant: parses.member_declaration_variant[at] == 1,
                uses: None,
            })
            .collect();
        sites.sort_by_key(|site| site.line);
        found.extend(sites);
    }
    found
}

/// Each declaration of `name` on a named container given its uses: the
/// member-use rows of member `name` whose type is written as the container, in
/// the declaring file, or as the name an import of it binds, in a file that
/// imports it.
fn used(root: &str, layers: &[Layer], name: &str, found: &mut [MemberSite]) {
    // One origin per declaring file, container and kind, which several
    // declarations can share. A field and a variant of one name on one
    // container are two origins: Rust has no type that holds both.
    let mut origins: Vec<(String, String, bool)> = Vec::new();
    let mut of: Vec<Option<usize>> = Vec::new();
    for site in found.iter() {
        if site.on == A_TYPE_LITERAL || site.on == A_CLASS { of.push(None); continue; }
        let origin = origins.iter().position(|(at, on, variant)| *at == site.at && *on == site.on && *variant == site.variant).unwrap_or_else(|| {
            origins.push((site.at.clone(), site.on.clone(), site.variant));
            origins.len() - 1
        });
        of.push(Some(origin));
    }
    if origins.is_empty() { return; }
    let folded = fold(layers);
    let written = written(root, layers, &folded, name, &origins);
    let mut crossings: Vec<Crossing> = folded
        .into_iter()
        .filter(|(file, _)| written.contains_key(*file))
        .map(|(file, at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let paths = beside(root, crossings.iter().map(|crossing| crossing.file));
    let owners = owners(root, &paths);
    let mut uses: Vec<Vec<MemberUseSite>> = vec![Vec::new(); origins.len()];
    for crossing in &crossings {
        let (Some((layer, row)), Some(names)) = (crossing.parse, written.get(crossing.file)) else { continue };
        let (stored, parses) = (&layers[layer].stored, &layers[layer].parses);
        for at in parses.member_uses.range(row) {
            if stored.text(parses.member_use_name.at(at)) != name { continue; }
            let Some(names) = names.get(stored.text(parses.member_use_of.at(at))) else { continue };
            // A path names a variant, `.` and a literal a field: `Props::size`
            // is an associated function where `Props` has a field `size`.
            let variant = parses.member_use_variant[at] == 1;
            for &origin in names.iter().filter(|&&origin| origins[origin].2 == variant) {
                uses[origin].push(MemberUseSite {
                    at: crossing.file.to_owned(),
                    line: parses.member_use_line.at(at),
                    by: owners.package_of(crossing.file).to_owned(),
                    kind: kind_of(crossing.file).to_owned(),
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

/// A container as the name a file binds and what is written after it:
/// `Shape::Square` is `Shape` and `::Square`, `Props` is itself and nothing.
fn split(on: &str) -> (&str, &str) {
    on.find("::").map_or((on, ""), |at| on.split_at(at))
}

/// A container reached in `file` as `container`, which an import binds and
/// renames, with `suffix` written after it as declared: an origin's own
/// variant, `::Square`, or the fields a chain reads through, `.inner`.
struct Reached {
    file: String,
    container: String,
    suffix: String,
    origins: HashSet<usize>,
}

/// Where each origin is written, by file and by the whole `of` a member-use
/// row writes for it. In the declaring file it is the container as declared;
/// in a file that imports the container, the name the import binds; in one
/// that binds its module, `module::Container`; in one that globs its module,
/// the container itself. A struct field whose type is one of these is a
/// container reached in turn: `inner: Props` on `Outer` makes `Outer.inner`
/// a writing of `Props`, followed as far as the deepest chain a row writes.
fn written(root: &str, layers: &[Layer], folded: &HashMap<&str, At>, name: &str, origins: &[(String, String, bool)]) -> HashMap<String, HashMap<String, HashSet<usize>>> {
    let mut reached: Vec<Reached> = origins
        .iter()
        .enumerate()
        .map(|(origin, (at, on, _))| {
            let (container, suffix) = split(on);
            Reached { file: at.clone(), container: container.to_owned(), suffix: suffix.to_owned(), origins: HashSet::from([origin]) }
        })
        .collect();
    let mut known: HashMap<(String, String, String), usize> =
        reached.iter().enumerate().map(|(at, one)| ((one.file.clone(), one.container.clone(), one.suffix.clone()), at)).collect();
    let mut fresh: Vec<usize> = (0..reached.len()).collect();
    let mut written: HashMap<String, HashMap<String, HashSet<usize>>> = HashMap::new();
    let deepest = deepest(layers, name);
    for round in 0.. {
        let mut added: HashSet<(String, String)> = HashSet::new();
        let mut add = |file: &str, key: String, origins: &HashSet<usize>| {
            let held = written.entry(file.to_owned()).or_default().entry(key.clone()).or_default();
            let before = held.len();
            held.extend(origins);
            if held.len() > before { added.insert((file.to_owned(), key)); }
        };
        let mut wanted: HashMap<String, HashMap<String, HashSet<usize>>> = HashMap::new();
        for &at in &fresh {
            let one = &reached[at];
            add(&one.file, format!("{}{}", one.container, one.suffix), &one.origins);
            let names = wanted.entry(one.file.clone()).or_default();
            names.entry(one.container.clone()).or_default().insert(at);
            if one.file.ends_with(".rs") { names.entry(MODULE.to_owned()).or_default().insert(at); }
        }
        let (taken, _) = importers_from(root, layers, wanted);
        for one in taken {
            // A name read off a namespace is `ns.Props`, which no member-use row writes.
            if one.taken.through.is_some() || one.local.is_empty() { continue; }
            let at = &reached[one.origin];
            let key = if one.taken.name == MODULE { format!("{}::{}{}", one.local, at.container, at.suffix) } else { format!("{}{}", one.local, at.suffix) };
            add(&one.taken.at, key, &at.origins);
        }
        if round == deepest || added.is_empty() { break; }
        fresh = Vec::new();
        for (file, on, suffix, origins) in through_fields(layers, folded, &added, &written, origins) {
            let key = (file.clone(), on.clone(), suffix.clone());
            let at = *known.entry(key).or_insert_with(|| {
                reached.push(Reached { file, container: on, suffix, origins: HashSet::new() });
                reached.len() - 1
            });
            let before = reached[at].origins.len();
            reached[at].origins.extend(origins);
            if reached[at].origins.len() > before && !fresh.contains(&at) { fresh.push(at); }
        }
        if fresh.is_empty() { break; }
    }
    written
}

/// The most fields any member-use row of `name` reads through, `o.a.b.name`
/// being two: how far a field's type is worth following.
fn deepest(layers: &[Layer], name: &str) -> usize {
    let mut deepest = 0;
    for layer in layers {
        let (stored, parses) = (&layer.stored, &layer.parses);
        for at in 0..parses.member_use_name.len() {
            if stored.text(parses.member_use_name.at(at)) != name { continue; }
            deepest = deepest.max(stored.text(parses.member_use_of.at(at)).matches('.').count());
        }
    }
    deepest
}

/// Each struct field, in a file a writing was `added` to, whose type is
/// written as that writing's container: the field's struct is reached with
/// the field before what followed. Only a field leads on, never a variant.
fn through_fields(
    layers: &[Layer],
    folded: &HashMap<&str, At>,
    added: &HashSet<(String, String)>,
    written: &HashMap<String, HashMap<String, HashSet<usize>>>,
    origins: &[(String, String, bool)],
) -> Vec<(String, String, String, HashSet<usize>)> {
    let files: HashSet<&str> = added.iter().map(|(file, _)| file.as_str()).collect();
    let mut crossings: Vec<Crossing> = files
        .iter()
        .filter_map(|file| folded.get_key_value(file).map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None }))
        .collect();
    crossings.sort_unstable_by(|a, b| crate::order::code_unit(a.file, b.file));
    join_parses(layers, &mut crossings);
    let mut found = Vec::new();
    for crossing in &crossings {
        let Some((layer, row)) = crossing.parse else { continue };
        let (stored, parses) = (&layers[layer].stored, &layers[layer].parses);
        for (file, key) in added.iter().filter(|(file, _)| file == crossing.file) {
            let fields: HashSet<usize> = written[file][key].iter().copied().filter(|&origin| !origins[origin].2).collect();
            if fields.is_empty() { continue; }
            let (head, rest) = key.find('.').map_or((key.as_str(), ""), |at| key.split_at(at));
            for at in parses.member_declarations.range(row) {
                if stored.optional(parses.member_declaration_type.at(at)) != Some(head) { continue; }
                // An inline module's `a::Outer` is reached as `a`, as a variant's container is.
                let (on, inside) = split(stored.text(parses.member_declaration_on.at(at)));
                let suffix = format!("{inside}.{}{}", stored.text(parses.member_declaration_name.at(at)), rest);
                found.push((file.clone(), on.to_owned(), suffix, fields.clone()));
            }
        }
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
        self.declared.push(MemberDeclaration { name: key.into_owned(), line: self.lines.at(at), on, variant: false, r#type: None });
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
