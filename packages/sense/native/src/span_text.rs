//! The text the index keeps of a read: every span's slice, and the line each
//! export and each member declaration is written on, cut from the source the
//! read held, so no answer reads the file again to print them.
//!
//! A span is in UTF-16 units, as JavaScript slices a string, and its slice is
//! kept raw: inside a doc's marks and up to where a declaration's body opens,
//! with nothing trimmed. A slice that ends inside a surrogate pair keeps its
//! half as U+FFFD, the character Node prints for it. A line runs from its
//! start to its `\n`, one `\r` before it dropped, as `split(/\r?\n/)` cuts it.
//! What a reader prints is cut from these by [`crate::text_cut`].

// compass: variance-authority.reach.source-index

use crate::harvest::TextSpan;
use std::cell::RefCell;
use std::sync::Arc;
use rustc_hash::FxHashMap;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Cut {
    Span(u32, u32),
    Line(u32),
}

/// A source as the spans and lines of its read address it.
pub(crate) struct Source<'a> {
    source: &'a str,
    /// The source in UTF-16 units; absent for ASCII, whose bytes are its units.
    utf16: Option<Vec<u16>>,
    /// The byte each line starts at, the first line first.
    starts: &'a [usize],
    /// Many exports or members can name one statement or line, including a
    /// whole minified file. Their facts share that cut for the read's life.
    texts: RefCell<FxHashMap<Cut, Arc<str>>>,
}

impl<'a> Source<'a> {
    /// `starts` are the bytes `source`'s lines start at, as [`crate::read::Lines`] holds them.
    pub(crate) fn new(source: &'a str, starts: &'a [usize]) -> Self {
        let utf16 = (!source.is_ascii()).then(|| source.encode_utf16().collect());
        Source { source, utf16, starts, texts: RefCell::new(FxHashMap::default()) }
    }

    /// What `start..end` spans, clamped as `String.prototype.slice` clamps it.
    fn slice(&self, start: u32, end: u32) -> Arc<str> {
        let length = self.utf16.as_ref().map_or(self.source.len(), Vec::len);
        let end = (end as usize).min(length);
        let start = (start as usize).min(end);
        self.shared(Cut::Span(start as u32, end as u32), || match &self.utf16 {
            None => Arc::from(&self.source[start..end]),
            Some(units) => Arc::from(String::from_utf16_lossy(&units[start..end])),
        })
    }

    fn shared(&self, cut: Cut, text: impl FnOnce() -> Arc<str>) -> Arc<str> {
        Arc::clone(self.texts.borrow_mut().entry(cut).or_insert_with(text))
    }

    /// `span` with its slice; nothing when there is no span.
    pub(crate) fn text(&self, span: &mut Option<TextSpan>) {
        if let Some(span) = span {
            self.fill(span);
        }
    }

    pub(crate) fn fill(&self, span: &mut TextSpan) {
        span.text = Some(self.slice(span.start, span.end));
    }

    /// The text of the 1-based `line`; nothing for a line the source does not hold.
    pub(crate) fn line(&self, line: u32) -> Option<Arc<str>> {
        let start = *self.starts.get((line as usize).checked_sub(1)?)?;
        let rest = self.source.get(start..)?;
        Some(self.shared(Cut::Line(line), || {
            let line = rest.split_once('\n').map_or(rest, |(line, _)| line);
            Arc::from(line.strip_suffix('\r').unwrap_or(line))
        }))
    }

    /// Keep declaration text once for either module consumer.
    pub(crate) fn symbols(&self, symbols: &mut [crate::harvest::SourceSymbol]) {
        for symbol in symbols {
            self.text(&mut symbol.signature);
            self.text(&mut symbol.doc);
        }
    }

