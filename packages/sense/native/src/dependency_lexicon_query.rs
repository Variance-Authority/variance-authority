//! Bounded questions over the separately published dependency corpus.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use napi_derive::napi;
use serde::Serialize;

use super::describing::{described, Described};
use super::view::{read, Lexicon, Row};
use super::{Api, Readme};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Match {
    source: &'static str,
    name: String,
    specifier: String,
    kind: String,
    package: String,
    /// The manifest that declares it, or the one it was imported under.
    manifest: String,
    /// The installed package's own manifest: which copy of it answered.
    #[serde(skip_serializing_if = "Option::is_none")]
    installed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    declared_as: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    imports: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    site: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
    imported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    doc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    declaration_provider: Option<String>,
}

/// A package the workspace can resolve that publishes no names to match against, and what it ships instead.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Silent {
    package: String,
    specifier: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    /// The installed package's own manifest: which copy of it is silent.
    #[serde(skip_serializing_if = "Option::is_none")]
    installed: Option<String>,
    reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    readme: Option<Readme>,
    imported: bool,
}

/// `silent` is asked for by an exact name only: a search over words has no name to be silent about.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Matches {
    total: u32, shown: Vec<Match>, silent: Vec<Silent>, scope: Scope,
    /// Packages whose own words describe the question, asked for by words rather than one name.
    #[serde(skip_serializing_if = "Option::is_none")]
    described: Option<Vec<Described>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    described_total: Option<u32>,
    /// Why no package was asked to describe the question, when the catalogue cannot answer it.
    #[serde(skip_serializing_if = "Option::is_none")]
    described_unread: Option<String>,
}

/// What the question searched, so an empty answer says how much it looked at.
#[derive(Serialize)]
struct Scope {
    /// Manifests whose declared and imported dependencies were searched, by path.
    owners: Vec<String>,
    /// Distinct packages those manifests offered to the question.
    packages: u32,
    /// The manifests that own the paths the question stood at; absent when it stood nowhere.
    #[serde(skip_serializing_if = "Option::is_none")]
    location: Option<Vec<String>>,
}

fn summary(doc: &str) -> String {
    let paragraph = doc.split("\n\n").next().unwrap_or(doc).split_whitespace().collect::<Vec<_>>().join(" ");
    paragraph.chars().take(180).collect()
}

fn matches(api: &Api, row: &Row, query: &str, exact: bool) -> Vec<Match> {
    api.names.as_deref().unwrap_or(&[]).iter().filter(|name| {
        if exact { name.name == query } else {
            [row.package, row.specifier, name.name.as_str(), name.doc.as_deref().unwrap_or("")]
                .iter().any(|field| field.to_lowercase().contains(query))
        }
    }).map(|name| Match {
        source: "third-party", name: name.name.clone(), specifier: row.specifier.to_owned(),
        kind: name.kind.clone(), package: row.package.to_owned(), manifest: row.owner.to_owned(),
        installed: api.runtime.as_ref().or(api.declarations.as_ref()).map(|identity| identity.manifest.clone()),
        declared_as: row.declared_as.map(str::to_owned), imports: row.imports, site: row.site.clone(),
        version: api.runtime.as_ref().or(api.declarations.as_ref()).map(|identity| identity.version.clone()),
        summary: name.doc.as_deref().map(summary), imported: row.imported == Some(true),
        at: exact.then(|| name.at.clone()), line: exact.then_some(name.line),
        signature: if exact { name.signature.clone() } else { None },
        doc: if exact { name.doc.clone() } else { None },
        declaration_provider: if exact { api.declarations.as_ref().filter(|declarations|
            Some(declarations.name.as_str()) != api.runtime.as_ref().map(|runtime| runtime.name.as_str()))
            .map(|declarations| format!("{}@{}", declarations.name, declarations.version)) } else { None },
    }).collect()
}

