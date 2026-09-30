//! The search file published beside a Help value, encoded on this side.
//!
//! `openSearchIndex` in `packages/help/src/search-index.ts` reads it, and the
//! layout is described there. It is encoded here because on a large repository
//! the value is mostly its export list — every export of every file, 243,362
//! rows on Kibana — and handing that list to JavaScript as objects, pooling it
//! there and printing it as JSON was the whole cost of refreshing the value
//! after an edit. The rows `variance index` publishes are read off the chain and
//! never leave this side (`help_publish.rs`); a value JavaScript already holds
//! hands them across once.

// compass: variance-authority.report.agent-surface

use std::collections::{HashMap, HashSet};

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use regex::Regex;
use sha2::{Digest, Sha256};

use crate::help_usage::NamedExport;
use crate::order::code_unit;

const MAGIC: u32 = 0x5348_4156; // "VAHS", little-endian
const VERSION: u32 = 1;
const NONE: u32 = u32::MAX;
const USE_KINDS: [&str; 3] = ["source", "test", "story"];

/// The published rows of a Help value, a column per field, in `everyEntry` order.
#[napi(object)]
pub struct PublishedRows {
    pub name: Vec<String>,
    /// `specifierOf` of the row's package and opening.
    pub spec: Vec<String>,
    pub kind: Vec<String>,
    pub doc: Vec<Option<String>>,
    pub at: Vec<String>,
    pub used_by: Vec<u32>,
    pub uses: Vec<u32>,
    /// How many sites each row has; their files follow in `sites`, row by row.
    pub site_counts: Vec<u32>,
    pub sites: Vec<String>,
}

/// Which generation the search belongs to.
#[napi(object)]
pub struct SearchGeneration {
    pub root: String,
    pub graph_root: String,
    pub graph_digest: String,
    pub generated_at: String,
}

#[napi(object)]
pub struct EncodedSearch {
    pub bytes: Buffer,
    /// sha256 over the export list as a set of file, name, kind and type: what
    /// `sameSurface` compares, kept so a later refresh compares two digests.
    pub exported: String,
}

/// Encode the search over `published` and `exported`.
#[napi(catch_unwind)]
pub fn encode_search_index(published: PublishedRows, exported: Vec<NamedExport>, generation: Option<SearchGeneration>) -> EncodedSearch {
    let (bytes, digest) = encode(&published, &exported, generation.as_ref());
    EncodedSearch { bytes: bytes.into(), exported: digest }
}

#[derive(Default)]
struct Pool<'a> {
    ids: HashMap<&'a str, u32>,
    values: Vec<&'a str>,
}

impl<'a> Pool<'a> {
    fn id(&mut self, value: &'a str) -> (u32, bool) {
        if let Some(&id) = self.ids.get(value) {
            return (id, false);
        }
        let id = self.values.len() as u32;
        self.ids.insert(value, id);
        self.values.push(value);
        (id, true)
    }
}

/// The tokenizer and term rule `termsOf` gives the loose pass: short terms
/// dropped, counted in UTF-16 code units, the rest lowercased; once each.
fn terms_of(split: &Regex, text: &str) -> HashSet<String> {
    split.split(text).filter(|token| token.encode_utf16().nth(1).is_some()).map(str::to_lowercase).collect()
}

/// `joined`: strings as UTF-8 with a separator, and where each one starts.
fn joined<S: AsRef<str>>(values: &[S], separator: &str) -> (Vec<u32>, Vec<u8>) {
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
fn postings(lists: &[&[u32]]) -> (Vec<u32>, Vec<u32>) {
    let mut off = Vec::with_capacity(lists.len() + 1);
    let mut rows = Vec::new();
    for list in lists {
        off.push(rows.len() as u32);
        rows.extend_from_slice(list);
    }
    off.push(rows.len() as u32);
    (off, rows)
}

enum Section {
    Words(Vec<u32>),
    Bytes(Vec<u8>),
}

impl Section {
    fn bytes(&self) -> std::borrow::Cow<'_, [u8]> {
        match self {
            Section::Bytes(bytes) => bytes.into(),
            Section::Words(words) => words.iter().flat_map(|word| word.to_le_bytes()).collect::<Vec<u8>>().into(),
        }
    }
}

fn json(text: &str) -> String {
    serde_json::to_string(text).expect("a string prints")
}

