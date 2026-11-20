---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance cargo` records a Cargo test suite by the functions each test ran

It builds the tests once with rustc's `-C instrument-coverage`, in a `variance` directory under Cargo's target directory, runs each test alone, and writes the suite's record: one row per file that declares tests, one case per test by its libtest path. `variance select` and `variance covering` answer a Rust change from it. What follows `--` goes to `cargo test`; the command exits `0` when every test passed and `101` otherwise.

`@variance-authority/sense` exports `recordCargo`, and its native addon reads `.rs` files as modules whose regions are their functions, and reads the profiles with no `llvm-cov`.
