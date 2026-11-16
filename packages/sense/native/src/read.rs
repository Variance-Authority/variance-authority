//! One module's cacheable facts, extracted without letting its AST cross N-API.

use oxc_allocator::Allocator;
use oxc_ast::ast::Program;
use serde::Serialize;

use crate::declarations::declarations;
use crate::harvest::{SourceSymbol, TextSpan};
use crate::help_member_uses::{member_uses_in, MemberUse};
use crate::help_own_uses::{own_uses_in, OwnUse};
use crate::help_members::{member_declarations_in, MemberDeclaration};
use crate::members::{BindingMember, Member};
use crate::mocks::{mocks_in, Mocks};
use crate::source_size::{size_of, Size};

pub use crate::read_rows::{Binding, Export, Kind, Request};
pub(crate) use crate::module_syntax::Lines;
use crate::read_rows::{is_false};

#[derive(Clone, Debug, Default, Serialize)]
pub struct Read {
    pub requests: Vec<Request>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) exports: Vec<Export>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) symbols: Vec<SourceSymbol>,
    /// Every function a function's body declares, apart from the top level.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) nested: Vec<crate::harvest::NestedSymbol>,
    #[serde(skip_serializing_if = "is_false")]
    pub(crate) harvested: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) declares: Vec<String>,
    #[serde(skip_serializing_if = "Mocks::is_empty")]
    pub(crate) mocks: Mocks,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) members: Vec<Member>,
    /// Every name read off a binding a named import takes.
    #[serde(rename = "bindingMembers", skip_serializing_if = "Vec::is_empty")]
    pub(crate) binding_members: Vec<BindingMember>,
    /// Every member of an interface, a type literal or a class the module declares.
    #[serde(rename = "memberDeclarations", skip_serializing_if = "Vec::is_empty")]
    pub(crate) member_declarations: Vec<MemberDeclaration>,
    /// Every use of a member through a value whose type the module writes.
    #[serde(rename = "memberUses", skip_serializing_if = "Vec::is_empty")]
    pub(crate) member_uses: Vec<MemberUse>,
    /// Every line that uses a name the module declares at its top level or binds by an import.
    #[serde(rename = "ownUses", skip_serializing_if = "Vec::is_empty")]
    pub(crate) own_uses: Vec<OwnUse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unknown: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) size: Option<Size>,
    /// The module's own doc comment, inside its marks, as [`crate::harvest::Harvest`] reads it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) doc: Option<TextSpan>,
}

pub use variance_sense_instrument::native::dialect;

/// One module's `Parsed` value, from OXC's native module record.
pub fn read_module(file: &str, source: &str, allocator: &Allocator, symbols: bool) -> Read {
    read_module_and_tree(file, source, allocator, symbols).0
}

/// [`read_module`]'s value and the tree it was read from, for a caller that asks
/// the tree what the module record does not hold, so the file is parsed once.
pub(crate) fn read_module_and_tree<'a>(file: &str, source: &'a str, allocator: &'a Allocator, symbols: bool) -> (Read, Program<'a>) {
    let crate::module_syntax::ModuleSyntax {
        program, scoping, lines, harvest, requests, exports, members,
        binding_members, unknown, source_type, clean,
    } = crate::module_syntax::read(file, source, allocator, symbols);
    let nested = if symbols { harvest.nested(&program, &lines) } else { Vec::new() };
    let size = size_of(source, &program, source_type.is_typescript(), clean);
    let member_declarations = member_declarations_in(&program, &lines, &harvest);
    let read = Read {
        requests,
        exports,
        symbols: harvest.symbols,
        nested,
        harvested: symbols,
        declares: declarations(file, &program),
        mocks: mocks_in(source, &program, &scoping),
        members,
        binding_members,
        member_declarations,
        member_uses: member_uses_in(&program, &scoping, &lines),
        own_uses: own_uses_in(&program, &scoping, &lines),
        unknown,
        size: Some(size),
        doc: harvest.module_doc,
    }.texted(&crate::span_text::Source::new(source, lines.starts()));
    (read, program)
}

#[cfg(test)]
#[path = "read_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "read_objects_tests.rs"]
mod objects_tests;

#[cfg(test)]
#[path = "read_binding_members_tests.rs"]
mod binding_members_tests;

#[cfg(test)]
#[path = "read_passed_tests.rs"]
mod passed_tests;