/// Read the corpus and return only matching names, counted before the cap.
/// `files=None` asks the whole checkout; an empty vector asks an empty area.
#[napi(catch_unwind)]
pub fn query_dependency_lexicon(path: String, sites: String, query: String, files: Option<Vec<String>>,
    exact: bool, package: Option<String>, limit: u32) -> napi::Result<Option<String>> {
    let Some((catalogue, held)) = read(&path, &sites)? else { return Ok(None) };
    let lexicon = Lexicon::open(&catalogue, held.as_deref())?;
    let allowed = files.as_ref().map(|files| lexicon.located(files));
    let (rows, _) = lexicon.rows(allowed.as_ref());
    let query = if exact { query } else { query.to_lowercase() };
    let mut found = BTreeMap::<(&str, String, String, String), Match>::new();
    let mut searched = HashMap::<(u32, &str), Vec<Match>>::new();
    let mut silent = BTreeMap::<(&str, &str), Silent>::new();
    let mut looked = (BTreeSet::<&str>::new(), BTreeSet::<&str>::new());
    let mut read = Vec::new();
    for row in &rows {
        if package.as_ref().is_some_and(|wanted| wanted != row.package && wanted != row.specifier) { continue; }
        let Some(api) = lexicon.api(row.entry) else { continue };
        let entry = lexicon.entry_id(row.entry);
        looked.0.insert(row.owner);
        looked.1.insert(row.package);
        read.push((row, api));
        if let (true, Some(reason)) = (exact, api.unavailable.as_ref()) {
            let imported = row.imported == Some(true);
            if silent.get(&(entry, row.specifier)).is_none_or(|prior| !prior.imported && imported) {
                silent.insert((entry, row.specifier), Silent {
                    package: row.package.to_owned(), specifier: row.specifier.to_owned(),
                    version: api.runtime.as_ref().map(|identity| identity.version.clone()),
                    installed: api.runtime.as_ref().map(|identity| identity.manifest.clone()),
                    reason: reason.clone(), readme: api.readme.clone(), imported,
                });
            }
        }
        let candidates = searched.entry((row.entry, row.specifier)).or_insert_with(|| matches(api, row, &query, exact));
        for mut hit in candidates.iter().cloned() {
            hit.imported = row.imported == Some(true);
            hit.manifest = row.owner.to_owned();
            hit.declared_as = row.declared_as.map(str::to_owned);
            hit.imports = row.imports;
            hit.site = row.site.clone();
            let key = (entry, hit.specifier.clone(), hit.name.clone(), hit.kind.clone());
            let prior = found.get(&key);
            if prior.is_none_or(|prior| !prior.imported && hit.imported) { found.insert(key, hit); }
        }
    }
    let total = found.len() as u32;
    let mut shown: Vec<Match> = found.into_values().collect();
    shown.sort_by(|a, b| b.imported.cmp(&a.imported)
        .then_with(|| (&a.specifier, &a.name, &a.kind).cmp(&(&b.specifier, &b.name, &b.kind))));
    shown.truncate(limit as usize);
    let older = lexicon.catalogue.stems_older();
    let described_unread = older.filter(|_| !exact)
        .map(|version| format!("The dependency lexicon was written at version {version}, whose stems this release does not compare"));
    let words = if exact || older.is_some() { None } else { described(&query, read.iter().copied(), limit as usize) };
    let (described_total, described) = match words { Some((total, shown)) => (Some(total), Some(shown)), None => (None, None) };
    let answer = serde_json::to_string(&Matches { total, shown, silent: silent.into_values().collect(), described, described_total, described_unread,
        scope: Scope { owners: looked.0.into_iter().map(str::to_owned).collect(), packages: looked.1.len() as u32,
            location: allowed.map(|allowed| { let mut held: Vec<String> = allowed.into_iter().map(str::to_owned).collect(); held.sort_unstable(); held }) } })
        .map_err(|error| napi::Error::from_reason(error.to_string()))?;
    Ok(Some(answer))
}
