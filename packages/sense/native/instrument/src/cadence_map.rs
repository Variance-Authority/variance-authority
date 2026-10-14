//! Where the cut moved each column, as the source map a runner reads a stack
//! frame through and as the shifts a wrapped transformer's map is moved back
//! by.
//!
//! The cut only inserts, and never a line terminator, so every line keeps its
//! number and a column moves right by what was inserted in front of it on its
//! line. A runner writes an inline snapshot into the call a frame names, by
//! line and column, so the map has to name the column the test wrote: a
//! segment opens every token and every inserted text, which maps to the place
//! it was inserted at. Columns are UTF-16 code units, as an engine counts them.

/// The cut's `mappings`, and its shifts as `[line, column, length]` triples,
/// zero-based, the column the source's and the length what was inserted
/// there. `edits` are sorted by offset and hold no line terminator.
pub fn mappings(source: &str, edits: &[(u32, String)]) -> (String, Vec<u32>) {
    let (text, shifts) = shifted(source, edits);
    debug_assert!(shifts.iter().all(|it| it.breaks == 0), "a cut inserts no line terminator");
    (text, shifts.iter().flat_map(|it| [it.line, it.column, it.length]).collect())
}

/// One insertion as a map moved past it reads it: where it went in the
/// source, how many line breaks it holds, and how many UTF-16 code units it
/// holds after the last of them — all of it when it holds none.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Shift {
    pub line: u32,
    pub column: u32,
    pub breaks: u32,
    pub length: u32,
}

/// [`mappings`] for insertions that may hold `\n`: the separator a module of
/// only a hashbang takes in front of its header. What follows such an insertion
/// on its line moves down by its breaks, to the column after its last one.
pub fn shifted(source: &str, edits: &[(u32, String)]) -> (String, Vec<Shift>) {
    let mut map = Mappings::default();
    let mut shifts = Vec::new();
    let mut edits = edits.iter().peekable();
    let (mut line, mut column, mut moved) = (0u32, 0u32, 0i64);
    let mut previous: Option<char> = None;
    let mut characters = source.char_indices().peekable();
    loop {
        let next = characters.peek().copied();
        let at = next.map_or(source.len(), |(at, _)| at) as u32;
        while let Some((_, text)) = edits.next_if(|(offset, _)| *offset == at) {
            map.segment((column as i64 + moved) as u32, line, column);
            let breaks = text.matches('\n').count() as u32;
            let tail = text.rsplit('\n').next().unwrap_or(text);
            let length = tail.encode_utf16().count() as u32;
            for _ in 0..breaks {
                map.line();
            }
            if breaks > 0 && length > 0 {
                map.segment(0, line, column);
            }
            shifts.push(Shift { line, column, breaks, length });
            moved = if breaks == 0 { moved + length as i64 } else { length as i64 - column as i64 };
            // What follows an insertion opens a segment of its own.
            previous = None;
        }
        let Some((offset, character)) = next else { break };
        characters.next();
        let terminator = match character {
            '\n' | '\u{2028}' | '\u{2029}' => true,
            '\r' => source.as_bytes().get(offset + 1) != Some(&b'\n'),
            _ => false,
        };
        if terminator {
            map.line();
            (line, column, moved) = (line + 1, 0, 0);
            previous = None;
            continue;
        }
        if !character.is_whitespace() && opens(previous, character) {
            map.segment((column as i64 + moved) as u32, line, column);
        }
        column += character.len_utf16() as u32;
        previous = Some(character);
    }
    (map.text, shifts)
}

/// Whether `character` starts a token: anything after whitespace or a line's
/// start, any punctuation, and a word after punctuation.
fn opens(previous: Option<char>, character: char) -> bool {
    match previous {
        None => true,
        Some(previous) => previous.is_whitespace() || !word(previous) || !word(character),
    }
}

fn word(character: char) -> bool {
    character == '_' || character == '$' || character.is_alphanumeric()
}

/// One source, so every segment is four fields; only the generated column
/// restarts with a line.
#[derive(Default)]
struct Mappings {
    text: String,
    generated: u32,
    original_line: u32,
    original_column: u32,
    opened: bool,
}

impl Mappings {
    fn segment(&mut self, generated: u32, line: u32, column: u32) {
        if self.opened {
            self.text.push(',');
        }
        vlq(&mut self.text, generated as i64 - self.generated as i64);
        vlq(&mut self.text, 0);
        vlq(&mut self.text, line as i64 - self.original_line as i64);
        vlq(&mut self.text, column as i64 - self.original_column as i64);
        (self.generated, self.original_line, self.original_column, self.opened) = (generated, line, column, true);
    }

    fn line(&mut self) {
        self.text.push(';');
        (self.generated, self.opened) = (0, false);
    }
}

const DIGITS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub(crate) fn vlq(text: &mut String, value: i64) {
    let mut rest = if value < 0 { ((-value) << 1) | 1 } else { value << 1 } as u64;
    loop {
        let mut digit = (rest & 31) as usize;
        rest >>= 5;
        if rest > 0 {
            digit |= 32;
        }
        text.push(DIGITS[digit] as char);
        if rest == 0 {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_without_an_insertion_maps_each_token_to_itself() {
        let (text, shifts) = mappings("a.b(c);", &[]);
        // a . b ( c ) ; at columns 0..6, each one apart.
        assert_eq!(text, "AAAA,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC");
        assert!(shifts.is_empty());
    }

    #[test]
    fn an_insertion_maps_to_where_it_went_and_moves_what_follows() {
        let source = "{\n  go();\n}";
        let edits = [(4u32, "__vaC(2);".to_string())];
        let (text, shifts) = mappings(source, &edits);
        // Line 2: the insertion at generated 2 -> 2, `go` at 11 -> 2, `(` at 13 -> 4.
        assert_eq!(text, "AAAA;EACE,SAAA,EAAE,CAAC,CAAC;AACN");
        assert_eq!(shifts, vec![1, 2, 9]);
    }

    #[test]
    fn columns_are_utf16_and_lines_are_every_terminator() {
        let (_, shifts) = mappings("'😀';\r\n\u{2028}x", &[(12, "c;".to_string())]);
        assert_eq!(shifts, vec![2, 0, 2]);
        let (_, shifts) = mappings("'😀'x", &[(6, "c;".to_string())]);
        assert_eq!(shifts, vec![0, 4, 2]);
    }

    #[test]
    fn an_insertion_with_a_break_moves_what_follows_it_to_the_next_line() {
        // `#!x` then a break and `h;` inserted at its end, then the source's own `\nq`.
        let (text, shifts) = shifted("#!x\nq", &[(3, "\nh;".to_string())]);
        assert_eq!(shifts, vec![Shift { line: 0, column: 3, breaks: 1, length: 2 }]);
        // Line 0: `#`, `!`, `x` and the insertion; line 1: its tail, mapped to
        // where it went in; line 2: `q`, from line 1, column 0.
        assert_eq!(text, "AAAA,CAAC,CAAC,CAAC;AAAA;AACH");
    }

    #[test]
    fn a_large_or_negative_delta_takes_several_digits() {
        let mut text = String::new();
        vlq(&mut text, 16);
        vlq(&mut text, -1);
        vlq(&mut text, 1000);
        assert_eq!(text, "gBDw+B");
    }
}
