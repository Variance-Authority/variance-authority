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

/// A source as the spans and lines of its read address it.
pub(crate) struct Source<'a> {
    source: &'a str,
    /// The source in UTF-16 units; absent for ASCII, whose bytes are its units.
    utf16: Option<Vec<u16>>,
    /// The byte each line starts at, the first line first.
    starts: &'a [usize],
}

impl<'a> Source<'a> {
    /// `starts` are the bytes `source`'s lines start at, as [`crate::read::Lines`] holds them.
    pub(crate) fn new(source: &'a str, starts: &'a [usize]) -> Self {
        let utf16 = (!source.is_ascii()).then(|| source.encode_utf16().collect());
        Source { source, utf16, starts }
    }

    /// What `start..end` spans, clamped as `String.prototype.slice` clamps it.
    fn slice(&self, start: u32, end: u32) -> String {
        let length = self.utf16.as_ref().map_or(self.source.len(), Vec::len);
        let end = (end as usize).min(length);
        let start = (start as usize).min(end);
        match &self.utf16 {
            None => self.source[start..end].to_owned(),
            Some(units) => String::from_utf16_lossy(&units[start..end]),
        }
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
    pub(crate) fn line(&self, line: u32) -> Option<String> {
        let start = *self.starts.get((line as usize).checked_sub(1)?)?;
        let rest = self.source.get(start..)?;
        let line = rest.split_once('\n').map_or(rest, |(line, _)| line);
        Some(line.strip_suffix('\r').unwrap_or(line).to_owned())
    }
}

impl crate::read::Read {
    /// The read with the text of every span and the line of every export and member declaration.
    pub(crate) fn texted(mut self, source: &Source) -> Self {
        source.text(&mut self.doc);
        for symbol in &mut self.symbols {
            source.text(&mut symbol.signature);
            source.text(&mut symbol.doc);
        }
        for nested in &mut self.nested {
            source.fill(&mut nested.signature);
            source.text(&mut nested.doc);
        }
        // A statement that declares what it exports is its declaration's
        // head, which the declaration keeps; written whole it would be every
        // exported body. Only the one that declares nothing is kept: a
        // reader prints it as the head of what it passes on.
        let declared: std::collections::HashSet<&str> = self.symbols.iter().map(|symbol| symbol.name.as_str()).collect();
        for export in &mut self.exports {
            let bound = export.local.as_deref().or(export.exported.as_deref());
            if export.from.is_some() || !bound.is_some_and(|bound| declared.contains(bound)) {
                source.text(&mut export.signature);
            }
            source.text(&mut export.doc);
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
        for symbol in &mut self.symbols {
            source.text(&mut symbol.signature);
            source.text(&mut symbol.doc);
        }
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

    fn sliced(source: &str, start: u32, end: u32) -> Option<String> {
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
}
