use super::*;
use variance_sense_instrument::native::Kind;

const CALC: &str = "pub fn add(a: i32, b: i32) -> i32 { a + b }

impl Calc {
    fn twice(&self) -> i32 {
        let f = |x: i32| add(x, x);
        f(self.0)
    }
}

impl Default for Calc {
    fn default() -> Self { Calc(0) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adds() {
        fn helper() -> i32 { add(2, 3) }
        assert_eq!(helper(), 5);
    }
}
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
        .map(|b| (b.kind as u8, b.owner, b.name.as_str(), b.path.as_str(), line(CALC, b.start), line(CALC, b.end)))
        .collect();
    assert_eq!(
        rows,
        vec![
            (Kind::Module as u8, None, "", "module", 1, 23),
            (Kind::Function as u8, Some(0), "add", "entry", 1, 1),
            (Kind::Function as u8, Some(0), "Calc/twice", "entry", 4, 7),
            (Kind::Function as u8, Some(0), "<Calc as Default>/default", "entry", 11, 11),
            (Kind::Function as u8, Some(0), "tests/adds", "entry", 18, 21),
            (Kind::Function as u8, Some(4), "tests/adds/helper", "entry", 19, 19),
        ]
    );
    assert_eq!(out.code, CALC);
    assert_eq!(out.header_at, 0);
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
    let source = "// ü\nfn a() {}\n";
    let out = cut(source).expect("parses");
    assert_eq!(out.blocks[1].start, 5);
}

#[test]
fn a_file_that_does_not_parse_has_no_cut() {
    assert!(cut("fn a( {").is_none());
}

// A `const` evaluates it as the crate compiles, so its consumers never run its counters: it is code of its owner's.
#[test]
fn a_const_fn_is_its_owners_code() {
    let source = "const fn limit() -> u32 { 3 }\nconst LIMIT: u32 = limit();\nfn runs() -> u32 { LIMIT }\n";
    let out = cut(source).expect("parses");
    let names: Vec<_> = out.blocks.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(names, vec!["", "runs"]);
}