    /// Keep export text, leaving a bound declaration's signature with its symbol.
    pub(crate) fn exports(&self, exports: &mut [crate::read_rows::Export], symbols: &[crate::harvest::SourceSymbol]) {
        // A statement that declares what it exports is its declaration's
        // head, which the declaration keeps; written whole it would be every
        // exported body. Only the one that declares nothing is kept: a
        // reader prints it as the head of what it passes on.
        let declared: std::collections::HashSet<&str> = symbols.iter().map(|symbol| symbol.name.as_str()).collect();
        for export in exports {
            let bound = export.local.as_deref().or(export.exported.as_deref());
            if export.from.is_some() || !bound.is_some_and(|bound| declared.contains(bound)) {
                self.text(&mut export.signature);
            }
            self.text(&mut export.doc);
        }
    }
}

impl crate::read::Read {
    /// The read with the text of every span and the line of every export and member declaration.
    pub(crate) fn texted(mut self, source: &Source) -> Self {
        source.text(&mut self.doc);
        source.symbols(&mut self.symbols);
        for nested in &mut self.nested {
            source.fill(&mut nested.signature);
            source.text(&mut nested.doc);
        }
        source.exports(&mut self.exports, &self.symbols);
        for export in &mut self.exports {
            export.line_text = source.line(export.line);
        }
        for member in &mut self.member_declarations {
            source.text(&mut member.doc);
            member.line_text = source.line(member.line);
        }
        self
    }
}

impl crate::languages::shape::Read {
    /// [`crate::read::Read::texted`], for a read another grammar made.
    pub(crate) fn texted(mut self, source: &Source) -> Self {
        source.symbols(&mut self.symbols);
        for export in self.exports.iter_mut().flatten() {
            export.line_text = source.line(export.line);
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::Source;
    use crate::harvest::TextSpan;
    use crate::read::Lines;

    fn span(start: u32, end: u32) -> Option<TextSpan> {
        Some(TextSpan { start, end, text: None })
    }

    fn sliced(source: &str, start: u32, end: u32) -> Option<std::sync::Arc<str>> {
        let lines = Lines::new(source);
        let mut held = span(start, end);
        Source::new(source, lines.starts()).text(&mut held);
        held.and_then(|span| span.text)
    }

    #[test]
    fn a_span_is_in_utf16_units() {
        assert_eq!(sliced("/** \u{1F600} */ x", 3, 7).as_deref(), Some(" \u{1F600} "));
        assert_eq!(sliced("abc", 1, 3).as_deref(), Some("bc"));
    }

    #[test]
    fn half_a_surrogate_pair_is_a_stand_in() {
        assert_eq!(sliced("a\u{1F600}b", 1, 2).as_deref(), Some("\u{FFFD}"));
    }

    #[test]
    fn a_span_past_the_end_is_clamped() {
        assert_eq!(sliced("abc", 2, 9).as_deref(), Some("c"));
        assert_eq!(sliced("abc", 3, 1).as_deref(), Some(""));
    }

    #[test]
    fn a_line_loses_its_line_end() {
        let source = "one\r\n  two;\nthree";
        let lines = Lines::new(source);
        let source = Source::new(source, lines.starts());
        assert_eq!([0, 1, 2, 3, 4].map(|line| source.line(line)), [None, Some("one".into()), Some("  two;".into()), Some("three".into()), None]);
    }

    #[test]
    fn repeated_lines_and_spans_share_their_held_text() {
        let text = "export { a, b };";
        let lines = Lines::new(text);
        let source = Source::new(text, lines.starts());
        let first_line = source.line(1).unwrap();
        let second_line = source.line(1).unwrap();
        assert_eq!(first_line.as_ptr(), second_line.as_ptr(), "one source line is held once");
        let (mut first, mut second) = (span(0, 6), span(0, 6));
        source.text(&mut first);
        source.text(&mut second);
        let (first, second) = (first.unwrap().text.unwrap(), second.unwrap().text.unwrap());
        assert_eq!(first.as_ptr(), second.as_ptr(), "one source span is held once");
    }
}
