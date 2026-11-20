// Reads only what the crate computed as it compiled, so its run enters no counter of `src/lib.rs`.
#[test]
fn constant() {
    assert_eq!(calc::LIMIT, 3);
    assert!(calc::UNIT == "one" || calc::UNIT == "none");
}
