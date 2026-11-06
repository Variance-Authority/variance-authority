//! What reading a module answers, and the shape it crosses the boundary in.

use serde::Serialize;

use crate::harvest::{SourceSymbol, TextSpan};
use crate::help_member_uses::MemberUse;
use crate::help_own_uses::OwnUse;
use crate::help_members::MemberDeclaration;
use crate::members::{BindingMember, Member};
use crate::mocks::Mocks;
use crate::source_size::Size;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Imports = 0,
    Reexports,
    Dynamic,
    Type,
    Depends,
}

impl Kind {
    pub const ALL: [Kind; 5] = [Kind::Imports, Kind::Reexports, Kind::Dynamic, Kind::Type, Kind::Depends];
    pub fn code(self) -> u8 {
        self as u8
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Imports => "imports",
            Self::Reexports => "reexports",
            Self::Dynamic => "dynamic",
            Self::Type => "type",
            Self::Depends => "depends",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Binding {
    pub(crate) imported: String,
    pub(crate) local: String,
    #[serde(rename = "type")]
    pub(crate) type_only: bool,
    pub(crate) line: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct Request {
    pub value: String,
    pub kind: Kind,
    pub(crate) bindings: Vec<Binding>,
    pub(crate) line: u32,
    /// An `export … from` group: what it binds it passes on, and takes for no
    /// use of its own. Every `reexports` request is one, and a `type` one is
    /// when `export type` writes it, which its kind alone cannot tell from
    /// `import type`.
    #[serde(skip_serializing_if = "is_false")]
    pub(crate) republishes: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct Export {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) exported: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) local: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) imported: Option<String>,
    #[serde(rename = "type")]
    pub(crate) type_only: bool,
    pub(crate) line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) signature: Option<TextSpan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) doc: Option<TextSpan>,
    /// The role tags its doc declares, as `declared_role` bits.
    #[serde(rename = "roles", skip_serializing_if = "is_zero", serialize_with = "crate::declared_role::serialize")]
    pub(crate) tags: u8,
    /// A key of the object `export =` or `module.exports =` hands out.
    #[serde(skip_serializing_if = "is_false")]
    pub(crate) assigned: bool,
}

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
    /// The module's own doc comment, inside its marks, as [`Harvest`] reads it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) doc: Option<TextSpan>,
}

pub(crate) struct Lines(Vec<usize>);

impl Lines {
    pub(crate) fn new(source: &str) -> Self {
        let mut starts = vec![0];
        starts.extend(source.match_indices('\n').map(|(at, _)| at + 1));
        Self(starts)
    }

    pub(crate) fn at(&self, offset: u32) -> u32 {
        self.0.partition_point(|start| *start <= offset as usize) as u32
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn is_zero(value: &u8) -> bool {
    *value == 0
}