pub(crate) fn encode(published: &PublishedRows, exported: &[NamedExport], generation: Option<&SearchGeneration>) -> (Vec<u8>, String) {
    let split = Regex::new(r"[\n\r\p{Z}\p{P}]+").expect("the pattern is fixed");
    let (mut strings, mut names) = (Pool::default(), Pool::default());
    let (mut name_string, mut name_pub, mut name_exp): (Vec<u32>, Vec<Vec<u32>>, Vec<Vec<u32>>) = Default::default();
    let mut by_term: HashMap<String, (Vec<u32>, Vec<u32>)> = HashMap::new();

    macro_rules! name_of {
        ($name:expr) => {{
            let (id, new) = names.id($name);
            if new {
                name_string.push(strings.id($name).0);
                name_pub.push(Vec::new());
                name_exp.push(Vec::new());
            }
            id
        }};
    }

    let rows = published.name.len();
    let (mut pub_name, mut pub_spec, mut pub_kind, mut pub_doc, mut pub_at) =
        (Vec::with_capacity(rows), Vec::with_capacity(rows), Vec::with_capacity(rows), Vec::with_capacity(rows), Vec::with_capacity(rows));
    let (mut sites_off, mut sites_at, mut doc_lower) = (vec![0u32], Vec::new(), Vec::with_capacity(rows));
    let mut site = 0usize;
    for row in 0..rows {
        let name = name_of!(published.name[row].as_str());
        name_pub[name as usize].push(row as u32);
        pub_name.push(name);
        pub_spec.push(strings.id(&published.spec[row]).0);
        pub_kind.push(strings.id(&published.kind[row]).0);
        let doc = published.doc[row].as_deref();
        pub_doc.push(doc.map_or(NONE, |doc| strings.id(doc).0));
        pub_at.push(strings.id(&published.at[row]).0);
        for at in &published.sites[site..site + published.site_counts[row] as usize] {
            sites_at.push(strings.id(at).0);
        }
        site += published.site_counts[row] as usize;
        sites_off.push(sites_at.len() as u32);
        doc_lower.push(doc.unwrap_or("").to_lowercase());
        if let Some(doc) = doc {
            for term in terms_of(&split, doc) {
                by_term.entry(term).or_default().1.push(row as u32);
            }
        }
    }

    let (mut exp_name, mut exp_at, mut exp_by, mut exp_line, mut exp_kind) =
        (Vec::with_capacity(exported.len()), Vec::with_capacity(exported.len()), Vec::with_capacity(exported.len()), Vec::with_capacity(exported.len()), Vec::with_capacity(exported.len()));
    for (row, named) in exported.iter().enumerate() {
        let name = name_of!(named.name.as_str());
        name_exp[name as usize].push(row as u32);
        exp_name.push(name);
        exp_at.push(strings.id(&named.at).0);
        exp_by.push(strings.id(&named.by).0);
        exp_line.push(named.line);
        exp_kind.push(USE_KINDS.iter().position(|kind| *kind == named.kind).map_or(u8::MAX, |at| at as u8));
    }

    for (id, name) in names.values.iter().enumerate() {
        for term in terms_of(&split, name) {
            by_term.entry(term).or_default().0.push(id as u32);
        }
    }
    let mut terms: Vec<&String> = by_term.keys().collect();
    terms.sort_unstable_by(|a, b| a.as_bytes().cmp(b.as_bytes()));

    let mut files: Vec<u32> = pub_at.iter().chain(&sites_at).chain(&exp_at).copied().collect::<HashSet<u32>>().into_iter().collect();
    files.sort_unstable_by(|&a, &b| strings.values[a as usize].as_bytes().cmp(strings.values[b as usize].as_bytes()));

    let mut order: Vec<u32> = (0..names.values.len() as u32).collect();
    order.sort_unstable_by(|&a, &b| code_unit(names.values[a as usize], names.values[b as usize]));
    let mut rank = vec![0u32; order.len()];
    for (at, &id) in order.iter().enumerate() {
        rank[id as usize] = at as u32;
    }

    let (strings_off, strings_blob) = joined(&strings.values, "");
    let lowered: Vec<String> = names.values.iter().map(|name| name.to_lowercase()).collect();
    let (lower_off, lower_blob) = joined(&lowered, "\0");
    let (doc_off, doc_blob) = joined(&doc_lower, "\0");
    let (terms_off, terms_blob) = joined(&terms, "");
    let lists = |lists: &[Vec<u32>]| postings(&lists.iter().map(Vec::as_slice).collect::<Vec<_>>());
    let (names_pub_off, names_pub) = lists(&name_pub);
    let (names_exp_off, names_exp) = lists(&name_exp);
    let (term_name_off, term_name) = postings(&terms.iter().map(|term| by_term[*term].0.as_slice()).collect::<Vec<_>>());
    let (term_pub_off, term_pub) = postings(&terms.iter().map(|term| by_term[*term].1.as_slice()).collect::<Vec<_>>());

    use Section::{Bytes, Words};
    let sections: Vec<(&str, Section)> = vec![
        ("strings.off", Words(strings_off)), ("strings.blob", Bytes(strings_blob)), ("files", Words(files)),
        ("names.name", Words(name_string)), ("names.rank", Words(rank)),
        ("names.lowerOff", Words(lower_off)), ("names.lower", Bytes(lower_blob)),
        ("names.pubOff", Words(names_pub_off)), ("names.pub", Words(names_pub)),
        ("names.expOff", Words(names_exp_off)), ("names.exp", Words(names_exp)),
        ("pub.name", Words(pub_name)), ("pub.spec", Words(pub_spec)), ("pub.kind", Words(pub_kind)), ("pub.doc", Words(pub_doc)),
        ("pub.at", Words(pub_at)), ("pub.usedBy", Words(published.used_by.clone())), ("pub.uses", Words(published.uses.clone())),
        ("pub.sitesOff", Words(sites_off)), ("sites.at", Words(sites_at)),
        ("pub.docLowerOff", Words(doc_off)), ("pub.docLower", Bytes(doc_blob)),
        ("exp.name", Words(exp_name)), ("exp.at", Words(exp_at)), ("exp.by", Words(exp_by)), ("exp.line", Words(exp_line)),
        ("exp.kind", Bytes(exp_kind)),
        ("terms.off", Words(terms_off)), ("terms.blob", Bytes(terms_blob)),
        ("terms.nameOff", Words(term_name_off)), ("terms.name", Words(term_name)),
        ("terms.pubOff", Words(term_pub_off)), ("terms.pub", Words(term_pub)),
    ];
    let bodies: Vec<std::borrow::Cow<[u8]>> = sections.iter().map(|(_, section)| section.bytes()).collect();

    // Offsets count from where the sections start, so the header's own length
    // never feeds back into what it says.
    let mut table = Vec::with_capacity(sections.len());
    let mut size = 0usize;
    for ((name, _), body) in sections.iter().zip(&bodies) {
        table.push(format!("{}:[{size},{}]", json(name), body.len()));
        size = align(size + body.len());
    }
    let generation = generation.map_or("null".to_owned(), |held| {
        format!(
            "{{\"root\":{},\"graphRoot\":{},\"graphDigest\":{},\"generatedAt\":{}}}",
            json(&held.root), json(&held.graph_root), json(&held.graph_digest), json(&held.generated_at)
        )
    });
    let head = format!("{{\"generation\":{generation},\"sections\":{{{}}}}}", table.join(","));
    let start = align(12 + head.len());
    let mut out = vec![0u8; start + size];
    out[0..4].copy_from_slice(&MAGIC.to_le_bytes());
    out[4..8].copy_from_slice(&VERSION.to_le_bytes());
    out[8..12].copy_from_slice(&(head.len() as u32).to_le_bytes());
    out[12..12 + head.len()].copy_from_slice(head.as_bytes());
    let mut at = start;
    for body in &bodies {
        out[at..at + body.len()].copy_from_slice(body);
        at = start + align(at - start + body.len());
    }
    (out, exported_digest(exported))
}

fn align(at: usize) -> usize {
    (at + 3) & !3
}

/// The export list as a set: each row's file, name, kind and type, in byte
/// order, once.
pub(crate) fn exported_digest(exported: &[NamedExport]) -> String {
    let mut keys: Vec<String> =
        exported.iter().map(|named| format!("{}\0{}\0{}\0{}", named.at, named.name, named.kind, u8::from(named.r#type))).collect();
    keys.sort_unstable();
    keys.dedup();
    let mut digest = Sha256::new();
    for key in &keys {
        digest.update(key.as_bytes());
        digest.update(b"\n");
    }
    digest.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}
