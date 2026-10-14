//! A project's map carried across the probes placed in the text it maps.
//!
//! Placing probes inserts text and moves nothing else, so a position of the
//! transformed text has one place in the probed text: the same line, its
//! column moved right by every insertion in front of it on that line. A map
//! from the transformed text to its sources becomes a map from the probed text
//! to the same sources by moving each segment's generated column, and nothing
//! else in it changes: a runner that reads the map for a stack trace or an
//! inline snapshot names the lines and columns the project's own map named.

use crate::cadence_map::vlq;

/// `mappings` with each segment's generated column moved past the insertions
/// `shifts` lists as `[line, column, length]` triples, in UTF-16 code units, in
/// the order they were made. An insertion at a segment's own column goes in
/// front of it.
pub fn carried(mappings: &str, shifts: &[u32]) -> String {
    let mut out = String::with_capacity(mappings.len() + mappings.len() / 8);
    let mut shifts = shifts.chunks_exact(3).peekable();
    for (line, text) in mappings.split(';').enumerate() {
        if line > 0 {
            out.push(';');
        }
        let line = line as u32;
        while shifts.next_if(|it| it[0] < line).is_some() {}
        let (mut column, mut moved, mut written) = (0i64, 0i64, 0i64);
        for (index, field) in text.split(',').enumerate() {
            if index > 0 {
                out.push(',');
            }
            let Some((delta, rest)) = first(field) else {
                out.push_str(field);
                continue;
            };
            column += delta;
            while let Some(shift) = shifts.next_if(|it| it[0] == line && i64::from(it[1]) <= column) {
                moved += i64::from(shift[2]);
            }
            vlq(&mut out, column + moved - written);
            written = column + moved;
            out.push_str(rest);
        }
    }
    out
}

/// A segment's first field, and the text after it; nothing when it is not
/// Base64 VLQ.
fn first(field: &str) -> Option<(i64, &str)> {
    let (mut value, mut shift) = (0i64, 0u32);
    for (at, byte) in field.bytes().enumerate() {
        let digit = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as i64;
        value += (digit & 31) << shift;
        if digit & 32 == 0 {
            let value = if value & 1 == 1 { -(value >> 1) } else { value >> 1 };
            return Some((value, &field[at + 1..]));
        }
        shift += 5;
        if shift > 60 {
            return None;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::carried;

    #[test]
    fn a_segment_moves_past_every_insertion_in_front_of_it_on_its_line() {
        // Line 0: segments at columns 0 and 4; line 1: a segment at 2.
        // `AAAA,IAAI;EACA` is [0,0,0,0], [4,0,0,4] / [2,0,1,0].
        let map = "AAAA,IAAI;EACA";
        // Six units in at column 0 of line 0, three at column 3; two at column 5 of line 1.
        let shifts = [0, 0, 6, 0, 3, 3, 1, 5, 2];
        // Line 0: 0 -> 6, 4 -> 13 (delta 7). Line 1: 2 stays 2.
        assert_eq!(carried(map, &shifts), "MAAA,OAAI;EACA");
    }

    #[test]
    fn an_empty_map_and_no_insertions_are_the_map() {
        assert_eq!(carried("", &[0, 0, 3]), "");
        assert_eq!(carried("AAAA;;CAAC", &[]), "AAAA;;CAAC");
    }
}
