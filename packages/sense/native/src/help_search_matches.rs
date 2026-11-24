//! The direct name and documentation matches from the search columns.

// compass: variance-authority.report.agent-surface

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::sync::LazyLock;

use memchr::memmem::Finder;
use regex::Regex;

use crate::dependency_lexicon::{describing::code_words, purposes::{phrase_run, stem, writes_run}};
use crate::help_symbol_rows::Rows;

static TOKEN_BREAK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\n\r\p{Z}\p{P}\p{Sm}`]+").expect("a fixed search tokenizer"));
static PARAGRAPH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\n[ \t]*\n").expect("a fixed paragraph separator"));

pub(crate) struct Matches {
    pub published: BTreeMap<usize, u8>,
    pub exported: BTreeMap<usize, u8>,
    pub named: BTreeSet<usize>,
}

pub(crate) fn matching(rows: &Rows, writing: &str, lowered: &str) -> Option<Matches> {
    let finder = Finder::new(lowered.as_bytes());
    let mut named = name_words(rows, lowered)?;
    named.extend(containing(rows, "names.lower", "names.lowerOff", &finder)?.into_iter().map(|(row, _)| row));
    let mut published = BTreeMap::new();
    let mut exported = BTreeMap::new();
    for &name in &named {
        let field = exactness(rows.string("names.name", name)?, writing, lowered).unwrap_or(2);
        for row in postings(rows, "names.pubOff", "names.pub", name)? { published.insert(row, field); }
        for row in postings(rows, "names.expOff", "names.exp", name)? { exported.insert(row, field); }
    }
    for (matches, blob, offsets) in [
        (&mut published, "pub.docLower", "pub.docLowerOff"),
        (&mut exported, "exp.docLower", "exp.docLowerOff"),
    ] {
        for (row, position) in containing(rows, blob, offsets, &finder)? {
            let text = rows.bytes(blob).get(rows.range(offsets, row)?)?;
            let head = std::str::from_utf8(text).ok()?;
            let opening = PARAGRAPH.find(head).is_none_or(|cut| position + lowered.len() <= cut.start());
            matches.entry(row).or_insert(if opening { 3 } else { 4 });
        }
    }
    if let Some(run) = phrase_run(lowered) {
        let stems: Vec<_> = code_words(lowered).into_keys().collect();
        if stems.len() >= 2 {
            let terms = stems_in(rows, &stems)?;
            for (found, offsets, postings_key, doc) in [
                (&mut published, "terms.pubOff", "terms.pub", "pub.doc"),
                (&mut exported, "terms.expOff", "terms.exp", "exp.doc"),
            ] {
                for row in intersect_terms(rows, &terms, offsets, postings_key)? {
                    let Some(doc) = rows.optional(doc, row)? else { continue };
                    if let Some(paragraph) = writes_run(&run, doc) {
                        let field = if paragraph == 0 { 3 } else { 4 };
                        found.entry(row).and_modify(|held| *held = (*held).min(field)).or_insert(field);
                    }
                }
            }
        }
    }
    Some(Matches { published, exported, named })
}

pub(crate) fn exactness(text: &str, writing: &str, lowered: &str) -> Option<u8> {
    if text == writing { Some(0) } else { (text.to_lowercase() == lowered).then_some(1) }
}

/// Search the whole run once, then locate the row owning each hit. A row's
/// separator is excluded so a hit may only be written in one name or doc.
fn containing(rows: &Rows, blob: &str, offsets: &str, query: &Finder<'_>) -> Option<Vec<(usize, usize)>> {
    let bytes = rows.bytes(blob);
    let offsets = rows.column(offsets);
    let count = offsets.len().checked_sub(1)?;
    let mut at = 0;
    let mut found = Vec::new();
    while let Some(hit) = query.find(bytes.get(at..)?) {
        let hit = hit + at;
        let row = crate::stored::partition(count, |row| offsets.at(row + 1) as usize <= hit);
        if row == count { break }
        let next = offsets.at(row + 1) as usize;
        if next <= hit || next > bytes.len() { return None }
        if hit.checked_add(query.needle().len())? < next {
            found.push((row, hit.checked_sub(offsets.at(row) as usize)?));
        }
        at = next;
    }
    Some(found)
}

pub(crate) fn postings(rows: &Rows, offsets: &str, values: &str, row: usize) -> Option<Vec<usize>> {
    let column = rows.column(values);
    let range = rows.range(offsets, row)?;
    if range.end > column.len() { return None }
    Some(range.map(|at| column.at(at) as usize).collect())
}

pub(crate) fn stems_in(rows: &Rows, stems: &[String]) -> Option<Vec<Vec<usize>>> {
    let mut matches = vec![Vec::new(); stems.len()];
    for id in 0..rows.column("terms.off").len().checked_sub(1)? {
        let word = term(rows, id)?;
        if let Ok(at) = stems.binary_search(&stem(word)) {
            if word.starts_with(&stems[at]) { matches[at].push(id); }
        }
    }
    Some(matches)
}

pub(crate) fn intersect_terms(rows: &Rows, terms: &[Vec<usize>], offsets: &str, values: &str) -> Option<HashSet<usize>> {
    let mut held: Option<HashSet<usize>> = None;
    for group in terms {
        let mut next = HashSet::new();
        for &term in group {
            next.extend(postings(rows, offsets, values, term)?.into_iter().filter(|row| held.as_ref().is_none_or(|held| held.contains(row))));
        }
        if next.is_empty() { return Some(next) }
        held = Some(next);
    }
    Some(held.unwrap_or_default())
}

pub(crate) fn term(rows: &Rows, row: usize) -> Option<&str> {
    std::str::from_utf8(rows.bytes("terms.blob").get(rows.range("terms.off", row)?)?).ok()
}

/// A word reaches the names using it as a prefix or sharing its stem. The
/// dictionary is scanned once, and the reached names intersect across words.
fn name_words(rows: &Rows, lowered: &str) -> Option<BTreeSet<usize>> {
    let words: Vec<_> = tokens(lowered).map(|word| (word, stem(word))).collect();
    if words.is_empty() { return Some(BTreeSet::new()) }
    let mut reached: Vec<HashSet<usize>> = vec![HashSet::new(); words.len()];
    let terms = rows.column("terms.off").len().checked_sub(1)?;
    for id in 0..terms {
        let term = term(rows, id)?;
        let term_stem = stem(term);
        let matching: Vec<_> = words.iter().enumerate().filter(|(_, (word, stem))| term.starts_with(word) || (term.starts_with(stem) && term_stem == *stem)).map(|(at, _)| at).collect();
        if matching.is_empty() { continue }
        let names = postings(rows, "terms.nameOff", "terms.name", id)?;
        for at in matching { reached[at].extend(names.iter().copied()); }
    }
    let mut sets = reached.into_iter();
    let mut names = sets.next()?;
    for set in sets { names.retain(|name| set.contains(name)); }
    Some(names.into_iter().collect())
}

pub(crate) fn tokens(query: &str) -> impl Iterator<Item = &str> {
    TOKEN_BREAK.split(query).filter(|word| word.encode_utf16().count() >= 2)
}

pub(crate) fn opening(text: &str) -> &str {
    PARAGRAPH.find(text).map_or(text, |cut| &text[..cut.start()])
}
