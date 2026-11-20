use calc::neg;

#[test]
fn negates() {
    // `cargo test` sets it for the run, not only for the build.
    assert!(std::env::var("CARGO_MANIFEST_DIR").is_ok());
    assert_eq!(neg(3), -3);
}

#[test]
#[ignore]
fn ignored() {
    assert_eq!(neg(0), 1);
}
