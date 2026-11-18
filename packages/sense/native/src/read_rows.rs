//! The rows of one module's read that name another module or a name it hands
//! out: its requests and the bindings each takes, and its exports.

use serde::Serialize;

use crate::harvest::TextSpan;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Imports = 0,
    Reexports,
    Dynamic,
    Type,
    Depends,
    /// What a stylesheet names: a file it pulls in, not a module it imports.
    Asset,
}

impl Kind {
    pub const ALL: [Kind; 6] = [Kind::Imports, Kind::Reexports, Kind::Dynamic, Kind::Type, Kind::Depends, Kind::Asset];
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
            Self::Asset => "asset",
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
    /// A tree-sitter reader's guess, recorded only where it lands: `guessed` in `read.ts`.
    #[serde(skip_serializing_if = "is_false")]
    pub(crate) guessed: bool,
    /// A Rust path asked for as an item past its modules: `item` in `read.ts`.
    #[serde(skip_serializing_if = "is_false")]
    pub(crate) item: bool,
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
    /// The line it is written on, up to its line break and less one `\r`
    /// before that, as a reader prints where a name is passed on.
    #[serde(rename = "lineText", skip_serializing_if = "Option::is_none")]
    pub(crate) line_text: Option<String>,
}

pub(crate) fn is_false(value: &bool) -> bool {
    !*value
}

pub(crate) fn is_zero(value: &u8) -> bool {
    *value == 0
}
