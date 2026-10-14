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
