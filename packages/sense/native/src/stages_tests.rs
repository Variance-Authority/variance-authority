use super::*;

#[test]
fn without_the_variable_no_stage_is_timed_and_no_sum_moves() {
    if std::env::var_os("VARIANCE_AUTHORITY_INDEX_STAGES").is_some() {
        return; // the clock is on in this run, so there is no off path to pin
    }
    assert!(!on());
    assert!(start("listing").0.is_none());
    assert_eq!(summed(&RESOLVE, || 7), 7);
    assert_eq!(RESOLVE.load(Ordering::Relaxed), 0);
}

#[test]
fn the_listing_line_names_each_part_that_ran_and_resets_it() {
    let sum = |name: &str| &LISTING_PARTS.iter().find(|(part, _)| *part == name).unwrap().1;
    sum("tree").fetch_add(50_000_000, Ordering::Relaxed);
    sum("worktree").fetch_add(415_000_000, Ordering::Relaxed);
    assert_eq!(listing_parts(), " (tree 0.050 s, worktree 0.415 s)");
    assert!(LISTING_PARTS.iter().all(|(_, sum)| sum.load(Ordering::Relaxed) == 0));
    assert_eq!(listing_parts(), "");
}
