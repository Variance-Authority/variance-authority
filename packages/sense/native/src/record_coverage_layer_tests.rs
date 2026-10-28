use super::*;

#[test]
fn a_carried_test_keeps_every_precondition_its_ids_did_not_list_in_order() {
    use crate::record_fixture::{self as fixture, block, module, spec, test};
    // The fixture names strings as it meets them, so these ids descend and repeat.
    let mut held = test("a.test.ts");
    held.preconditions = vec![("z-input", "z-digest"), ("a-input", "a-digest"), ("z-input", "z-digest")];
    let previous = fixture::write(&spec(vec![held, test("b.test.ts")], vec![module("src/a.ts", vec![block(0, &[0, 1])])]));
    let current = fixture::write(&spec(vec![test("b.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]));
    let bytes = laid(&previous, &current, LayOptions::default()).unwrap().unwrap();
    let record = record_coverage::read(&bytes).unwrap();
    let coverage = record.coverage.unwrap();
    let strings = coverage.text().unwrap();
    let carried = (0..coverage.tests()).find(|test| strings.at(coverage.test_path[*test]) == "a.test.ts").unwrap();
    let inputs: Vec<(&str, &str)> = coverage.preconditions(carried)
        .map(|input| (strings.at(coverage.precondition_name[input]), strings.at(coverage.precondition_digest[input])))
        .collect();
    assert_eq!(inputs, [("a-input", "a-digest"), ("z-input", "z-digest")]);
}

#[test]
fn refuses_a_record_under_other_probes_naming_both() {
    use crate::record_fixture::{self as fixture, block, module, spec, test};
    let previous = fixture::write(&spec(vec![test("a.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]));
    let mut other = spec(vec![test("b.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]);
    other.instrumentation = "v8";
    let error = laid(&previous, &fixture::write(&other), LayOptions::default()).unwrap_err();
    assert!(error.contains("`istanbul`") && error.contains("`v8`"), "{error}");
}

#[test]
fn refuses_a_record_it_cannot_read() {
    use crate::record_fixture::{self as fixture, block, module, spec, test};
    let current = fixture::write(&spec(vec![test("b.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]));
    assert!(laid(b"not a record", &current, LayOptions::default()).is_err());
}

#[test]
fn lays_over_the_layout_before_the_record_held_cases() {
    use crate::record_fixture::{self as fixture, block, module, spec, test};
    let mut uncased = spec(vec![test("a.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]);
    uncased.version = LAYOUT.coverage.uncased;
    let current = fixture::write(&spec(vec![test("b.test.ts")], vec![module("src/a.ts", vec![block(0, &[0])])]));
    let bytes = laid(&fixture::write(&uncased), &current, LayOptions::default()).unwrap().unwrap();
    let (tests, _) = fixture::read(&bytes);
    assert_eq!(tests.iter().map(|(file, ..)| file.as_str()).collect::<Vec<_>>(), ["a.test.ts", "b.test.ts"]);
}

#[test]
fn pairs_no_callback_of_a_cut_that_lacks_its_sibling_and_owes_nobody_the_region_around_it_kept() {
    use crate::record_fixture::{self as fixture, block, module, spec, test, Block};
    let inside = |ordinal: u32, name: &str, owner: u32, called: &[u32]| Block { name: name.to_owned(), owner, ..block(ordinal, called) };
    // One text: the previous run cut both callbacks, `a` entering the first and
    // `b` the second; this run's writer cut only one of them.
    let both = vec![block(0, &[0, 1]), inside(1, "outer", 0, &[0, 1]), inside(2, "cb", 1, &[0]), inside(3, "cb", 1, &[1])];
    let lacking = vec![block(0, &[0]), inside(1, "outer", 0, &[]), inside(2, "cb", 1, &[])];
    let previous = fixture::write(&spec(vec![test("a.test.ts"), test("b.test.ts")], vec![module("src/a.ts", both)]));
    let current = fixture::write(&spec(vec![test("c.test.ts")], vec![module("src/a.ts", lacking)]));
    let (tests, modules) = fixture::read(&laid(&previous, &current, LayOptions::default()).unwrap().unwrap());
    // The one callback is neither: it takes the region around it, which holds both.
    assert_eq!(modules[0].2[2].1, ["a.test.ts", "b.test.ts"]);
    assert!(tests.iter().all(|(_, complete, _)| *complete), "{tests:?}");
}

#[test]
fn owes_a_run_to_a_test_whose_region_has_no_place_when_the_region_around_it_does_not_hold_it() {
    use crate::record_fixture::{self as fixture, block, module, spec, test, Block};
    let inside = |ordinal: u32, name: &str, owner: u32, called: &[u32]| Block { name: name.to_owned(), owner, ..block(ordinal, called) };
    // One text: `b` ran the callback from a handler it kept, never the function
    // that passed it; this run's writer did not cut the callback.
    let held = vec![block(0, &[0, 1]), inside(1, "outer", 0, &[0]), inside(2, "cb", 1, &[1])];
    let lacking = vec![block(0, &[0]), inside(1, "outer", 0, &[])];
    let previous = fixture::write(&spec(vec![test("a.test.ts"), test("b.test.ts")], vec![module("src/a.ts", held)]));
    let current = fixture::write(&spec(vec![test("c.test.ts")], vec![module("src/a.ts", lacking)]));
    let (tests, _) = fixture::read(&laid(&previous, &current, LayOptions::default()).unwrap().unwrap());
    let complete: Vec<_> = tests.iter().map(|(file, complete, _)| (file.as_str(), *complete)).collect();
    assert_eq!(complete, [("a.test.ts", true), ("b.test.ts", false), ("c.test.ts", true)]);
}
