# Select Rust tests from the functions each one ran

`variance cargo` runs a Cargo test suite with rustc's coverage counters and
records which functions each test ran. A change to a Rust function then runs
only the test targets whose tests ran it: selection picks whole targets, such as
a crate's unit tests or one file under `tests/`, and every test in a selected
target runs.

rustc places the counters itself, so the source is never rewritten, and the
profiles are read inside the `variance` process with no `llvm-cov` installed.
Each test runs alone in its own process, so the cost is one process start per
test. Recording this repository's own Rust workspace, 833 tests, takes 15 s
where `cargo test --workspace --lib` takes 7 s, once the instrumented build
exists; the first run also builds it, in about a minute.

## Record a Cargo suite

The CLI is a Node package, so you need Node 22.12 or newer. Install it at the
repository root, beside your `Cargo.toml`:

```bash
npm install --save-dev @variance-authority/cli
```

Then, from the crate or the workspace root:

```bash
npx variance cargo --suite unit
```

`unit` is a suite you name under `suites` in `variance.config.json` at the
repository root, as `{ "suites": { "unit": { "kind": "unit" } } }`. What
follows `--` goes to `cargo test`: the packages, features and targets to
build. Every test the build lists runs, so a test filter or a libtest flag
after a second `--` is refused.

```bash
npx variance cargo --suite unit -- --workspace --lib --locked
```

The command:

- builds the test binaries once with `-C instrument-coverage` on your
  workspace's crates, not their dependencies, in a `variance` directory under
  Cargo's target directory, so your own build is not rebuilt. It sets
  `RUSTC_WORKSPACE_WRAPPER` for that build, and says so when it replaces one
  of yours;
- lists each binary's tests and runs each one alone, as many at once as the
  machine has cores;
- writes the suite's [execution record](execution-record.md), as every other
  runner does.

It exits `0` when every test passed and `101`, Cargo's own code, when a test or
the build failed. A failing test's output is printed and its row is still
written, marked incomplete.

It differs from `cargo test` in three ways:

- doctests are not run, so run `cargo test --doc` beside it;
- each test is its own process, so tests that take turns through a `static`
  lock, or through `serial_test`, now run at the same time;
- a test process gets `CARGO_MANIFEST_DIR`, but not the rest of the
  environment Cargo gives it, such as `CARGO` or the library search path.

## Select from the record

The record is read the way a Node suite's is:

```bash
npx variance select --suite unit --since origin/main
```

It prints the test files the change since `origin/main` does not reach, one per
line: those are the targets you may skip. A test file that is not in the record
is never printed, so it runs. Each file is one Cargo target: `src/lib.rs` is the
crate's `--lib`, and `tests/negates.rs` is `--test negates`. Run `cargo test`
with the targets that were not printed.

The record lives in your [cache](cache.md) and answers for the commit it was
made at. Record again on your mainline after a merge, so the next diff is read
against a record of the code it starts from. `variance covering` names the tests
that ran a function:

```bash
npx variance covering --file src/lib.rs --function add
```

```text
unit (unit):
  2 named tests covered function add of src/lib.rs:
    src/lib.rs — 2/3
      tests::adds
      tests::muls
```

## What a row holds

Each `.rs` file a test ran is a module, and each `fn` in it is one region, from
its signature to its closing brace. A function is named by the `mod` and `impl`
around it: `Calc/twice` for a method, `<Calc as Default>/default` for a trait
method, and `tests/adds/helper` for a `fn` declared inside a test. Code outside
every function, such as a `static` or a `use`, belongs to the file's root region.
A change there selects every test that ran the file.

A row is the file the tests are declared in: `src/lib.rs` for a crate's unit
tests, `tests/negates.rs` for an integration test target. A case in the row is a
test by its libtest path, such as `tests::adds`. Only files under the repository
root are recorded, so a dependency in the Cargo registry is never a region.
