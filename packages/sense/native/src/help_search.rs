//! The search terms the questions' store is cut into, and the pieces its
//! encoder shares (`help_store.rs`): one string pool, joined text runs and
//! posting lists.
//!
//! A term is cut here by the rule `termsOf` gives the loose pass, so the
//! dictionary the store holds and the terms a question asks by agree.

// compass: variance-authority.report.agent-surface

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::LazyLock;

use napi_derive::napi;
use rayon::prelude::*;
use regex::Regex;
use sha2::{Digest, Sha256};

use crate::help_usage::NamedExport;

#[derive(Default)]
pub(crate) struct Pool<'a> {
    pub(crate) ids: HashMap<&'a str, u32>,
    pub(crate) values: Vec<&'a str>,
}

impl<'a> Pool<'a> {
    pub(crate) fn id(&mut self, value: &'a str) -> (u32, bool) {
        if let Some(&id) = self.ids.get(value) {
            return (id, false);
        }
        let id = self.values.len() as u32;
        self.ids.insert(value, id);
        self.values.push(value);
        (id, true)
    }
}

/// Whether a declaration of this kind writes a head before its body. A type
/// alias does not: all it writes after its name is its body.
pub(crate) fn headed(kind: &str) -> bool {
    kind != "type"
}

/// The tokenizer and term rule `termsOf` gives the loose pass: each token whole
/// and, when it is written in several words, each word (`words_of`); short
/// terms dropped, counted in UTF-16 code units, the rest lowercased; once each.
pub(crate) fn terms_of(split: &Regex, text: &str) -> HashSet<String> {
    let long = |term: &str| term.encode_utf16().nth(1).is_some();
    let mut found = HashSet::new();
    for token in split.split(text) {
        if long(token) {
            found.insert(token.to_lowercase());
        }
        let words = words_of(token);
        if words.len() < 2 {
            continue;
        }
        found.extend(words.into_iter().filter(|word| long(word)).map(str::to_lowercase));
    }
    found
}

/// What a token ends at: a line break, a space, a punctuation mark, a backtick,
/// which is a symbol (`Sk`) and a code span's delimiter, never a word's, or a
/// math symbol (`Sm`), which a type writes between names: `Promise<Node>`, `A | B`.
pub(crate) static SPLIT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\n\r\p{Z}\p{P}\p{Sm}`]+").expect("the pattern is fixed"));

/// A name's terms as the search file indexes an exported one, so a name the
/// file does not hold answers the loose pass by the same rule.
pub(crate) fn name_terms(name: &str) -> HashSet<String> {
    terms_of(&SPLIT, name)
}

/// Names cut into terms: the distinct terms, sorted by their UTF-8 bytes as the
/// search file's dictionary is, and per name the terms it holds, by position.
#[napi(object)]
pub struct NameTerms {
    pub terms: Vec<String>,
    pub held: Vec<Vec<u32>>,
}

/// `names` cut by the rule an exported name is, so text that writes names is
/// asked by the words a name is.
#[napi(js_name = "nameTerms")]
pub fn name_terms_of(names: Vec<String>) -> NameTerms {
    let cut: Vec<HashSet<String>> = names.iter().map(|name| name_terms(name)).collect();
    let terms: Vec<String> = cut.iter().flatten().cloned().collect::<BTreeSet<_>>().into_iter().collect();
    let at: HashMap<&str, u32> = terms.iter().zip(0u32..).map(|(term, id)| (term.as_str(), id)).collect();
    let held = cut.iter().map(|one| one.iter().filter_map(|term| at.get(term.as_str()).copied()).collect()).collect();
    NameTerms { terms, held }
}

/// `wordsOf`: the words one token is written in, split where the case or a
/// digit changes — a lowercase letter before an uppercase one, the last capital
/// of a run before a lowercase letter, and a digit beside anything that is not one.
fn words_of(token: &str) -> Vec<&str> {
    let chars: Vec<(usize, char)> = token.char_indices().collect();
    let mut words = Vec::new();
    let mut start = 0;
    for at in 1..chars.len() {
        let (offset, here) = chars[at];
        let before = chars[at - 1].1;
        let after = chars.get(at + 1).map(|&(_, after)| after);
        let split = (before.is_lowercase() && here.is_uppercase())
            || (before.is_uppercase() && here.is_uppercase() && after.is_some_and(char::is_lowercase))
            || before.is_numeric() != here.is_numeric();
        if !split {
            continue;
        }
        words.push(&token[start..offset]);
        start = offset;
    }
    words.push(&token[start..]);
    words
}

/// `joined`: strings as UTF-8 with a separator, and where each one starts.
pub(crate) fn joined<S: AsRef<str>>(values: &[S], separator: &str) -> (Vec<u32>, Vec<u8>) {
    let mut off = Vec::with_capacity(values.len() + 1);
    let mut blob = Vec::new();
    for (at, value) in values.iter().enumerate() {
        if at > 0 {
            blob.extend_from_slice(separator.as_bytes());
        }
        // Each start counts a separator after every earlier value.
        off.push((blob.len()) as u32);
        blob.extend_from_slice(value.as_ref().as_bytes());
    }
    off.push(if values.is_empty() { 0 } else { (blob.len() + separator.len()) as u32 });
    (off, blob)
}

/// `postings`: for each key, the ascending rows that hold it.
pub(crate) fn postings(lists: &[&[u32]]) -> (Vec<u32>, Vec<u32>) {
    let mut off = Vec::with_capacity(lists.len() + 1);
    let mut rows = Vec::new();
    for list in lists {
        off.push(rows.len() as u32);
        rows.extend_from_slice(list);
    }
    off.push(rows.len() as u32);
    (off, rows)
}

/// The export list as a set: each row's file, name, kind and type, in byte
/// order, once.
pub(crate) fn exported_digest(exported: &[NamedExport]) -> String {
    set_digest(exported.par_iter().map(|named| format!("{}\0{}\0{}\0{}", named.at, named.name, named.kind, u8::from(named.r#type))).collect())
}

/// `keys` as a set: in byte order, once.
pub(crate) fn set_digest(mut keys: Vec<String>) -> String {
    keys.par_sort_unstable();
    keys.dedup();
    let mut digest = Sha256::new();
    for key in &keys {
        digest.update(key.as_bytes());
        digest.update(b"\n");
    }
    digest.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}
