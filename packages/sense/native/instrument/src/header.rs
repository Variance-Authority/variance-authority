//! The declarations every instrumented module carries, and its own probe.
//!
//! The text is the runtime's contract, and this is its one author: the addon
//! inserts it for `instrument()` in `src/instrument/index.ts`, and a Rust
//! pipeline inserts it through [`crate::instrument`]. Why it is shaped this way
//! — module variables for the fast path, function declarations for a circular
//! import, a depth on the bucket for a module evaluating inside another — is in
//! that file's documentation, beside the collectors that read it.

/// The bit a log entry carries when its region was entered while a module was
/// evaluating. `EVALUATING` in `src/instrument/index.ts` is the same number.
pub const EVALUATING: u32 = 0x8000_0000;

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

const HEAD: &str = concat!(
    "var __vaK,__vaG,__vaB,__vaA;function __vaF(){}function __vaP(){}",
    "function __vaI(){__vaK=globalThis.__VA__;const r=__vaK.r(",
);

const TAIL: &str = concat!(
    ");__vaF=r.f;__vaG=r.s;__vaB=r.b;__vaP=r.p;return __vaK}",
    "function __va(i){if((__vaF[i]&__vaP[0])===0)__vaS(i)}",
    "function __vaS(i){const K=__vaK||__vaI();if(K.s!==null)K.s();const a=K.a;if(__vaA!==a){if(__vaA!==undefined&&__vaG[0]===0){__vaG[0]=1;K.g(__vaB)}__vaA=a}",
    "const f=__vaG[i],p=__vaP[0];if((f&p)===0){__vaG[i]=f|p;const n=K.n;if(n<K.l){K.L[n]=(__vaB+i)|K.v;K.n=n+1}else K.g((__vaB+i)|K.v)}}",
    "function __vaR(v,i){__va(i);return v}",
    "function __vaE(){(__vaK||__vaI()).x()}",
    "(__vaK||__vaI()).e();__vaA=__vaK.a;__vaG[0]|=__vaP[0];__vaK.g(2147483648|__vaB);",
);

/// `JSON.stringify` of a string, which is how the id has always been written.
///
/// A Rust string holds no lone surrogate, so the one escape `JSON.stringify`
/// has that this does not is never needed.
fn json_string(out: &mut String, value: &str) {
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
    fn the_evaluating_bit_is_the_one_the_tail_writes() {
        assert!(TAIL.contains(&format!("{EVALUATING}|__vaB")));
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
