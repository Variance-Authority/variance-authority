//! Name, declaration and file rows reached by the words of a description.

// compass: variance-authority.report.agent-surface

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use crate::compact::Layer;
use crate::dependency_lexicon::purposes::near;
use crate::help_declared::{declared, DeclaredName, DescribedFile, Matching};
use crate::help_search_matches::{postings, stems_in};
use crate::help_symbol_rows::Rows;
use crate::order::code_unit;
use crate::rarity::{rarity, saturation};

#[derive(Clone, Copy, Eq, Hash, PartialEq, Ord, PartialOrd)]
pub(crate) enum Kind { Published, Exported }

impl Kind {
    fn columns(self) -> (&'static str, &'static str, &'static str, &'static str, &'static str, &'static str) {
        match self {
            Self::Published => ("pub.name", "terms.pubOff", "terms.pub", "terms.pubSigOff", "terms.pubSig", "pub.docLowerOff"),
            Self::Exported => ("exp.name", "terms.expOff", "terms.exp", "terms.expSigOff", "terms.expSig", "exp.docLowerOff"),
        }
    }
    fn doc(self) -> &'static str {
        match self { Self::Published => "pub.doc", Self::Exported => "exp.doc" }
    }
}

#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) struct IndexedRow { pub kind: Kind, pub row: usize }

pub(crate) enum Row {
    Indexed(IndexedRow),
    Private(DeclaredName),
    File(DescribedFile),
}

type Words = BTreeSet<usize>;

struct Pick {
    row: Row,
    words: Words,
    named: Words,
    signed: Words,
    doc_length: Option<usize>,
    phrase: u32,
}

struct Candidate {
    rank: usize,
    picks: Vec<Pick>,
    holds: Words,
}

pub(crate) struct Hit {
    pub row: Row,
    pub words: Vec<String>,
}

#[derive(Default)]
pub(crate) struct Described {
    pub total: usize,
    pub shown: Vec<Hit>,
    pub names: BTreeSet<usize>,
    pub private: HashSet<(String, u32, String)>,
}

