//! A file's record, settled where its read and its targets are: the one rule
//! every batch, walk and warm update builds a record by.
//!
//! Each read and each target is already on this side, so the record is built
//! here and crosses whole (`records` on a batch) rather than as columns that
//! JavaScript assembles a second time. A record built here is published into
//! the same index a cached one is read from, and the two are compared byte for
//! byte, so there is one assembly to keep in step with the format, not two.

// compass: variance-authority.reach.source-index

use std::collections::{BTreeSet, HashSet};

use napi_derive::napi;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::acquire::Outcome;
use crate::order::code_unit;
use crate::read::Read;
use crate::batch::Reached;
use crate::read_any::{language_of, Language};
use crate::specifier::{is_relative_in, kind_for, package_of, request_of};
use crate::witness::witnesses_of;

/// `FileEdge` and `PackageEdge` in `core/relate`: one target and how it is reached.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Edge {
    pub to: String,
    pub kind: String,
}

/// `FileRecord` in `core/relate`, with its fields in the order JavaScript
/// writes them, so `records()` parses to objects that print the same.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileRecord {
    pub file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edges: Option<Vec<Edge>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub packages: Option<Vec<Edge>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declares: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unresolved: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unknown: Option<String>,
}

/// `IndexedRecord` in `source-index-format.ts`. A target JavaScript held as
/// `undefined` crosses as `null` and comes back as `None`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Indexed {
    pub record: FileRecord,
    pub witnesses: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub targets: Option<Vec<Option<String>>>,
}

/// What a record is settled against that is not in the file: the runtime's
/// builtins, which extensions are code, and — when the caller keeps records
/// for reuse — the directories a witness is checked against.
pub struct Settling<'a> {
    pub builtins: &'a HashSet<String>,
    pub code: &'a HashSet<String>,
    pub remembering: bool,
    pub directories: &'a HashSet<String>,
}

/// What JavaScript says a batch's records are settled against: `Settling`, as
/// lists, and the digest each asked file is named by where the caller knows a
/// better one than the read's (empty where it does not).
#[napi(object)]
pub struct RecordOptions {
    pub remembering: bool,
    /// `builtinModules` that `isBuiltin` accepts: never a package edge.
    pub builtins: Vec<String>,
    /// Extensions whose target keeps its request's kind.
    pub code_extensions: Vec<String>,
    /// Every directory of the tree shape a witness is checked against.
    pub directories: Vec<String>,
    pub identities: Option<Vec<String>>,
}

/// The sets a [`Settling`] borrows, owned.
pub struct Settled {
    builtins: HashSet<String>,
    code: HashSet<String>,
    remembering: bool,
    directories: HashSet<String>,
}

impl Settled {
    /// The lists as sets.
    pub fn of(remembering: bool, builtins: Vec<String>, code: Vec<String>, directories: Vec<String>) -> Self {
        Self {
            builtins: builtins.into_iter().collect(),
            code: code.into_iter().collect(),
            remembering,
            directories: directories.into_iter().collect(),
        }
    }

    pub fn settling(&self) -> Settling<'_> {
        Settling {
            builtins: &self.builtins,
            code: &self.code,
            remembering: self.remembering,
            directories: &self.directories,
        }
    }
}

/// Every row's record as a JSON `IndexedRecord[]`, in row order: what crosses
/// N-API for JavaScript to decode, rather than columns for it to assemble.
pub fn records_json(files: &[String], identity: &(dyn Fn(usize) -> String + Sync), read: &[crate::acquire::Answer], reached: &[Reached], settling: &Settling) -> String {
    let empty = Reached::default();
    let records: Vec<Indexed> = files
        .par_iter()
        .enumerate()
        .map(|(row, file)| {
            let (held, _, outcome) = &read[row];
            built(file, &identity(row), held, *outcome, reached.get(row).unwrap_or(&empty), settling)
        })
        .collect();
    serde_json::to_string(&records).unwrap_or_default()
}

