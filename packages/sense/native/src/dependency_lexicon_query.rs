//! Bounded questions over the separately published dependency corpus.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::Path;

use napi_derive::napi;
use serde::Serialize;

use super::describing::{described, Described};
use super::{Api, Lexicon, Readme};

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
    reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    readme: Option<Readme>,
    imported: bool,
}

/// `silent` is asked for by an exact name only: a search over words has no name to be silent about.
#[derive(Serialize)]
struct Matches {
    total: u32, shown: Vec<Match>, silent: Vec<Silent>, scope: Scope,
    /// Packages whose own words describe the question, asked for by words rather than one name.
    #[serde(skip_serializing_if = "Option::is_none")]
    described: Option<Vec<Described>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    described_total: Option<u32>,
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

pub(super) fn owners<'a>(lexicon: &'a Lexicon, files: &[String]) -> HashSet<&'a str> {
    let mut manifests: Vec<&str> = lexicon.availability.iter().map(|row| row.owner.as_str()).collect();
    manifests.sort_unstable();
    manifests.dedup();
    manifests.sort_unstable_by_key(|path| std::cmp::Reverse(path.len()));
    let mut included = HashSet::new();
    for file in files {
        let owner = manifests.iter().copied().find(|manifest| {
            if *manifest == "package.json" { return false; }
            let Some(directory) = manifest.strip_suffix("package.json") else { return false };
            file.starts_with(directory) || format!("{file}/").starts_with(directory)
        });
        included.insert(owner.unwrap_or("package.json"));
    }
    included
}

fn summary(doc: &str) -> String {
    let paragraph = doc.split("\n\n").next().unwrap_or(doc).split_whitespace().collect::<Vec<_>>().join(" ");
    paragraph.chars().take(180).collect()
}

fn matches(api: &Api, row: &super::Availability, query: &str, exact: bool) -> Vec<Match> {
    api.names.as_deref().unwrap_or(&[]).iter().filter(|name| {
        if exact { name.name == query } else {
            [row.package.as_str(), row.specifier.as_str(), name.name.as_str(), name.doc.as_deref().unwrap_or("")]
                .iter().any(|field| field.to_lowercase().contains(query))
        }
    }).map(|name| Match {
        source: "third-party", name: name.name.clone(), specifier: row.specifier.clone(),
        kind: name.kind.clone(), package: row.package.clone(), manifest: row.owner.clone(),
        declared_as: row.declared_as.clone(), imports: row.imports, site: row.site.clone(),
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
pub fn query_dependency_lexicon(path: String, query: String, files: Option<Vec<String>>,
    exact: bool, package: Option<String>, limit: u32) -> napi::Result<Option<String>> {
    let bytes = match fs::read(Path::new(&path)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(napi::Error::from_reason(error.to_string())),
    };
    let lexicon: Lexicon = serde_json::from_slice(&bytes)
        .map_err(|error| napi::Error::from_reason(format!("the dependency lexicon did not read: {error}")))?;
    if !matches!(lexicon.version, 4..=9) { return Err(napi::Error::from_reason("the dependency lexicon version is not supported")); }
    let allowed = files.as_ref().map(|files| owners(&lexicon, files));
    let entries: HashMap<&str, &Api> = lexicon.entries.iter().map(|entry| (entry.id.as_str(), &entry.api)).collect();
    let query = if exact { query } else { query.to_lowercase() };
    let mut found = BTreeMap::<(String, String, String, String), Match>::new();
    let mut searched = HashMap::<(&str, &str), Vec<Match>>::new();
    let mut silent = BTreeMap::<(String, String), Silent>::new();
    let mut looked = (BTreeSet::<&str>::new(), BTreeSet::<&str>::new());
    let mut read = Vec::new();
    for row in &lexicon.availability {
        if allowed.as_ref().is_some_and(|owners| !owners.contains(row.owner.as_str())) { continue; }
        if package.as_ref().is_some_and(|wanted| wanted != &row.package && wanted != &row.specifier) { continue; }
        let Some(api) = entries.get(row.entry.as_str()) else { continue };
        looked.0.insert(row.owner.as_str());
        looked.1.insert(row.package.as_str());
        read.push((row, *api));
        if let (true, Some(reason)) = (exact, api.unavailable.as_ref()) {
            let key = (row.entry.clone(), row.specifier.clone());
            let imported = row.imported == Some(true);
            if silent.get(&key).is_none_or(|prior| !prior.imported && imported) {
                silent.insert(key, Silent {
                    package: row.package.clone(), specifier: row.specifier.clone(),
                    version: api.runtime.as_ref().map(|identity| identity.version.clone()),
                    reason: reason.clone(), readme: api.readme.clone(), imported,
                });
            }
        }
        let candidates = searched.entry((row.entry.as_str(), row.specifier.as_str()))
            .or_insert_with(|| matches(api, row, &query, exact));
        for mut hit in candidates.iter().cloned() {
            hit.imported = row.imported == Some(true);
            hit.manifest = row.owner.clone();
            hit.declared_as = row.declared_as.clone();
            hit.imports = row.imports;
            hit.site = row.site.clone();
            let key = (row.entry.clone(), hit.specifier.clone(), hit.name.clone(), hit.kind.clone());
            let prior = found.get(&key);
            if prior.is_none_or(|prior| !prior.imported && hit.imported) { found.insert(key, hit); }
        }
    }
    let total = found.len() as u32;
    let mut shown: Vec<Match> = found.into_values().collect();
    shown.sort_by(|a, b| b.imported.cmp(&a.imported)
        .then_with(|| (&a.specifier, &a.name, &a.kind).cmp(&(&b.specifier, &b.name, &b.kind))));
    shown.truncate(limit as usize);
    let words = if exact { None } else { described(&query, read.iter().copied(), limit as usize) };
    let (described_total, described) = match words { Some((total, shown)) => (Some(total), Some(shown)), None => (None, None) };
    let answer = serde_json::to_string(&Matches { total, shown, silent: silent.into_values().collect(), described, described_total,
        scope: Scope { owners: looked.0.into_iter().map(str::to_owned).collect(), packages: looked.1.len() as u32,
            location: allowed.map(|allowed| { let mut held: Vec<String> = allowed.into_iter().map(str::to_owned).collect(); held.sort_unstable(); held }) } })
        .map_err(|error| napi::Error::from_reason(error.to_string()))?;
    Ok(Some(answer))
}
