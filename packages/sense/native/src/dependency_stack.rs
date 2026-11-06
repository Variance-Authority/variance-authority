//! What a location can already use, asked of the published corpus with no words.
//!
//! One row per package the owning manifest declares or the code imports there,
//! read from the lexicon's rows and nothing else: no source is opened and no
//! installed package is read. A row is `imported` when the index counted a
//! written request for it, `unused` when it counted none, and `unread` when the
//! index was not read at all, which is not the same as none.

// compass: variance-authority.report.agent-surface

use std::collections::BTreeMap;

use napi_derive::napi;
use serde::Serialize;

use super::view::{read, Lexicon};
use super::Skill;

/// Runtime first: it is the answer to *what may I import*; dev and types follow.
fn rank(role: &str) -> u8 {
    match role { "runtime" => 0, "types-only" => 1, _ => 2 }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    package: String,
    manifest: String,
    /// `runtime`, `dev` or `types-only`; a package the code imports without declaring is `runtime`.
    role: &'static str,
    /// `dependency`, `optional`, `peer` or `dev`; absent when the manifest does not declare it.
    #[serde(skip_serializing_if = "Option::is_none")]
    declared_as: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    /// `imported`, `unused`, or `unread` when the index counted no imports for the owner.
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    imports: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    site: Option<String>,
    /// Specifiers of the package the manifest reaches, when more than the bare name.
    specifiers: u32,
    /// The agent skills the package ships, each with its `SKILL.md`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    skills: Vec<Skill>,
}

/// A package whose declaration could not be read; said, never dropped.
#[derive(Serialize)]
struct Unreadable { manifest: String, package: String, reason: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stack {
    /// The manifests that own the paths asked about.
    location: Vec<String>,
    total: u32,
    imported: u32,
    unused: u32,
    unread: u32,
    offset: u32,
    /// Rows after this page.
    remaining: u32,
    rows: Vec<Row>,
    unreadable: Vec<Unreadable>,
    /// Rows, on every page, whose package ships skills.
    skilled: u32,
}

/// Every third-party package usable at `files`, paged in a stable order.
#[napi(catch_unwind)]
pub fn dependency_stack(path: String, sites: String, files: Vec<String>, offset: u32, limit: u32) -> napi::Result<Option<String>> {
    let Some((catalogue, held)) = read(&path, &sites)? else { return Ok(None) };
    let lexicon = Lexicon::open(&catalogue, held.as_deref())?;
    let allowed = lexicon.located(&files);
    let (found, issues) = lexicon.rows(Some(&allowed));
    let mut rows = BTreeMap::<(&str, &str), Row>::new();
    for row in &found {
        let api = lexicon.api(row.entry);
        let version = api.and_then(|api| api.runtime.as_ref().or(api.declarations.as_ref())).map(|identity| identity.version.clone());
        let types_only = api.is_some_and(|api| api.runtime.is_none() && api.declarations.is_some());
        let role = if types_only { "types-only" } else if row.declared_as == Some("dev") { "dev" } else { "runtime" };
        let slot = rows.entry((row.owner, row.package)).or_insert_with(|| Row {
            package: row.package.to_owned(), manifest: row.owner.to_owned(), role, declared_as: row.declared_as.map(str::to_owned),
            version: None, state: "unread", imports: None, site: None, specifiers: 0, skills: Vec::new(),
        });
        if slot.skills.is_empty() { slot.skills = api.and_then(|api| api.skills.clone()).unwrap_or_default(); }
        slot.specifiers += 1;
        slot.version = slot.version.take().or(version);
        if rank(role) < rank(slot.role) { slot.role = role; }
        if let Some(count) = row.imports { slot.imports = Some(slot.imports.unwrap_or(0) + count); }
        if slot.site.is_none() { slot.site = row.site.clone(); }
    }
    let mut rows: Vec<Row> = rows.into_values().collect();
    for row in &mut rows {
        row.state = match row.imports { None => "unread", Some(0) => "unused", Some(_) => "imported" };
    }
    let state_rank = |state: &str| match state { "imported" => 0, "unused" => 1, _ => 2 };
    rows.sort_by(|a, b| state_rank(a.state).cmp(&state_rank(b.state))
        .then_with(|| rank(a.role).cmp(&rank(b.role)))
        .then_with(|| (&a.package, &a.manifest).cmp(&(&b.package, &b.manifest))));
    let count = |state: &str| rows.iter().filter(|row| row.state == state).count() as u32;
    let (imported, unused, unread, total) = (count("imported"), count("unused"), count("unread"), rows.len() as u32);
    let skilled = rows.iter().filter(|row| !row.skills.is_empty()).count() as u32;
    let start = (offset as usize).min(rows.len());
    let page: Vec<Row> = rows.into_iter().skip(start).take(limit as usize).collect();
    let mut location: Vec<String> = allowed.iter().map(|manifest| (*manifest).to_owned()).collect();
    location.sort_unstable();
    let mut unreadable: Vec<Unreadable> = issues.iter()
        .map(|issue| Unreadable { manifest: issue.owner.to_owned(), package: issue.package.to_owned(), reason: issue.reason.to_owned() }).collect();
    unreadable.sort_by(|a, b| (&a.manifest, &a.package).cmp(&(&b.manifest, &b.package)));
    let answer = Stack { location, total, imported, unused, unread, offset: start as u32,
        remaining: total - (start as u32 + page.len() as u32), rows: page, unreadable, skilled };
    serde_json::to_string(&answer).map(Some).map_err(|error| napi::Error::from_reason(error.to_string()))
}
