//! The declarations every instrumented module carries, and its own probe.
//!
//! The text is the runtime's contract, and this is its one author: the addon
//! inserts it for `instrument()` in `src/instrument/index.ts`, and a Rust
//! pipeline inserts it through [`crate::instrument`]. Why it is shaped this way
//! — the probes made by the root, function declarations for a circular import,
//! a depth on the bucket for a module evaluating inside another — is in
//! that file's documentation, beside the collectors that read it.

/// The header for one module: `module` is the id its probes report, `count` its
/// number of regions.
pub fn header(module: &str, count: usize) -> String {
    let mut out = String::with_capacity(HEAD.len() + module.len() + 2 + TAIL.len() + 16);
    out.push_str(HEAD);
    json_string(&mut out, module);
    out.push(',');
    out.push_str(&count.to_string());
    out.push_str(TAIL);
    out
}

const HEAD: &str = "var __vaL,__vaM;function __vaI(){const m=__vaM=globalThis.__VA__.r(";

const TAIL: &str = concat!(
    ");__vaL=m.V;__vaR=m.R;__vaE=m.E;__va=m.va;return m}",
    "function __va(i){__vaI().va(i)}",
    "function __vaR(v,i){return __vaI().R(v,i)}",
    "function __vaE(){__vaI().E()}",
    "(__vaM||__vaI()).T();",
);

/// `JSON.stringify` of a string, which is how the id has always been written.
///
/// A Rust string holds no lone surrogate, so the one escape `JSON.stringify`
/// has that this does not is never needed.
pub(crate) fn json_string(out: &mut String, value: &str) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            control if (control as u32) < 0x20 => {
                let code = control as usize;
                out.push_str("\\u00");
                out.push(HEX[code >> 4] as char);
                out.push(HEX[code & 0xf] as char);
            }
            other => out.push(other),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_header_takes_its_probes_from_the_root_on_the_first_call() {
        // The root makes the probes, once for every module of a realm: each
        // declaration asks for the module's set and rebinds the names to it,
        // so a circular import that calls one before the header ran is served.
        let text = header("a", 1);
        assert!(text.contains("function __vaI(){const m=__vaM=globalThis.__VA__.r(\"a\",1);__vaL=m.V;__vaR=m.R;__vaE=m.E;__va=m.va;return m}"), "{text}");
        assert!(text.contains("function __va(i){__vaI().va(i)}"), "{text}");
        assert!(text.contains("function __vaR(v,i){return __vaI().R(v,i)}"), "{text}");
        assert!(text.contains("function __vaE(){__vaI().E()}"), "{text}");
        assert!(text.ends_with("(__vaM||__vaI()).T();"), "{text}");
        assert!(!text.contains('&'), "the gate is the root's: {text}");
    }

    #[test]
    fn an_id_is_written_as_json_stringify_writes_it() {
        let mut out = String::new();
        json_string(&mut out, "a\"b\\c\n\u{1}\u{1f}\u{7f}é\u{2028}");
        assert_eq!(out, "\"a\\\"b\\\\c\\n\\u0001\\u001f\u{7f}é\u{2028}\"");
    }

    #[test]
    fn the_header_is_one_line() {
        assert!(!header("src/a.ts@0f", 3).contains('\n'));
        assert!(header("src/a.ts@0f", 3).contains(".r(\"src/a.ts@0f\",3);"));
    }
}
