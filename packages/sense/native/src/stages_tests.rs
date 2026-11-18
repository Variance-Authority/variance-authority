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

/// The listing's parts are one set of sums, so the tests that move them take turns.
static PARTS: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn without_the_variable_a_part_moves_no_sum() {
    let _turn = PARTS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if on() {
        return; // the clock is on in this run, so there is no off path to pin
    }
    assert_eq!(part(Part::Tree, || 7), 7);
    assert_eq!(Part::Tree.sum().load(Ordering::Relaxed), 0);
}

#[test]
fn the_listing_line_names_each_part_that_ran_and_resets_it() {
    let _turn = PARTS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    Part::Tree.sum().fetch_add(50_000_000, Ordering::Relaxed);
    Part::Worktree.sum().fetch_add(415_000_000, Ordering::Relaxed);
    assert_eq!(listing_parts(), " (tree 0.050 s, worktree 0.415 s)");
    assert!(Part::ALL.iter().all(|part| part.sum().load(Ordering::Relaxed) == 0));
    assert_eq!(listing_parts(), "");
}

#[test]
fn a_listing_leaves_out_what_its_parts_took_before_it_started() {
    let _turn = PARTS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    Part::Head.sum().fetch_add(9_000_000, Ordering::Relaxed);
    let _stage = start_listing("listing");
    assert_eq!(listing_parts(), "");
}
