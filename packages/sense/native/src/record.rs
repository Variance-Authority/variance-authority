//! A file's record, settled on this side: `builtFromBatch` in `native.ts`, for
//! the rows a cold graph walk read and resolved here.
//!
//! The walk already holds every read and every target, and until now handed
//! all of them to JavaScript so that it could build one object per file, keep
//! it, and hand it back to an encoder. Building the record where its inputs
//! already are is what keeps a cold build's JavaScript heap the size of the
//! files the walk did not reach. The rule is JavaScript's, branch for branch,
//! because a record built here is published into the same index a record
//! built there is, and the two are compared byte for byte.

// compass: variance-authority.reach.source-index

use std::collections::{BTreeSet, HashSet};

use serde::{Deserialize, Serialize};

use crate::order::code_unit;
use crate::read::Read;
use crate::specifier::{is_relative, kind_for, package_of, request_of};
use crate::witness::{witnesses_of, AliasTable};

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
/// for reuse — the directories and aliases a witness is checked against.
pub struct Settling<'a> {
    pub builtins: &'a HashSet<String>,
    pub code: &'a HashSet<String>,
    pub remembering: bool,
    pub directories: &'a HashSet<String>,
    pub aliases: Option<&'a AliasTable>,
}

/// One walked row's record. `identity` is the digest the walk named the row
/// by — Git's object name when the tree holds the file, the read digest when it
/// does not, empty when neither — and `targets` is one entry per request,
/// empty where the request resolved to nothing.
pub fn built(file: &str, identity: &str, read: &Read, parsed: bool, targets: &[String], settling: &Settling) -> Indexed {
    let unknown = read.unknown.as_deref().filter(|reason| !reason.is_empty());
    if !parsed {
        return Indexed {
            record: FileRecord {
                file: file.to_owned(),
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
    for (request, target) in read.requests.iter().zip(targets.iter().map(String::as_str).chain(std::iter::repeat(""))) {
        held.push((!target.is_empty()).then(|| target.to_owned()));
        let Some(bare) = request_of(&request.value) else { continue };
        let kind = request.kind.as_str();
        if target.is_empty() {
            unresolved.push(request.value.as_str());
            if let Some(named) = package_of(bare, settling.builtins) {
                packages.push(Edge { to: named.to_owned(), kind: kind.to_owned() });
            }
            if is_relative(bare) {
                holes.push(request.value.as_str());
            }
            continue;
        }
        edges.push(Edge { to: target.to_owned(), kind: kind_for(kind, target, settling.code).to_owned() });
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
            settling.aliases,
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
