//! What an installed package says it is for, read once when the lexicon is refreshed.
//!
//! A described job ("state management") is written in the words a package uses
//! about itself: the manifest's `description` and `keywords`, and the headings
//! of the README beside it. They are read here, at refresh, from the installed
//! package the resolver named, and stored in the entry. A question only reads
//! them back; it never opens a package.

// compass: variance-authority.report.agent-surface

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{Identity, Name};

/// Headings kept per package: the first ones say what it is; a long tail is a table of contents.
const HEADINGS: usize = 24;
/// A heading or description longer than this is prose, not a name for a job.
const LONGEST: usize = 200;

#[derive(Clone, Default, Serialize, Deserialize)]
pub(super) struct Purpose {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keywords: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headings: Vec<String>,
    /// Stems of the words the package uses about itself, sorted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub said: Vec<String>,
    /// Stems of the words in its exported names and their first documentation sentences, sorted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub named: Vec<String>,
}

/// Stems kept from names and documentation: a very large package is a vocabulary, not a description.
const NAMED: usize = 1500;

const STOP: &[&str] = &["the", "and", "for", "with", "that", "this", "from", "into", "how", "use", "using", "used",
    "you", "your", "are", "can", "has", "have", "not", "all", "any", "its", "our", "via", "when", "which", "will",
    "library", "package", "module", "modules", "tool", "tools", "simple", "small", "fast", "based", "make", "get", "set"];

/// A word reduced to what a plural, a tense or a noun form would share with it.
pub(super) fn stem(word: &str) -> String {
    let mut stem = word.to_lowercase();
    for suffix in ["ations", "ation", "ments", "ment", "ings", "ing", "ers", "er", "ies", "ed", "es", "s"] {
        if let Some(rest) = stem.strip_suffix(suffix) {
            if rest.chars().count() >= 3 { stem = rest.to_owned(); break; }
        }
    }
    if stem.ends_with('e') && stem.chars().count() > 3 { stem.pop(); }
    stem
}

/// The stems of the words in `text`, splitting camelCase and punctuation; short words and stopwords dropped.
pub(super) fn stems(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut word = String::new();
    let mut last_lower = false;
    let flush = |word: &mut String, out: &mut Vec<String>| {
        if word.chars().count() >= 3 && !STOP.contains(&word.to_lowercase().as_str()) { out.push(stem(word)); }
        word.clear();
    };
    for ch in text.chars() {
        if !ch.is_alphanumeric() { flush(&mut word, &mut out); last_lower = false; continue; }
        if ch.is_uppercase() && last_lower { flush(&mut word, &mut out); }
        last_lower = ch.is_lowercase() || ch.is_ascii_digit();
        word.push(ch);
    }
    flush(&mut word, &mut out);
    out
}

fn sorted(mut words: Vec<String>) -> Vec<String> { words.sort_unstable(); words.dedup(); words }

fn headings(text: &str) -> Vec<String> {
    let mut fenced = false;
    let mut kept = Vec::new();
    for line in text.lines() {
        if line.trim_start().starts_with("```") { fenced = !fenced; continue; }
        if fenced { continue; }
        let Some(rest) = line.strip_prefix('#') else { continue };
        let title = rest.trim_start_matches('#').trim().trim_matches('#').trim();
        if title.is_empty() || title.chars().count() > LONGEST { continue; }
        kept.push(title.to_owned());
        if kept.len() == HEADINGS { break; }
    }
    kept
}

/// The words the runtime package (or, failing that, its declarations) publishes about itself.
pub(super) fn purpose(root: &Path, runtime: &Option<Identity>, declarations: &Option<Identity>, names: Option<&[Name]>) -> Option<Purpose> {
    let identity = runtime.as_ref().or(declarations.as_ref())?;
    let manifest = root.join(&identity.manifest);
    let value: serde_json::Value = serde_json::from_slice(&fs::read(&manifest).ok()?).ok()?;
    let description = value.get("description").and_then(|text| text.as_str())
        .map(|text| text.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|text| !text.is_empty() && text.chars().count() <= LONGEST * 2);
    let keywords = value.get("keywords").and_then(|list| list.as_array()).map(|list|
        list.iter().filter_map(|word| word.as_str()).map(str::to_owned).collect()).unwrap_or_default();
    let headings = manifest.parent().map(|directory| directory.join("README.md"))
        .and_then(|path| fs::read_to_string(path).ok()).map(|text| headings(&text)).unwrap_or_default();
    let mut said = stems(&identity.name);
    for text in description.iter().chain(&keywords).chain(&headings) { said.extend(stems(text)); }
    let mut named = Vec::new();
    for name in names.unwrap_or(&[]) {
        named.extend(stems(&name.name));
        if let Some(doc) = name.doc.as_deref() { named.extend(stems(doc.split("\n\n").next().unwrap_or(doc))); }
    }
    let mut named = sorted(named);
    named.truncate(NAMED);
    let found = Purpose { description, keywords, headings, said: sorted(said), named };
    (found.description.is_some() || !found.keywords.is_empty() || !found.headings.is_empty() || !found.named.is_empty()).then_some(found)
}
