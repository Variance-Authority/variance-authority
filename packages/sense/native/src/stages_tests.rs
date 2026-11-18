use super::*;

#[test]
fn without_the_variable_no_stage_is_timed_and_no_sum_moves() {
    assert!(std::env::var_os("VARIANCE_AUTHORITY_INDEX_STAGES").is_none(), "the test runs without the variable");
    assert!(!on());
    assert!(start("listing").0.is_none());
    assert_eq!(summed(&RESOLVE, || 7), 7);
    assert_eq!(RESOLVE.load(Ordering::Relaxed), 0);
}