pub(crate) fn described(
    root: &str,
    rows: &Rows,
    layers: &[Layer],
    query: &str,
    words: &BTreeMap<String, String>,
    files: Option<&[String]>,
    already: &BTreeSet<usize>,
    visible_private: &HashSet<(&str, u32, &str)>,
    cap: usize,
    row_order: impl Fn(IndexedRow, IndexedRow) -> Ordering,
) -> Option<Described> {
    if words.is_empty() { return Some(Described::default()) }
    let stems: Vec<_> = words.keys().cloned().collect();
    let written: Vec<_> = words.values().map(String::as_str).collect();
    let terms = stems_in(rows, &stems)?;
    let candidates = candidates(root, rows, layers, query, &stems, &terms, files, already)?;
    let all = if files.is_some() {
        Some(candidates_for_all(root, rows, layers, query, &stems, &terms, already)?)
    } else { None };
    let everywhere = all.as_deref().unwrap_or(&candidates);
    let widest = rows.column("names.name").len().max(everywhere.len());
    let carried = weights(everywhere, &written, widest);
    let whole: f64 = carried.rare.iter().sum();
    let weight = weights(&candidates, &written, candidates.len());

    let mut possible = Vec::new();
    let mut claimed = Described::default();
    for candidate in candidates {
        let count = candidate.picks.len();
        let mut picks = candidate.picks.into_iter().filter(|pick| {
            2.0 * carried.covered(&pick.words) >= whole
        }).collect::<Vec<_>>();
        picks.sort_by(|a, b| weight.score(b).total_cmp(&weight.score(a)).then_with(|| match (&a.row, &b.row) {
            (Row::Indexed(a), Row::Indexed(b)) => row_order(*a, *b),
            _ => Ordering::Equal,
        }));
        let Some(first) = picks.first() else { continue };
        if let Row::Private(decl) = &first.row {
            if visible_private.contains(&(decl.at.as_str(), decl.line, decl.name.as_str())) { continue }
            claimed.private.insert((decl.at.clone(), decl.line, decl.name.clone()));
        }
        if candidate.rank != usize::MAX { claimed.names.insert(candidate.rank); }
        let best = weight.score(first);
        picks = picks.into_iter().enumerate().filter(|(at, pick)| *at == 0 || (pick.doc_length.is_some() && weight.score(pick) == best)).map(|(_, pick)| pick).collect();
        possible.push((candidate.rank, count, picks));
    }
    let total = possible.len();
    // Find the levels that can be shown. Tied printed rows and the best
    // holders of each word are the only ones that need a document for proximity.
    let level = |a: &(usize, usize, Vec<Pick>), b: &(usize, usize, Vec<Pick>)| {
        weight.score(&b.2[0]).total_cmp(&weight.score(&a.2[0])).then(b.2[0].named.len().cmp(&a.2[0].named.len()))
    };
    possible.sort_by(level);
    let mut read = BTreeSet::new();
    for at in 0..possible.len().min(cap) {
        let one = &possible[at];
        read.extend(at..at + possible[at..].partition_point(|other| level(one, other).is_eq()));
    }
    for word in 0..written.len() {
        let holds = |one: &(usize, usize, Vec<Pick>)| one.2.iter().any(|pick| says(pick, word, &written));
        if let Some(best) = possible.iter().position(holds) {
            let one = &possible[best];
            for (at, row) in possible[best..].iter().take_while(|other| level(one, other).is_eq()).enumerate() {
                if holds(row) { read.insert(best + at); }
            }
        }
    }
    let mut ranked = Vec::new();
    for (at, (rank, count, mut picks)) in possible.into_iter().enumerate() {
        if !read.contains(&at) { continue }
        for pick in &mut picks {
            if let Row::Indexed(held) = &pick.row {
                if written.len() > 1 {
                    pick.phrase = rows.optional(held.kind.doc(), held.row)?.map_or(0, |doc| near(query, doc));
                }
            }
        }
        let at = picks.iter().enumerate().max_by_key(|(at, pick)| (pick.phrase, std::cmp::Reverse(*at)))?.0;
        let pick = picks.swap_remove(at);
        ranked.push((rank, count, pick));
    }
    let order = |a: &(usize, usize, Pick), b: &(usize, usize, Pick)| {
        weight.score(&b.2).total_cmp(&weight.score(&a.2)).then(b.2.named.len().cmp(&a.2.named.len()))
            .then(b.2.phrase.cmp(&a.2.phrase)).then(b.1.cmp(&a.1)).then(a.0.cmp(&b.0))
            .then_with(|| tail_order(&a.2.row, &b.2.row))
    };
    ranked.sort_by(order);
    let mut shown: Vec<_> = (0..ranked.len().min(cap)).collect();
    for word in 0..written.len() {
        if shown.iter().any(|&at| says(&ranked[at].2, word, &written)) { continue }
        let holder = ranked.iter().position(|one| says(&one.2, word, &written));
        let gives = shown.iter().rposition(|&at| ranked[at].2.words.iter().all(|&held| {
            !says(&ranked[at].2, held, &written) || shown.iter().any(|&other| at != other && says(&ranked[other].2, held, &written))
        }));
        if let (Some(holder), Some(gives)) = (holder, gives) {
            shown.remove(gives);
            shown.push(holder);
        }
    }
    shown.sort_unstable();
    let mut shown = shown.into_iter().peekable();
    let hits = ranked.into_iter().enumerate().filter_map(|(at, (_, _, pick))| {
        if shown.peek() != Some(&at) { return None }
        shown.next();
        Some(Hit { row: pick.row, words: pick.words.into_iter().map(|word| written[word].to_owned()).collect() })
    }).collect();
    claimed.total = total;
    claimed.shown = hits;
    Some(claimed)
}

fn candidates_for_all(root: &str, rows: &Rows, layers: &[Layer], query: &str, stems: &[String], terms: &[Vec<usize>], already: &BTreeSet<usize>) -> Option<Vec<Candidate>> {
    candidates(root, rows, layers, query, stems, terms, None, already)
}