/// One walked row's record. `identity` is the digest the walk named the row
/// by — Git's object name when the tree holds the file, the read digest when it
/// does not, empty when neither — and `targets` is one entry per request,
/// empty where the request resolved to nothing.
pub fn built(file: &str, identity: &str, read: &Read, outcome: Outcome, reached: &Reached, settling: &Settling) -> Indexed {
    let unknown = read.unknown.as_deref().filter(|reason| !reason.is_empty());
    if !outcome.parsed() {
        // A file declined by its bytes — over the size the scan opens, or not
        // UTF-8 — names them, so the next update keeps the record rather than
        // opening the file to decline it again. A read that failed names
        // nothing: what failed it may not hold next time, so it is tried again.
        // Nor does a refusal reached through a link (`Outcome` in `acquire.rs`).
        return Indexed {
            record: FileRecord {
                file: file.to_owned(),
                digest: (outcome == Outcome::Declined && !identity.is_empty()).then(|| identity.to_owned()),
                unknown: unknown.map(str::to_owned),
                ..FileRecord::default()
            },
            witnesses: Vec::new(),
            targets: None,
        };
    }
    let mut edges = Vec::new();
    let mut packages = Vec::new();
    let mut unresolved = Vec::new();
    let mut holes = Vec::new();
    let mut held = Vec::with_capacity(read.requests.len());
    let language = language_of(file).unwrap_or(Language::Module);
    let mut more = reached.more.iter().peekable();
    let first = reached.first.iter().map(String::as_str).chain(std::iter::repeat(""));
    for ((index, request), target) in read.requests.iter().enumerate().zip(first) {
        held.push((!target.is_empty()).then(|| target.to_owned()));
        let Some(bare) = request_of(&request.value) else { continue };
        let kind = request.kind.as_str();
        if target.is_empty() {
            // A guess that lands is an edge; one that does not is silence (`Request.guessed` in `read.ts`).
            if request.guessed {
                continue;
            }
            unresolved.push(request.value.as_str());
            if let Some(named) = package_of(bare, settling.builtins) {
                packages.push(Edge { to: named.to_owned(), kind: kind.to_owned() });
            }
            if is_relative_in(language, bare) {
                holes.push(request.value.as_str());
            }
            continue;
        }
        edges.push(Edge { to: target.to_owned(), kind: kind_for(kind, target, settling.code).to_owned() });
        // Every further file the request reaches is an edge too: a Swift target's, a Java package's.
        while let Some((_, to)) = more.next_if(|(at, _)| *at as usize <= index) {
            edges.push(Edge { to: to.clone(), kind: kind_for(kind, to, settling.code).to_owned() });
        }
    }

    let mut reasons: Vec<String> = unknown.map(str::to_owned).into_iter().collect();
    if !holes.is_empty() {
        reasons.push(format!("{} relative specifier(s) that resolve to nothing: {}", holes.len(), holes.join(", ")));
    }
    let settled = dedupe(edges);
    let witnesses = if settling.remembering {
        witnesses_of(
            file,
            read.requests.iter().map(|request| request.value.as_str()),
            settled.iter().map(|edge| edge.to.as_str()),
            settling.directories,
            reached.candidates.iter().map(String::as_str),
        )
    } else {
        Vec::new()
    };
    let unresolved: Vec<String> = {
        let mut unique: Vec<&str> = unresolved.into_iter().collect::<BTreeSet<_>>().into_iter().collect();
        unique.sort_by(|left, right| code_unit(left, right));
        unique.into_iter().map(str::to_owned).collect()
    };
    Indexed {
        record: FileRecord {
            file: file.to_owned(),
            digest: (!identity.is_empty()).then(|| identity.to_owned()),
            edges: (!settled.is_empty()).then_some(settled),
            packages: (!packages.is_empty()).then(|| dedupe(packages)),
            declares: (!read.declares.is_empty()).then(|| read.declares.clone()),
            unresolved: (!unresolved.is_empty()).then_some(unresolved),
            unknown: (!reasons.is_empty()).then(|| format!("{file} — {}", reasons.join("; "))),
        },
        witnesses,
        targets: Some(held),
    }
}

/// The first of each `kind to` pair, sorted by target and then kind, both by
/// code unit — `dedupe` in `native.ts`.
fn dedupe(edges: Vec<Edge>) -> Vec<Edge> {
    let mut seen = HashSet::new();
    let mut kept: Vec<Edge> = edges
        .into_iter()
        .filter(|edge| seen.insert((edge.kind.clone(), edge.to.clone())))
        .collect();
    kept.sort_by(|left, right| code_unit(&left.to, &right.to).then_with(|| code_unit(&left.kind, &right.kind)));
    kept
}

#[cfg(all(test, unix))]
#[path = "record_tests.rs"]
mod tests;
