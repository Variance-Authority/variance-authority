---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance cargo` records a Cargo test suite by the functions each test ran

It builds the tests once with rustc's `-C instrument-coverage`, in a `variance` directory under Cargo's target directory, runs each test alone, and writes the suite's record: one row per test target, such as a crate's unit tests or a file under `tests/`, one case per test by its libtest path; an `#[ignore]`d test is not run. A target with its own `main` (`harness = false`) runs once as `cargo test` runs it; it, or one with a test that passed without writing its counters, is recorded incomplete, so any change selects it. A change to a manifest, the lockfile, a build script or a file it names by `rerun-if-changed` selects every target. A test that starts a workspace binary through `CARGO_BIN_EXE_*` is charged with what that process ran. A Cargo `runner` is not used. `variance select` and `variance covering` answer a Rust change from it. What follows `--` goes to `cargo test`, and a test filter after a second `--` is refused; doctests are not run. The command exits `0` when every test passed and `101` otherwise.

`@variance-authority/sense` exports `recordCargo`, and its native addon reads `.rs` files as modules whose regions are their functions, and reads the profiles with no `llvm-cov`.
