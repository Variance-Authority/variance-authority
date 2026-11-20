unsafe extern "C" {
    fn _exit(code: i32) -> !;
}

// Passes, and leaves before the profile runtime would write its counters at exit.
#[test]
fn exits() {
    assert_eq!(calc::add(1, 1), 2);
    unsafe { _exit(0) }
}
