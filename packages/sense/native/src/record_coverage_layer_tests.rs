use super::*;

#[test]
fn a_seat_is_the_digits_after_the_last_hash_of_a_step() {
    assert_eq!(seat("if#12"), Some(("if", 12_f64.to_bits())));
    assert_eq!(seat("a#b#3"), Some(("a#b", 3_f64.to_bits())));
    assert_eq!(seat("if#"), None);
    assert_eq!(seat("if#1x"), None);
    assert_eq!(seat("if#2#x"), None);
    assert_eq!(seat("line\nbreak#1"), None);
    assert_eq!(seat("then"), None);
}

#[test]
fn seats_are_sited_by_the_name_then_the_path_they_pass_through() {
    assert_eq!(seats_of("decide/map.arg#1", "if#0/then"), vec![("/decide/map.arg".to_owned(), 1_f64.to_bits()), ("/decide/map.arg#1\0/if".to_owned(), 0_f64.to_bits())]);
    assert_eq!(seats_of("", "anon#2"), vec![("\0/anon".to_owned(), 2_f64.to_bits())]);
}

#[test]
fn an_address_names_one_region_only_where_its_counters_and_its_count_agree() {
    let cut = |addresses: &[(&str, &str)]| addresses.iter().map(|(name, path)| ((*name).to_owned(), (*path).to_owned())).collect::<Vec<_>>();
    let both = [("decide", "entry"), ("decide", "if#0/then"), ("decide", "if#1/then")];
    let alike = addressed_alike(cut(&both).into_iter(), cut(&both).into_iter());
    assert!(alike("decide", "if#0/then") && alike("decide", "if#1/then"));
    // The first branch deleted: the second is cut as `if#0`, the address the first had.
    let alike = addressed_alike(cut(&both).into_iter(), cut(&[("decide", "entry"), ("decide", "if#0/then")]).into_iter());
    assert!(!alike("decide", "if#0/then"));
    // The renumbering stays inside the counter it changed.
    assert!(alike("decide", "entry"));
    // Two callbacks of one name where the other cut holds one: no occurrence names either.
    let alike = addressed_alike(cut(&[("c/useEffect.arg0", "entry")]).into_iter(), cut(&[("c/useEffect.arg0", "entry"), ("c/useEffect.arg0", "entry")]).into_iter());
    assert!(!alike("c/useEffect.arg0", "entry"));
}

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
