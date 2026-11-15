//! The one cut of a doc comment and a declaration's head from the slice of
//! source the index keeps for them.
//!
//! The index keeps every span's text as written, inside a doc's `/**` and
//! `*/` and from a declaration's first byte to where its body opens. What a
//! reader prints is cut from that slice by these two rules, and by nothing
//! else: the native store and the JavaScript readers reach them through the
//! same functions, so a doc reads the same whichever producer published it.
//! The whitespace they trim is JavaScript's `String.prototype.trim` set, which
//! the rules were first written in: Unicode's White_Space less U+0085, and
//! U+FEFF.

// compass: variance-authority.reach.source-index

use napi_derive::napi;

/// Whether `c` is whitespace to JavaScript's `trim`.
fn blank(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

/// A doc comment's prose: each line less its JSDoc or Javadoc `*` margin, or
/// its Rust or Swift `///` or `//!`, and one space or tab after it; a line
/// with no margin is kept as written. `None` when nothing is left.
pub(crate) fn doc(slice: &str) -> Option<String> {
    let lines: Vec<&str> = slice.split('\n').map(unmarked).collect();
    let doc = lines.join("\n");
    let doc = doc.trim_matches(blank);
    (!doc.is_empty()).then(|| doc.to_owned())
}

fn unmarked(line: &str) -> &str {
    let rest = line.trim_start_matches([' ', '\t']);
    let Some(rest) = rest.strip_prefix("///").or_else(|| rest.strip_prefix("//!")).or_else(|| rest.strip_prefix('*')) else {
        return line;
    };
    rest.strip_prefix([' ', '\t']).unwrap_or(rest)
}

/// A declaration's head: its slice less the whitespace it ends on and one
/// `;` after that. `None` when nothing is left.
pub(crate) fn head(slice: &str) -> Option<String> {
    let head = slice.trim_end_matches(blank);
    let head = head.strip_suffix(';').unwrap_or(head);
    (!head.is_empty()).then(|| head.to_owned())
}

/// [`doc`], for a reader on the JavaScript side.
#[napi(js_name = "cutDoc")]
pub fn cut_doc(slice: String) -> Option<String> {
    doc(&slice)
}

/// [`head`], for a reader on the JavaScript side.
#[napi(js_name = "cutHead")]
pub fn cut_head(slice: String) -> Option<String> {
    head(&slice)
}

#[cfg(test)]
mod tests {
    use super::{doc, head};

    #[test]
    fn a_margin_loses_its_mark_and_one_space() {
        assert_eq!(doc("*\n * Opens.\n *\n *   door.open()\n ").as_deref(), Some("Opens.\n\n  door.open()"));
    }

    #[test]
    fn a_line_led_by_two_marks_keeps_the_second() {
        assert_eq!(doc("*\n ** Led by two\n ").as_deref(), Some("* Led by two"));
    }

    #[test]
    fn a_line_without_a_margin_keeps_its_indent() {
        assert_eq!(doc("* First\n    second\n").as_deref(), Some("First\n    second"));
    }

    #[test]
    fn a_carriage_return_inside_is_kept_and_one_at_the_end_trimmed() {
        assert_eq!(doc("*\r\n * One\r\n * Two\r\n ").as_deref(), Some("One\r\nTwo"));
    }

    #[test]
    fn slash_lines_lose_their_marks() {
        assert_eq!(doc("/// One\n//! Two\n///\tThree").as_deref(), Some("One\nTwo\nThree"));
    }

    #[test]
    fn trims_what_javascript_trims_and_nothing_else() {
        assert_eq!(doc("\u{feff} Kept \u{3000}").as_deref(), Some("Kept"));
        assert_eq!(doc("\u{85}Kept\u{85}").as_deref(), Some("\u{85}Kept\u{85}"));
        assert_eq!(head("f()\u{feff}").as_deref(), Some("f()"));
        assert_eq!(head("f()\u{85}").as_deref(), Some("f()\u{85}"));
    }

    #[test]
    fn a_character_outside_the_basic_plane_and_a_stand_in_are_text() {
        assert_eq!(doc("* Wears \u{1F600} and \u{FFFD}").as_deref(), Some("Wears \u{1F600} and \u{FFFD}"));
    }

    #[test]
    fn a_head_loses_one_semicolon_and_keeps_its_leading_space() {
        assert_eq!(head("  readonly open: boolean;;  \r\n").as_deref(), Some("  readonly open: boolean;"));
        assert_eq!(head("declare const rate: number;").as_deref(), Some("declare const rate: number"));
    }

    #[test]
    fn nothing_left_is_none() {
        assert_eq!(doc("*\n *\n "), None);
        assert_eq!(head(" ; ").as_deref(), Some(" "));
        assert_eq!(head(";"), None);
    }
}
