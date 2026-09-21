//! What every language reader answers, in the shape the JavaScript side holds.
//!
//! One struct per concept and one order-preserving gathering, because a reader's
//! output is compared against the JavaScript oracle byte for byte: a `HashMap`
//! here would reorder requests and make an acceleration look like a different
//! answer ([`record.ts`](../../src/record.ts) is what consumes this).

use std::collections::HashMap;

use serde::Serialize;

/// What a request is, as a file-level edge.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Imports,
    Reexports,
    Dynamic,
    Type,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Imports => "imports",
            Self::Reexports => "reexports",
            Self::Dynamic => "dynamic",
            Self::Type => "type",
        }
    }
}

impl Serialize for Kind {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

/// The name under which a namespace object is published. `read.ts` names it once.
pub const NAMESPACE_NAME: &str = "*";

#[derive(Clone, Debug, Serialize)]
pub struct Binding {
    pub imported: String,
    pub local: String,
    #[serde(rename = "type")]
    pub type_only: bool,
    pub line: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct Request {
    pub value: String,
    pub kind: Kind,
    pub bindings: Vec<Binding>,
    pub line: u32,
    #[serde(skip_serializing_if = "is_false")]
    pub guessed: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Export {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exported: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imported: Option<String>,
    #[serde(rename = "type")]
    pub type_only: bool,
    pub line: u32,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Read {
    pub requests: Vec<Request>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exports: Option<Vec<Export>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unknown: Option<String>,
}

impl Read {
    /// A file this build could open and not read. Requests unknown, not absent.
    pub fn unreadable(reason: String) -> Self {
        Self {
            requests: Vec::new(),
            exports: None,
            unknown: Some(reason),
        }
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// Requests keyed by their written value, in the order they were first written.
#[derive(Default)]
pub struct Requests {
    at: HashMap<String, usize>,
    held: Vec<Request>,
}

impl Requests {
    /// Record one request, merging into the one already written under this value.
    pub fn want(
        &mut self,
        value: &str,
        kind: Kind,
        line: u32,
        guessed: bool,
        bindings: Vec<Binding>,
    ) {
        if let Some(index) = self.at.get(value) {
            let held = &mut self.held[*index];
            held.bindings.extend(bindings);
            // A value written once and derived once is written: whichever
            // reading gives it the stronger claim wins, in both directions.
            if !guessed {
                held.guessed = false;
            }
            if held.kind == Kind::Type && kind != Kind::Type {
                held.kind = kind;
            }
            if line < held.line {
                held.line = line;
            }
            return;
        }

        self.at.insert(value.to_string(), self.held.len());
        self.held.push(Request {
            value: value.to_string(),
            kind,
            bindings,
            line,
            guessed,
        });
    }

    pub fn into_vec(self) -> Vec<Request> {
        self.held
    }
}

/// Exports keyed by the name they publish, in the order they were first published.
#[derive(Default)]
pub struct Exports {
    at: HashMap<String, usize>,
    held: Vec<Export>,
}

impl Exports {
    /// Publish a name, replacing whatever was published under it before.
    pub fn set(&mut self, name: &str, export: Export) {
        if let Some(index) = self.at.get(name) {
            self.held[*index] = export;
            return;
        }
        self.at.insert(name.to_string(), self.held.len());
        self.held.push(export);
    }

    pub fn get(&self, name: &str) -> Option<&Export> {
        self.at.get(name).map(|index| &self.held[*index])
    }

    pub fn into_vec(self) -> Vec<Export> {
        self.held
    }
}
