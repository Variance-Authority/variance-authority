// Runs the crate's binary in a process of its own.
#[test]
fn launches() {
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_calc")).output().expect("the binary runs");
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "42");
}
