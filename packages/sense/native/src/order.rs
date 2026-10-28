//! Sorting the way the rest of this project sorts: by UTF-16 code unit.
//!
//! `localeCompare` is refused everywhere in this repository because it makes
//! byte-stability a promise about `LANG`, and the native side has to answer the
//! same way JavaScript's `<` does or a record that crosses the boundary sorts
//! into a different place than the one the TypeScript implementation put it.
//!
//! UTF-8 byte order is code *point* order, and the two disagree in exactly one
//! place: a character in U+E000..U+FFFF sorts above a character at U+10000 or
//! beyond under UTF-16, because the astral one is written as a surrogate pair
//! beginning at U+D800. So bytes are compared first — which is the whole
//! repository, and fast — and the surrogate reading is reached only when the
//! first difference is outside ASCII.

use std::cmp::Ordering;

/// Two strings, compared as JavaScript's `<` compares them.
pub fn code_unit(a: &str, b: &str) -> Ordering {
    let (left, right) = (a.as_bytes(), b.as_bytes());
    let common = left.len().min(right.len());

    // Eight bytes at a time to the first word that differs: most strings
    // compared here share a long path prefix.
    let mut at = 0;
    let word = |bytes: &[u8], at: usize| u64::from_ne_bytes(bytes[at..at + 8].try_into().unwrap_or_default());
    while at + 8 <= common && word(left, at) == word(right, at) {
        at += 8;
    }
    while at < common {
        if left[at] != right[at] {
            // Both sides ASCII at the first difference: the byte order is the
            // code unit order, and no character before it could have been a
            // partial match spanning into a surrogate.
            if left[at] < 0x80 && right[at] < 0x80 {
                return left[at].cmp(&right[at]);
            }
            return surrogates(a, b);
        }
        at += 1;
    }

    left.len().cmp(&right.len())
}

fn surrogates(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_orders_by_byte() {
        assert_eq!(code_unit("a/b", "a/c"), Ordering::Less);
        assert_eq!(code_unit("Z", "a"), Ordering::Less);
        assert_eq!(code_unit("ab", "abc"), Ordering::Less);
        assert_eq!(code_unit("packages/a/src/x.ts", "packages/a/src/y.ts"), Ordering::Less);
        assert_eq!(code_unit("packages/a/src/x.ts", "packages/a/src/x.ts"), Ordering::Equal);
        assert_eq!(code_unit("packages/a/src/x.ts", "packages/a/src"), Ordering::Greater);
    }

    #[test]
    fn an_astral_character_sorts_below_the_private_use_area() {
        // U+FFFD against U+1F600. Code point order puts the emoji second; UTF-16
        // puts it first, because it is written as a pair starting at U+D83D.
        assert_eq!(code_unit("\u{1F600}", "\u{FFFD}"), Ordering::Less);
        assert_eq!(code_unit("\u{FFFD}", "\u{1F600}"), Ordering::Greater);
        assert_eq!(code_unit("packages/\u{1F600}", "packages/\u{FFFD}"), Ordering::Less);
    }
}
