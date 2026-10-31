//! A job described in words, matched to the packages that say they do it.
//!
//! The question is split into stems the same way the packages were at refresh.
//! A package answers when its own words, or the words of its names and their
//! documentation, hold at least half of the question's distinct stems. A package
//! that says it in its own description outranks one that only has a function
//! named for a word of it. Nothing here opens a package: the stems were stored.

// compass: variance-authority.report.agent-surface

use std::collections::{BTreeMap, BTreeSet};

use napi_derive::napi;
use serde::Serialize;

use super::purposes::{code_stems, near, phrase_run, stem, stems, writes_run};
use super::view::Row;
use super::Api;

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
}

/// The question's distinct stems by the rule `cut`, each with the word it was written as.
fn asked(query: &str, cut: fn(&str) -> Vec<String>) -> BTreeMap<String, String> {
    let mut asked = BTreeMap::new();
    for word in query.split(|ch: char| !ch.is_alphanumeric()) {
        for stem in cut(word) { asked.entry(stem).or_insert_with(|| word.to_lowercase()); }
    }
    asked
}

/// The question's distinct stems as `[stem, word]` pairs, for the repository's
/// own names: cut as a package's words are, less the stopwords only a package
/// says, since code is named in `package`, `module` and `use`.
#[napi(js_name = "describedWords")]
pub fn described_words(query: String) -> Vec<Vec<String>> {
    asked(&query, code_stems).into_iter().map(|(stem, word)| vec![stem, word]).collect()
}

/// Per text, how many of the adjacent stem pairs of `query` it writes at the distance the question puts them.
#[napi(js_name = "nearOf")]
pub fn near_of(query: String, texts: Vec<String>) -> Vec<u32> {
    texts.iter().map(|text| near(&query, text)).collect()
}

/// Per text, the first paragraph that writes the whole of `query`'s stems in order, two distinct or more, by the rule `nearOf` counts pairs by.
#[napi(js_name = "phraseOf")]
pub fn phrase_of(query: String, texts: Vec<String>) -> Vec<Option<u32>> {
    let Some(run) = phrase_run(&query) else { return vec![None; texts.len()] };
    texts.iter().map(|text| writes_run(&run, text)).collect()
}

/// Each word reduced to its stem, in order: which of a dictionary's terms a stem of `describedWords` stands for.
#[napi(js_name = "wordStems")]
pub fn word_stems(words: Vec<String>) -> Vec<String> {
    words.iter().map(|word| stem(word)).collect()
}

/// The packages in `rows` that describe `query`, best first; `None` when the question has no word to describe.
pub(super) fn described<'a>(query: &str, rows: impl Iterator<Item = (&'a Row<'a>, &'a Api)>, limit: usize) -> Option<(u32, Vec<Described>)> {
    let asked = asked(query, stems);
    if asked.is_empty() { return None; }
    let needed = asked.len().div_ceil(2);
    let mut best = BTreeMap::<(String, String), Described>::new();
    for (row, api) in rows {
        let Some(purpose) = api.purpose.as_ref() else { continue };
        let said: BTreeSet<&str> = asked.keys().filter(|stem| purpose.said.binary_search(stem).is_ok()).map(String::as_str).collect();
        let held: BTreeSet<&str> = asked.keys().filter(|stem| said.contains(stem.as_str()) || purpose.named.binary_search(stem).is_ok()).map(String::as_str).collect();
        if held.len() < needed { continue; }
        let hit = Described {
            package: row.package.to_owned(), specifier: row.specifier.to_owned(), manifest: row.owner.to_owned(),
            version: api.runtime.as_ref().or(api.declarations.as_ref()).map(|identity| identity.version.clone()),
            declared_as: row.declared_as.map(str::to_owned), imports: row.imports, site: row.site.clone(), imported: row.imported == Some(true),
            words: held.iter().map(|stem| asked[*stem].clone()).collect(), said: said.len() as u32,
            description: purpose.description.clone(),
        };
        let key = (row.package.to_owned(), row.specifier.to_owned());
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
