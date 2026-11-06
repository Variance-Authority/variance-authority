//! What an installed package says it is for, read once when the lexicon is refreshed.
//!
//! A described job ("state management") is written in the words a package uses
//! about itself: the manifest's `description` and `keywords`, and the headings
//! of the README beside it. They are read here, at refresh, from the installed
//! package the resolver named, and stored in the entry. A question only reads
//! them back; it never opens a package.

// compass: variance-authority.report.agent-surface

use std::collections::{BTreeSet, HashMap};
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

/// Words that say how a question is put, never what it is about: dropped from every text.
const FUNCTION: &[&str] = &["the", "and", "for", "with", "that", "this", "from", "into", "how", "you", "your", "are",
    "can", "has", "have", "not", "all", "any", "its", "our", "via", "when", "which", "will", "what", "where", "who",
    "whom", "whose", "why", "does", "did", "was", "were", "been", "there", "their", "them", "they", "then", "than",
    "but", "about", "each"];

/// Words every package says about itself, so they tell no package from another;
/// in code they name things (`packageOf`, `useStore`), so code keeps them.
const DESCRIPTION: &[&str] = &["use", "using", "used", "library", "package", "module", "modules", "tool", "tools",
    "simple", "small", "fast", "based", "make", "get", "set"];

/// A word reduced to what a plural, a tense or a noun form would share with it.
///
/// An inflection comes off once — a plural, a tense, a participle — and then
/// the noun and agent endings come off until none does, so `instrumenting`,
/// `instrumentation` and `instrument` all reach `instru`. A noun ending needs
/// four letters left, so `comment` stays apart from `come` and `generation`
/// from `gene`; a plural `s` stays on after `s` or `u`, so `process` is not
/// `proces`, and `ed` stays on after `e`, so `proceed` is not `proc`.
pub(super) fn stem(word: &str) -> String {
    let mut stem = word.to_lowercase();
    for suffix in ["ings", "ing", "ies", "ed", "es", "s"] {
        if let Some(rest) = stem.strip_suffix(suffix) {
            if suffix == "s" && (rest.ends_with('s') || rest.ends_with('u')) { break; }
            if suffix == "ed" && rest.ends_with('e') { break; }
            if rest.chars().count() >= 3 { stem = rest.to_owned(); break; }
        }
    }
    'ending: loop {
        for (suffix, left) in [("ation", 4), ("ment", 4), ("er", 4)] {
            if let Some(rest) = stem.strip_suffix(suffix) {
                if rest.chars().count() >= left { stem = rest.to_owned(); continue 'ending; }
            }
        }
        break;
    }
    if stem.ends_with('e') && stem.chars().count() > 3 { stem.pop(); }
    stem
}

/// Each word of `text` with the paragraph it is in, split at punctuation, space
/// and camelCase. A possessive `'s` is part of the word before it, and a blank
/// line — a newline, spaces or tabs, a newline — starts the next paragraph.
fn each_word(text: &str, mut visit: impl FnMut(&str, u32)) {
    let mut word = String::new();
    let (mut last_lower, mut paragraph, mut blank_line, mut broke) = (false, 0u32, false, false);
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch.is_alphanumeric() {
            if broke { paragraph += 1; broke = false; }
            blank_line = false;
            if ch.is_uppercase() && last_lower { visit(&word, paragraph); word.clear(); }
            last_lower = ch.is_lowercase() || ch.is_ascii_digit();
            word.push(ch);
            continue;
        }
        if matches!(ch, '\'' | '\u{2019}') && !word.is_empty() {
            let mut ahead = chars.clone();
            if matches!(ahead.next(), Some('s' | 'S')) && !ahead.next().is_some_and(char::is_alphanumeric) { chars.next(); }
        }
        if !word.is_empty() { visit(&word, paragraph); word.clear(); }
        last_lower = false;
        match ch {
            '\n' => { if blank_line { broke = true; } blank_line = true; }
            ' ' | '\t' => {}
            _ => blank_line = false,
        }
    }
    if !word.is_empty() { visit(&word, paragraph); }
}

/// Whether a word is read for its stem: three letters or more, and not a word `dropped` names.
fn kept(word: &str, dropped: &impl Fn(&str) -> bool) -> bool {
    word.chars().count() >= 3 && !dropped(&word.to_lowercase())
}