fn candidates(root: &str, rows: &Rows, layers: &[Layer], query: &str, stems: &[String], terms: &[Vec<usize>], files: Option<&[String]>, already: &BTreeSet<usize>) -> Option<Vec<Candidate>> {
    let files_set = files.map(|files| files.iter().map(String::as_str).collect::<HashSet<_>>());
    let admits = |kind, row| match (&files_set, kind) {
        (None, _) => true,
        (Some(files), Kind::Published) => rows.range("pub.sitesOff", row).is_some_and(|mut sites| sites.any(|site| rows.string("use.at", site).is_some_and(|file| files.contains(file)))),
        (Some(files), Kind::Exported) => rows.string("exp.at", row).is_some_and(|file| files.contains(file)),
    };
    let mut names = BTreeMap::<usize, Words>::new();
    let mut docs = HashMap::<IndexedRow, Words>::new();
    let mut signatures = HashMap::<IndexedRow, Words>::new();
    let mut reached = BTreeSet::new();
    for (word, terms) in terms.iter().enumerate() {
        for &term in terms {
            for name in postings(rows, "terms.nameOff", "terms.name", term)? {
                if already.contains(&name) { continue }
                reached.insert(name);
                names.entry(name).or_default().insert(word);
            }
            for kind in [Kind::Published, Kind::Exported] {
                let (name_col, doc_off, doc_values, sig_off, sig_values, _) = kind.columns();
                for row in postings(rows, doc_off, doc_values, term)? {
                    let name = rows.number(name_col, row)? as usize;
                    if already.contains(&name) || !admits(kind, row) { continue }
                    reached.insert(name);
                    docs.entry(IndexedRow { kind, row }).or_default().insert(word);
                }
                for row in postings(rows, sig_off, sig_values, term)? {
                    signatures.entry(IndexedRow { kind, row }).or_default().insert(word);
                }
            }
        }
    }
    let mut found = Vec::new();
    for name in reached {
        let named = names.remove(&name).unwrap_or_default();
        let mut picks = Vec::new();
        for (kind, offsets, values) in [
            (Kind::Published, "names.pubOff", "names.pub"), (Kind::Exported, "names.expOff", "names.exp"),
        ] {
            for row in postings(rows, offsets, values, name)? {
                if !admits(kind, row) { continue }
                let held = IndexedRow { kind, row };
                let mut words = named.clone();
                words.extend(docs.remove(&held).unwrap_or_default());
                let signed: Words = signatures.remove(&held).unwrap_or_default().difference(&words).copied().collect();
                words.extend(&signed);
                let doc_length = if rows.optional(kind.doc(), row)?.is_some() {
                    Some(rows.range(kind.columns().5, row)?.len().saturating_sub(1))
                } else { None };
                picks.push(Pick { row: Row::Indexed(held), words, named: named.clone(), signed, doc_length, phrase: 0 });
            }
        }
        if !picks.is_empty() {
            let holds = picks.iter().flat_map(|pick| pick.words.iter().copied()).collect();
            found.push(Candidate { rank: name, picks, holds });
        }
    }

    let read = declared(root, layers, query, Matching::Described { stems: stems.to_vec(), query: query.to_owned() }, files);
    for one in read.names {
        let words = positions(one.held.as_deref().unwrap_or_default());
        let pick = Pick { words: words.clone(), named: positions(one.named.as_deref().unwrap_or_default()), signed: Words::new(), doc_length: one.doc_length.map(|length| length as usize), phrase: one.near.unwrap_or(0), row: Row::Private(one) };
        found.push(Candidate { rank: usize::MAX, picks: vec![pick], holds: words });
    }
    for one in read.files {
        let words = positions(&one.held);
        let pick = Pick { words: words.clone(), named: positions(&one.named), signed: Words::new(), doc_length: one.doc_length.map(|length| length as usize), phrase: one.near, row: Row::File(one) };
        found.push(Candidate { rank: usize::MAX, picks: vec![pick], holds: words });
    }
    Some(found)
}

fn positions(words: &[u32]) -> Words { words.iter().map(|&word| word as usize).collect() }

fn says(pick: &Pick, word: usize, written: &[&str]) -> bool {
    pick.words.iter().any(|&at| written[at] == written[word]) && !pick.signed.iter().any(|&at| written[at] == written[word])
}

struct Weights<'a> {
    rare: Vec<f64>,
    written: &'a [&'a str],
    bytes: usize,
    docs: usize,
}

impl Weights<'_> {
    fn covered(&self, words: &Words) -> f64 { words.iter().map(|&word| self.rare[word]).sum() }

    fn score(&self, pick: &Pick) -> f64 {
        let doc = pick.doc_length.map_or(1000.0, |length| saturation(1.0, length as f64, self.bytes as f64, self.docs as f64).min(1000.0));
        self.covered(&pick.words) * pick.words.iter().map(|&word| {
            let field = if pick.named.iter().any(|&at| self.written[at] == self.written[word]) { 3000.0 }
                else if pick.signed.iter().any(|&at| self.written[at] == self.written[word]) { 500.0 }
                else { 2.0 * doc };
            self.rare[word] * field
        }).sum::<f64>()
    }
}

fn weights<'a>(found: &[Candidate], written: &'a [&'a str], population: usize) -> Weights<'a> {
    let mut holders = HashMap::new();
    let (mut bytes, mut docs) = (0, 0);
    for one in found {
        for &word in &one.holds { *holders.entry(written[word]).or_insert(0) += 1; }
        for length in one.picks.iter().filter_map(|pick| pick.doc_length).filter(|&length| length > 0) {
            bytes += length;
            docs += 1;
        }
    }
    let rare = written.iter().map(|word| rarity(population as f64, *holders.get(word).unwrap_or(&0) as f64)).collect();
    Weights { rare, written, bytes, docs }
}

fn tail_order(a: &Row, b: &Row) -> Ordering {
    let kind = |row: &Row| match row { Row::Indexed(_) => 0, Row::Private(_) => 1, Row::File(_) => 2 };
    kind(a).cmp(&kind(b)).then_with(|| match (a, b) {
        (Row::Private(a), Row::Private(b)) => code_unit(&a.at, &b.at).then(a.line.cmp(&b.line)).then_with(|| code_unit(&a.name, &b.name)),
        (Row::File(a), Row::File(b)) => code_unit(&a.at, &b.at),
        _ => Ordering::Equal,
    })
}
