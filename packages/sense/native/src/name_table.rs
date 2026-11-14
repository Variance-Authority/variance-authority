//! The name table: every name a parse declares, lowered, with the words of its
//! doc comment, as one text column per table a segment holds them in.
//!
//! A question about a name — `ask search`, `ask symbol` — asked every parse of
//! the chain for its declarations and read each doc comment off the disk to
//! match it, so on a repository the size of Kibana the answer cost seconds that
//! `git grep` did not. A name and its doc are fixed by the bytes they were read
//! from, the same as the rest of a parse row, so they are written beside it
//! when the row is, and a question scans the column for its text instead of
//! decoding a row: the rows that hold it are the only ones read. ctags answers
//! a name from a table written at index time the same way, and Sourcegraph's
//! symbol search scans a lowered name column.
//!
//! Each table — the parse rows themselves (the module and its doc), their
//! top-level symbols, the functions their functions declare, and their member
//! declarations — is one UTF-8 column of entries and its offsets, row for row
//! with the table it names. An entry is the name lowered, then, when the row
//! has a doc span: a `0x00` and the doc's words, lowered and joined by single
//! spaces, or a `0x01` when the writer did not hold the source the span is in
//! (a parse JavaScript handed over), which leaves the doc to be read from the
//! file. No name or word holds either byte, so a scan for text never matches
//! one by accident.

// compass: variance-authority.reach.source-index

use memchr::memmem;

use crate::read::Read;
use crate::segment::{u32s, u8s, Column};
use crate::stored::{Stored, U32s};

/// One table a name is declared in, in the order its sections are written.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Item {
    /// The parse row itself: a module, named by its file, with its own doc.
    Module,
    Symbol,
    Nested,
    Member,
}

/// The section names of each table's entries and offsets.
const SECTIONS: [(&str, &str); 4] = [
    ("names.parses", "names.parses-off"),
    ("names.symbols", "names.symbols-off"),
    ("names.nested", "names.nested-off"),
    ("names.member-declarations", "names.member-declarations-off"),
];

const WORDS: u8 = 0x00;
const UNKNOWN: u8 = 0x01;
/// [`UNKNOWN`] as text to scan for: the rows it is in are the ones whose doc is read from the file.
pub(crate) const UNKNOWN_TEXT: &str = "\u{1}";

/// A doc comment as the table holds it: its words, lowered and joined by
/// single spaces, so text typed across a line break still matches.
pub(crate) fn words_of(written: &str) -> String {
    written.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// The words of every doc comment a read spans, cut from the source it was
/// read from, while that source is still held. `held` is false for a read
/// that was not worded — one carried through JavaScript — whose docs are
/// unknown, not absent.
#[derive(Clone, Debug, Default)]
pub(crate) struct Words {
    held: bool,
    items: [Vec<Option<String>>; 4],
}

impl Words {
    /// The words of the doc of the `at`-th row of `item`: `None` when they
    /// were not held, and `Some(None)` when the row writes no doc.
    pub(crate) fn at(&self, item: Item, at: usize) -> Option<Option<&str>> {
        self.held.then(|| self.items[item as usize].get(at).and_then(Option::as_deref))
    }
}

impl Read {
    /// The read with the words of its docs, cut from `source`, the text it was read from.
    pub(crate) fn worded(mut self, source: &str) -> Self {
        let spans: [Vec<Option<crate::harvest::TextSpan>>; 4] = [
            vec![self.doc],
            self.symbols.iter().map(|symbol| symbol.doc).collect(),
            self.nested.iter().map(|nested| nested.doc).collect(),
            self.member_declarations.iter().map(|member| member.doc).collect(),
        ];
        // Doc spans are in UTF-16 units, so the source is encoded once, and only when one is written.
        let utf16: Vec<u16> = if spans.iter().flatten().any(Option::is_some) { source.encode_utf16().collect() } else { Vec::new() };
        let items = spans.map(|spans| {
            spans.into_iter().map(|span| span.and_then(|span| crate::dependency_namespace::doc(&utf16, Some(span))).map(|doc| words_of(&doc))).collect()
        });
        self.words = Words { held: true, items };
        self
    }
}

/// One table's column as it is written.
pub(crate) struct NameColumn {
    text: Vec<u8>,
    off: Vec<u32>,
}

impl Default for NameColumn {
    fn default() -> Self {
        NameColumn { text: Vec::new(), off: vec![0] }
    }
}

impl NameColumn {
    /// One row: its name, whether it spans a doc, and that doc's words when
    /// the writer held them — `Some(None)` for a span that holds no words.
    pub(crate) fn push(&mut self, name: &str, doc: bool, words: Option<Option<&str>>) {
        self.text.extend_from_slice(name.to_lowercase().as_bytes());
        match (doc, words) {
            (false, _) | (true, Some(None)) => {}
            (true, Some(Some(words))) => {
                self.text.push(WORDS);
                self.text.extend_from_slice(words.as_bytes());
            }
            (true, None) => self.text.push(UNKNOWN),
        }
        self.off.push(self.text.len() as u32);
    }

    /// The four tables' columns, in [`Item`]'s order.
    pub(crate) fn columns(tables: [NameColumn; 4]) -> Vec<Column> {
        tables
            .into_iter()
            .zip(SECTIONS)
            .flat_map(|(table, (text, off))| [u8s(text, table.text), u32s(off, table.off)])
            .collect()
    }
}

/// A doc as one entry holds it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Doc<'a> {
    Absent,
    Words(&'a str),
    /// Spanned, but the writer did not hold its source: read it from the file.
    Unknown,
}

/// Where a scan for text counts a hit.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Scope {
    /// Inside the lowered name.
    Name,
    /// Anywhere in the entry: the name or the doc's words.
    Entry,
}

