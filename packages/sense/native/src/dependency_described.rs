//! A job described in words, matched to the packages that say they do it.
//!
//! The question is split into stems the same way the packages were at refresh.
//! A package answers when its own words, or the words of its names and their
//! documentation, hold at least half of the question's distinct stems. A package
//! that says it in its own description outranks one that only has a function
//! named for a word of it. Nothing here opens a package: the stems were stored.

// compass: variance-authority.report.agent-surface

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::purposes::stems;
use super::{Api, Availability, Skill};

/// A package that says it does what was asked.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Described {
    package: String,
    specifier: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    manifest: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    declared_as: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    imports: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    site: Option<String>,
    imported: bool,
    /// The question's words the package holds, as the question wrote them.
    words: Vec<String>,
    /// How many of them the package says about itself rather than through a name.
    said: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    /// The agent skills the package ships, each with its `SKILL.md`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    skills: Vec<Skill>,
}

/// The question's distinct stems, each with the word it was written as.
fn asked(query: &str) -> BTreeMap<String, String> {
    let mut asked = BTreeMap::new();
    for word in query.split(|ch: char| !ch.is_alphanumeric()) {
        for stem in stems(word) { asked.entry(stem).or_insert_with(|| word.to_lowercase()); }
    }
    asked
}

/// The packages in `rows` that describe `query`, best first; `None` when the question has no word to describe.
pub(super) fn described<'a>(query: &str, rows: impl Iterator<Item = (&'a Availability, &'a Api)>, limit: usize) -> Option<(u32, Vec<Described>)> {
    let asked = asked(query);
    if asked.is_empty() { return None; }
    let needed = asked.len().div_ceil(2);
    let mut best = BTreeMap::<(String, String), Described>::new();
    for (row, api) in rows {
        let Some(purpose) = api.purpose.as_ref() else { continue };
        let said: BTreeSet<&str> = asked.keys().filter(|stem| purpose.said.binary_search(stem).is_ok()).map(String::as_str).collect();
        let held: BTreeSet<&str> = asked.keys().filter(|stem| said.contains(stem.as_str()) || purpose.named.binary_search(stem).is_ok()).map(String::as_str).collect();
        if held.len() < needed { continue; }
        let hit = Described {
            package: row.package.clone(), specifier: row.specifier.clone(), manifest: row.owner.clone(),
            version: api.runtime.as_ref().or(api.declarations.as_ref()).map(|identity| identity.version.clone()),
            declared_as: row.declared_as.clone(), imports: row.imports, site: row.site.clone(), imported: row.imported == Some(true),
            words: held.iter().map(|stem| asked[*stem].clone()).collect(), said: said.len() as u32,
            description: purpose.description.clone(), skills: api.skills.clone().unwrap_or_default(),
        };
        let key = (row.package.clone(), row.specifier.clone());
        let better = best.get(&key).is_none_or(|prior| (hit.words.len(), hit.imported) > (prior.words.len(), prior.imported));
        if better { best.insert(key, hit); }
    }
    let total = best.len() as u32;
    let mut shown: Vec<Described> = best.into_values().collect();
    shown.sort_by(|a, b| b.words.len().cmp(&a.words.len()).then(b.said.cmp(&a.said)).then(b.imported.cmp(&a.imported))
        .then_with(|| (&a.package, &a.specifier).cmp(&(&b.package, &b.specifier))));
    shown.truncate(limit);
    Some((total, shown))
}
