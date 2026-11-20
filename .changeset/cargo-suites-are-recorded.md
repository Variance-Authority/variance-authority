---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance cargo` records a Cargo test suite by the functions each test ran

It builds the tests once with rustc's `-C instrument-coverage`, in a `variance` directory under Cargo's target directory, runs each test alone, and writes the suite's record: one row per test target, such as a crate's unit tests or a file under `tests/`, one case per test by its libtest path; an `#[ignore]`d test is not run. A target with its own `main` (`harness = false`) runs once as `cargo test` runs it; it, or one with a test whose process or a process it started left no counters to read, is recorded incomplete, so any change selects it; the counters are written as they count, so a process that aborts or calls `_exit` is recorded. What runs as a crate compiles, a `const fn` or a `macro_rules!` macro, is charged to every test of each target that compiled its file. A change to a manifest, the lockfile, Cargo's configuration, the toolchain file, a build script, a file it names by `rerun-if-changed`, every file of its package when it names none, a file the source includes by `include_str!` or `include_bytes!`, or a path dependency the workspace leaves out selects every target. A test that starts a workspace binary through `CARGO_BIN_EXE_*` is charged with what that process ran. A Cargo `runner` is not used. `variance select` and `variance covering` answer a Rust change from it. What follows `--` goes to `cargo test`, and a test filter after a second `--` is refused; doctests are not run. The command exits `0` when every test passed and `101` otherwise.

`@variance-authority/sense` exports `recordCargo`, and its native addon reads `.rs` files as modules whose regions are their functions, and reads the profiles with no `llvm-cov`.
