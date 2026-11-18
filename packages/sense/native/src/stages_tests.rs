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