/// The stems of the words in `text`; short words and the words `dropped` names left out.
fn cut(text: &str, dropped: impl Fn(&str) -> bool) -> Vec<String> {
    let mut out = Vec::new();
    each_word(text, |word, _| if kept(word, &dropped) { out.push(stem(word)); });
    out
}

/// The stems a package is described by: function words and the words every package says about itself dropped.
pub(crate) fn stems(text: &str) -> Vec<String> {
    cut(text, |word| FUNCTION.contains(&word) || DESCRIPTION.contains(&word))
}

/// The stems code is described by: function words dropped, and `package`,
/// `module` or `use` kept, since a repository's names are written in them.
pub(crate) fn code_stems(text: &str) -> Vec<String> {
    cut(text, |word| FUNCTION.contains(&word))
}

/// One stem of a text where it stands: its paragraph, and its place among every word of it.
struct Placed { paragraph: u32, place: u32, stem: String }

/// The stems of `text` as [`code_stems`] reads them, each where it stands. A word
/// read for no stem still holds its place, as Lucene's StopFilter keeps a
/// dropped word's position increment, so `page and its sink` does not write
/// `page sink`.
fn placed(text: &str) -> Vec<Placed> {
    let dropped = |word: &str| FUNCTION.contains(&word);
    let (mut out, mut place, mut current) = (Vec::new(), 0u32, 0u32);
    each_word(text, |word, paragraph| {
        if paragraph != current { (current, place) = (paragraph, 0); }
        if kept(word, &dropped) { out.push(Placed { paragraph, place, stem: stem(word) }); }
        place += 1;
    });
    out
}

/// Each stem of a text by where it stands, read once per text however many runs are asked of it.
fn by_place(said: &[Placed]) -> HashMap<(u32, u32), &str> {
    said.iter().map(|one| ((one.paragraph, one.place), one.stem.as_str())).collect()
}

/// The first paragraph of `said` that writes `run` — each stem with its place
/// after the run's first — at the same distances; `None` when none does.
fn writes(said: &[Placed], at: &HashMap<(u32, u32), &str>, run: &[(u32, &str)]) -> Option<u32> {
    let (first, rest) = run.split_first()?;
    said.iter().filter(|one| one.stem == first.1).find(|one| {
        rest.iter().all(|(place, stem)| at.get(&(one.paragraph, one.place + place)) == Some(stem))
    }).map(|one| one.paragraph)
}

/// The question's stems as one run, each placed after the first: a word the
/// question drops before its first stem asks for nothing before the run. A
/// question is one run, so a line break in it parts nothing.
fn asked_run(query: &str) -> Vec<(u32, String)> {
    let asked = placed(&query.replace(['\n', '\r'], " "));
    let start = asked.first().map_or(0, |one| one.place);
    asked.into_iter().map(|one| (one.place - start, one.stem)).collect()
}

/// How many of the adjacent stem pairs of `query` `text` also writes, each at
/// the distance the question puts it: a doc that says the question's phrase,
/// not only its words. The pairs are of the words a question is about — `it
/// is` or `of a` are how any sentence is put — and are read by [`writes`].
pub(crate) fn near(query: &str, text: &str) -> u32 {
    let asked = asked_run(query);
    let pairs: BTreeSet<[(u32, &str); 2]> = asked.windows(2)
        .map(|pair| [(0, pair[0].1.as_str()), (pair[1].0 - pair[0].0, pair[1].1.as_str())]).collect();
    if pairs.is_empty() { return 0; }
    let said = placed(text);
    let at = by_place(&said);
    pairs.iter().filter(|pair| writes(&said, &at, &pair[..]).is_some()).count() as u32
}

/// The run [`writes_run`] asks of every text for `query`, cut once: `None` when the
/// question holds fewer than two distinct stems, which is no phrase.
pub(crate) fn phrase_run(query: &str) -> Option<Vec<(u32, String)>> {
    let asked = asked_run(query);
    let distinct: BTreeSet<&str> = asked.iter().map(|(_, stem)| stem.as_str()).collect();
    (distinct.len() >= 2).then_some(asked)
}

