//! The rows of one layer a name question can match, found by scanning the
//! layer's name table, not by decoding a row.
//!
//! A candidate is a row whose lowered name, or whose doc's lowered words,
//! hold the text the question cannot match without: `Containing`'s query or
//! the first stem of its phrase, `Described`'s stems, `Exact`'s name. That
//! text is a necessary condition of a match, never a sufficient one, so a
//! candidate is matched again as before and every other row is passed over
//! unread. A row whose doc the writer could not cut is always a candidate,
//! and is read from its file as it was. `Terms` cuts names into terms the
//! table does not hold, so it reads every symbol, as it did.
//!
//! Rust lowers a capital sigma by what stands beside it, so a stem lowered
//! alone can differ from the same word lowered in its sentence: a needle that
//! holds a sigma passes every row, rather than miss one.

// compass: variance-authority.report.agent-surface

use std::borrow::Cow;

use crate::compact::Layer;
use crate::help_declared::Matching;
use crate::name_table::{row_of, Doc, Item, Scope, UNKNOWN_TEXT};

/// The rows of one table that are candidates; every row when `None`.
pub(crate) struct Rows(Option<Vec<bool>>);

impl Rows {
    fn has(&self, at: usize) -> bool {
        self.0.as_ref().is_none_or(|rows| rows[at])
    }
}

/// One layer's candidates: its parse rows, and the rows of each table a parse holds.
pub(crate) struct Candidates {
    parses: Rows,
    symbols: Rows,
    nested: Rows,
    members: Rows,
}

impl Candidates {
    /// Whether the parse at `row` holds a candidate, or is one by its own doc.
    pub(crate) fn parse(&self, row: usize) -> bool {
        self.parses.has(row)
    }

    pub(crate) fn symbol(&self, at: usize) -> bool {
        self.symbols.has(at)
    }

    pub(crate) fn nested(&self, at: usize) -> bool {
        self.nested.has(at)
    }

    pub(crate) fn member(&self, at: usize) -> bool {
        self.members.has(at)
    }
}

/// Whether text lowered alone is lowered the same inside any longer text.
pub(crate) fn sure(text: &str) -> bool {
    !text.contains(['Σ', 'σ', 'ς'])
}

/// What one table is scanned for: `None` passes every row, and no needle passes none.
type Needles = Option<Vec<(String, Scope)>>;

/// The candidates of `layer` for `query` asked by `matching`, with `run`, the
/// phrase `Containing` asks of a doc when the question holds one.
pub(crate) fn candidates(layer: &Layer, query: &str, matching: &Matching, run: Option<&[(u32, String)]>) -> Candidates {
    // The table writes a marker byte inside a name as a stand-in, so a question holding one passes every row.
    if crate::name_table::marked(query) {
        return Candidates { parses: Rows(None), symbols: Rows(None), nested: Rows(None), members: Rows(None) };
    }
    let unknown = || (UNKNOWN_TEXT.to_owned(), Scope::Entry);
    let (module, symbols, nested, members): (Needles, Needles, Needles, Needles) = match matching {
        Matching::Exact => {
            let name = sure(query).then(|| vec![(query.to_lowercase(), Scope::Name)]);
            (Some(Vec::new()), name.clone(), name, Some(Vec::new()))
        }
        Matching::Containing => {
            let first = run.and_then(|run| run.first()).map(|(_, stem)| stem.as_str());
            let mut docs = vec![(query.to_owned(), Scope::Entry), unknown()];
            docs.extend(first.map(|stem| (stem.to_owned(), Scope::Entry)));
            let docs = first.is_none_or(sure).then_some(docs);
            let members = docs.clone().map(|mut members| {
                members.extend(query.rsplit_once('.').map(|(_, asked)| (asked.to_owned(), Scope::Name)));
                members
            });
            (Some(Vec::new()), docs, Some(vec![(query.to_owned(), Scope::Name)]), members)
        }
        Matching::Described { stems, .. } => {
            let docs = stems.iter().all(|stem| sure(stem)).then(|| {
                stems.iter().map(|stem| (stem.clone(), Scope::Entry)).chain([unknown()]).collect::<Vec<_>>()
            });
            (docs.clone(), docs, Some(Vec::new()), Some(Vec::new()))
        }
        Matching::Terms { .. } => (Some(Vec::new()), None, Some(Vec::new()), Some(Vec::new())),
    };
    let parses = &layer.parses;
    let scan = |item: Item, needles: Needles| {
        Rows(needles.map(|needles| {
            let names = &parses.names[item as usize];
            let mut rows = vec![false; names.rows()];
            for (needle, scope) in &needles {
                for row in names.holding(needle, *scope) {
                    rows[row] = true;
                }
            }
            rows
        }))
    };
    let (module, symbols, nested, members) =
        (scan(Item::Module, module), scan(Item::Symbol, symbols), scan(Item::Nested, nested), scan(Item::Member, members));
    let rows = parses.key.len();
    let mut held = module.0;
    for (children, off) in [(&symbols, parses.symbols), (&nested, parses.nested), (&members, parses.member_declarations)] {
        match (&mut held, &children.0) {
            (Some(held), Some(children)) => {
                for at in (0..children.len()).filter(|&at| children[at]) {
                    held[row_of(off, rows, at)] = true;
                }
            }
            _ => held = None,
        }
    }
    Candidates { parses: Rows(held), symbols, nested, members }
}

