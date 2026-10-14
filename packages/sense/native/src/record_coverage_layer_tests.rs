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
fn a_cut_that_renumbered_a_site_both_hold_is_not_the_same_numbering() {
    let cut = |paths: &[&str]| paths.iter().map(|path| ("decide".to_owned(), (*path).to_owned())).collect::<Vec<_>>();
    assert!(same_numbering(cut(&["if#0/then", "if#1/then"]).into_iter(), cut(&["if#0/then", "if#1/then"]).into_iter()));
    assert!(!same_numbering(cut(&["if#0/then", "if#1/then"]).into_iter(), cut(&["if#0/then"]).into_iter()));
    // A site only one cut holds says nothing.
    assert!(same_numbering(cut(&["if#0/then"]).into_iter(), cut(&["loop#0/body"]).into_iter()));
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