/// One table's column, read in place.
#[derive(Clone, Copy)]
pub(crate) struct Names<'a> {
    text: &'a [u8],
    off: U32s<'a>,
}

impl<'a> Names<'a> {
    /// The table of `item` over its `rows`, checked so that every entry lies in the column.
    pub(crate) fn open(stored: &Stored<'a>, item: Item, rows: usize) -> Result<Self, String> {
        let (text, off) = SECTIONS[item as usize];
        let text = stored.u8s(text)?;
        if std::str::from_utf8(text).is_err() {
            return Err(format!("section {} is not UTF-8", SECTIONS[item as usize].0));
        }
        let off = stored.offsets(off, rows, text.len())?;
        Ok(Names { text, off })
    }

    /// How many rows the table holds.
    pub(crate) fn rows(&self) -> usize {
        self.off.len() - 1
    }

    fn entry(&self, row: usize) -> &'a [u8] {
        &self.text[self.off.range(row)]
    }

    /// Where the name of an entry ends: at its doc's marker, or its end.
    fn name_end(entry: &[u8]) -> usize {
        memchr::memchr2(WORDS, UNKNOWN, entry).unwrap_or(entry.len())
    }

    /// The doc of `row`, as the table holds it.
    pub(crate) fn doc(&self, row: usize) -> Doc<'a> {
        let entry = self.entry(row);
        let end = Self::name_end(entry);
        match entry.get(end) {
            None => Doc::Absent,
            Some(&UNKNOWN) => Doc::Unknown,
            // The column was checked as UTF-8 and the marker is one byte of it, so what follows is too.
            Some(_) => Doc::Words(std::str::from_utf8(&entry[end + 1..]).unwrap_or_default()),
        }
    }

    /// The rows whose entry holds `needle` in `scope`, ascending. A hit that
    /// runs across the end of an entry is not one, and the scan goes on from
    /// the next entry, so a row is listed once.
    pub(crate) fn holding(&self, needle: &str, scope: Scope) -> Vec<usize> {
        let rows = self.rows();
        let needle = needle.as_bytes();
        let mut found = Vec::new();
        if needle.is_empty() {
            return (0..rows).collect();
        }
        let finder = memmem::Finder::new(needle);
        let mut from = 0;
        while let Some(hit) = finder.find(&self.text[from..]) {
            let at = from + hit;
            let row = row_of(self.off, rows, at);
            let (start, end) = (self.off.at(row) as usize, self.off.at(row + 1) as usize);
            let limit = match scope {
                Scope::Entry => end,
                Scope::Name => start + Self::name_end(&self.text[start..end]),
            };
            if at + needle.len() <= limit {
                found.push(row);
            }
            from = end;
        }
        found
    }
}

/// The row of an offset column over `rows` whose span holds `at`: the count
/// of rows that end at or before it.
pub(crate) fn row_of(off: U32s, rows: usize, at: usize) -> usize {
    let (mut low, mut high) = (0, rows);
    while low < high {
        let middle = (low + high) / 2;
        if (off.at(middle + 1) as usize) <= at { low = middle + 1 } else { high = middle }
    }
    low
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(rows: &[(&str, bool, Option<Option<&str>>)]) -> Vec<u8> {
        let mut columns = std::array::from_fn::<NameColumn, 4, _>(|_| NameColumn::default());
        for (name, doc, words) in rows {
            columns[1].push(name, *doc, *words);
        }
        let mut all = vec![u8s("strings.blob", Vec::new()), u32s("strings.off", vec![0])];
        all.extend(NameColumn::columns(columns));
        crate::segment::encode(all)
    }

    #[test]
    fn a_scan_lists_each_row_that_holds_the_text_once_and_never_across_entries() {
        let bytes = table(&[
            ("mountApp", true, Some(Some("mounts the app"))),
            ("unmount", false, None),
            ("ab", false, None),
            ("cd", true, None),
            ("Start", true, Some(None)),
        ]);
        let stored = Stored::open(&bytes).unwrap();
        let names = Names::open(&stored, Item::Symbol, 5).unwrap();
        assert_eq!(names.holding("mount", Scope::Entry), vec![0, 1]);
        assert_eq!(names.holding("the app", Scope::Entry), vec![0]);
        assert_eq!(names.holding("the app", Scope::Name), Vec::<usize>::new());
        assert_eq!(names.holding("bc", Scope::Entry), Vec::<usize>::new());
        assert_eq!(names.holding("start", Scope::Name), vec![4]);
        assert_eq!(
            (0..5).map(|row| names.doc(row)).collect::<Vec<_>>(),
            vec![Doc::Words("mounts the app"), Doc::Absent, Doc::Absent, Doc::Unknown, Doc::Absent]
        );
    }
}