/// The file as UTF-16, read once, and only when a doc is the one thing left to match.
fn source_of<'s>(source: &'s mut Option<Option<Vec<u16>>>, root: &str, file: &str) -> Option<&'s [u16]> {
    source
        .get_or_insert_with(|| std::fs::read_to_string(std::path::Path::new(root).join(file)).ok().map(|text| text.encode_utf16().collect()))
        .as_deref()
}

/// A doc comment as written, which `near` and `writes_run` read by paragraph,
/// and as words, its lines joined by single spaces and lowercased, so text
/// typed across a line break still matches.
struct Prose { written: String, words: String }

fn prose(source: &[u16], start: u32, end: u32) -> Option<Prose> {
    let written = crate::dependency_namespace::doc(source, Some(crate::harvest::TextSpan { start, end }))?;
    let words = crate::name_table::words_of(&written);
    Some(Prose { written, words })
}

/// A doc's words, as the name table holds them, and its text as written,
/// read from the file only when a phrase is asked of it. A doc the table
/// does not hold the words of is read whole, as before.
pub(crate) struct Said<'a> {
    pub(crate) words: Cow<'a, str>,
    written: Option<Option<String>>,
    span: Option<(u32, u32)>,
}

impl<'a> Said<'a> {
    pub(crate) fn of(doc: Doc<'a>, (start, end): (Option<u32>, Option<u32>), source: &mut Option<Option<Vec<u16>>>, root: &str, file: &str) -> Option<Self> {
        let span = start.zip(end);
        match doc {
            Doc::Absent => None,
            Doc::Words(words) => Some(Said { words: Cow::Borrowed(words), written: None, span }),
            Doc::Unknown => {
                let prose = source_of(source, root, file).and_then(|source| prose(source, start?, end?))?;
                Some(Said { words: Cow::Owned(prose.words), written: Some(Some(prose.written)), span })
            }
        }
    }

    pub(crate) fn written(&mut self, source: &mut Option<Option<Vec<u16>>>, root: &str, file: &str) -> Option<&str> {
        let span = self.span;
        self.written
            .get_or_insert_with(|| {
                let (start, end) = span?;
                source_of(source, root, file).and_then(|source| crate::dependency_namespace::doc(source, Some(crate::harvest::TextSpan { start, end })))
            })
            .as_deref()
    }

    /// Whether every one of `stems` can be in the words: a phrase that needs a stem the words lack is not read for.
    pub(crate) fn may_hold<'s>(&self, mut stems: impl Iterator<Item = &'s str>) -> bool {
        stems.all(|stem| !sure(stem) || self.words.contains(stem))
    }
}