/// The first paragraph of `text` that writes `run`, read by [`writes`]; `None` when no paragraph does.
pub(crate) fn writes_run(run: &[(u32, String)], text: &str) -> Option<u32> {
    let run: Vec<(u32, &str)> = run.iter().map(|(place, stem)| (*place, stem.as_str())).collect();
    let said = placed(text);
    writes(&said, &by_place(&said), &run)
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

#[cfg(test)]
mod tests {
    use super::{near, phrase_run, stem, writes_run};

    /// The first paragraph of `text` that writes `query`'s run, cut for this one text.
    fn phrase(query: &str, text: &str) -> Option<u32> {
        writes_run(&phrase_run(query)?, text)
    }

    #[test]
    fn a_word_between_two_of_the_question_parts_them() {
        // Lucene's StopFilter keeps a dropped word's position: `and its` stands between `page` and `sink`.
        assert_eq!(near("page sink", "Each page and its sink."), 0);
        assert_eq!(phrase("page sink", "Each page and its sink."), None);
    }

    #[test]
    fn a_possessive_or_punctuation_between_two_words_does_not_part_them() {
        assert_eq!(near("page sink", "Source that installs the page's sink."), 1);
        assert_eq!(phrase("page sink", "Source that installs the page's sink."), Some(0));
        assert_eq!(phrase("page sink", "The page\u{2019}s sink."), Some(0));
        assert_eq!(phrase("page sink", "One page, sink it."), Some(0));
    }

    #[test]
    fn a_word_dropped_from_the_question_holds_its_place_in_the_doc() {
        assert_eq!(phrase("sink of a page", "The sink of the page."), Some(0));
        assert_eq!(phrase("sink of a page", "The sink page."), None);
        assert_eq!(near("sink of a page", "The sink of one page."), 1);
    }

    #[test]
    fn a_phrase_is_its_words_in_order_by_stem() {
        assert_eq!(phrase("region placement", "A region placed by the transform."), Some(0));
        assert_eq!(phrase("placement region", "A region placed by the transform."), None);
        assert_eq!(phrase("cache entries sweep", "Cache entries sweeping."), Some(0));
        assert_eq!(phrase("cache entries sweep", "Cache entries kept for each sweep."), None);
        assert_eq!(near("cache entries sweep", "Cache entries kept for each sweep."), 1);
    }

    #[test]
    fn a_blank_line_ends_the_run_and_the_paragraph_is_named() {
        assert_eq!(phrase("page sink", "Each page.\n\nSink it."), None);
        assert_eq!(near("page sink", "Each page.\n \nSink it."), 0);
        assert_eq!(phrase("page sink", "Opening.\n\nThe page sink.\n\nThe page sink."), Some(1));
        assert_eq!(phrase("page sink", "One page.\nSink it."), Some(0));
    }

    #[test]
    fn a_dropped_word_opening_the_question_asks_nothing_before_the_run() {
        assert_eq!(phrase("the page sink", "Page sink for events."), Some(0));
        assert_eq!(phrase("a page sink", "Page sink."), Some(0));
        assert_eq!(near("the page sink", "Page sink."), 1);
    }

    #[test]
    fn a_blank_line_in_the_question_is_no_break_in_its_run() {
        assert_eq!(phrase("the a page\n\nsink", "The page sink."), Some(0));
        assert_eq!(near("the a page\n\nsink", "The page sink."), 1);
    }

    #[test]
    fn one_stem_asked_twice_is_no_phrase() {
        assert_eq!(phrase("sink to sink", "The sink to sink path."), None);
    }

    #[test]
    fn one_word_of_the_question_is_no_phrase() {
        assert_eq!(phrase("sink", "The sink."), None);
        assert_eq!(phrase("the sink", "The sink."), None);
    }

    #[test]
    fn a_word_and_its_inflections_share_one_stem() {
        for (inflected, plain) in [("instrumenting", "instrument"), ("instrumented", "instrument"), ("instrumentation", "instrument"),
            ("orders", "order"), ("placement", "place"), ("placed", "place"), ("modules", "module"), ("probes", "probe"),
            ("processes", "process"), ("proceeds", "proceed"), ("rendered", "render")] {
            assert_eq!(stem(inflected), stem(plain), "{inflected} and {plain}");
        }
    }

    #[test]
    fn a_shorter_word_inside_a_longer_one_keeps_its_own_stem() {
        for (longer, shorter) in [("generation", "gene"), ("process", "proceed"), ("comment", "come"), ("segment", "seg"),
            ("element", "ele"), ("processes", "proceeds")] {
            assert_ne!(stem(longer), stem(shorter), "{longer} and {shorter}");
        }
    }

    #[test]
    fn a_stem_is_its_own_stem() {
        for word in ["instrumenting", "instrument", "order", "placement", "statements", "settings", "process", "renderers"] {
            assert_eq!(stem(&stem(word)), stem(word), "{word}");
        }
    }
}
