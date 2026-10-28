use super::*;
use crate::record_coverage;
use crate::record_fixture::{self as fixture, block, module, spec, test};
use crate::record_layout::LAYOUT;

#[test]
fn names_only_the_strings_the_fold_writes_in_code_unit_order() {
    // The shard's dictionary holds strings in the order they were first named.
    let bytes = fixture::write(&spec(vec![test("z.test.ts"), test("\u{ff61}.test.ts"), test("\u{1f600}.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]));
    let record = record_coverage::read(&bytes).unwrap();
    let coverage = record.coverage.unwrap();
    let mut fold = Fold::new(coverage.tests(), None).unwrap();
    fold.add("one", &coverage).unwrap();
    let folded = fold.finish(Some("c0ffee")).unwrap();
    let blob = folded.columns.iter().find_map(|column| match column {
        Column::Blob("strings.blob", blob, offsets) => Some((blob.clone(), offsets.clone())),
        _ => None,
    });
    let (blob, offsets) = blob.unwrap();
    let strings: Vec<&str> = offsets.windows(2).map(|bounds| std::str::from_utf8(&blob[bounds[0] as usize..bounds[1] as usize]).unwrap()).collect();
    let mut expected = vec!["z.test.ts", "\u{ff61}.test.ts", "\u{1f600}.test.ts", "c0ffee", "istanbul", "src/a.ts", "text-1", "d0", "f0"];
    expected.sort_by(|left, right| order::code_unit(left, right));
    assert_eq!(strings, expected);
    // A surrogate pair sorts below U+FF61 in code units, above it in code points.
    let tests: Vec<&str> = folded.files[0].iter().map(String::as_str).collect();
    assert_eq!(tests, ["z.test.ts", "\u{1f600}.test.ts", "\u{ff61}.test.ts"]);
    let names: Vec<&str> = folded.columns.iter().map(|column| match column {
        Column::Bytes(name, _) | Column::Words(name, _) | Column::Blob(name, _, _) | Column::Plain(name, _) => &**name,
    }).collect();
    let layout: Vec<&str> = LAYOUT.coverage.sections.iter().map(String::as_str).collect();
    assert_eq!(names, layout);
}
