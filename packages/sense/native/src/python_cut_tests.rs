use super::*;
use variance_sense_instrument::native::Kind;

const CALC: &str = "LIMIT = 3

def add(a, b):
    return a + b

class Calc:
    scale = 2

    def twice(self, x):
        def inner(y):
            return y * 2
        return inner(x)

    @staticmethod
    async def later():
        return 1

f = lambda x: add(x, x)
";

fn line(source: &str, at: u32) -> usize {
    source[..at as usize].matches('\n').count() + 1
}

#[test]
fn cuts_each_function_under_the_module_with_its_lines() {
    let out = cut(CALC).expect("parses");
    let rows: Vec<_> = out
        .blocks
        .iter()
        .map(|b| (b.kind as u8, b.owner, b.name.as_str(), b.path.as_str(), line(CALC, b.start), line(CALC, b.end.saturating_sub(1))))
        .collect();
    assert_eq!(
        rows,
        vec![
            (Kind::Module as u8, None, "", "module", 1, 18),
            (Kind::Function as u8, Some(0), "add", "entry", 3, 4),
            (Kind::Function as u8, Some(0), "Calc/twice", "entry", 9, 12),
            (Kind::Function as u8, Some(2), "Calc/twice/inner", "entry", 10, 11),
            (Kind::Function as u8, Some(0), "Calc/later", "entry", 15, 16),
        ]
    );
    assert_eq!(out.code, CALC);
    assert!(!out.module);
    assert_eq!(out.digests.len(), out.blocks.len());
}

#[test]
fn an_edit_inside_one_function_changes_its_digest_alone() {
    let before = cut(CALC).expect("parses");
    let after = cut(&CALC.replace("a + b", "b + a")).expect("parses");
    let changed: Vec<_> = before.blocks.iter().zip(&before.digests).zip(&after.digests)
        .filter(|((_, l), r)| l != r).map(|((b, _), _)| b.name.as_str()).collect();
    assert_eq!(changed, vec!["add"]);
}

#[test]
fn offsets_are_utf16_code_units() {
    let source = "# ü\ndef a():\n    pass\n";
    let out = cut(source).expect("parses");
    assert_eq!(out.blocks[1].start, 4);
}

#[test]
fn a_file_that_does_not_parse_has_no_cut() {
    assert!(cut("def a(:\n").is_none());
}

// Lines are 1-based; the innermost function around one is charged, and the module body when none is.
#[test]
fn a_line_is_charged_to_the_innermost_function_around_it() {
    let out = cut(CALC).expect("parses");
    let lines = Lines::new(CALC.to_owned());
    let at = |n: usize| lines.charged(&out, n);
    assert_eq!(at(1), Some(0));
    assert_eq!(at(4), Some(1));
    assert_eq!(at(11), Some(3));
    assert_eq!(at(12), Some(2));
    assert_eq!(at(7), Some(0));
    assert_eq!(at(99), None);
}
