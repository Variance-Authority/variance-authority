// Starts the crate's binary, which aborts.
#[test]
fn aborts() {
    let status = std::process::Command::new(env!("CARGO_BIN_EXE_calc")).arg("abort").status().expect("the binary runs");
    assert!(!status.success());
}
