# Select Rust tests from the functions each one ran

`variance cargo` runs a Cargo test suite with rustc's coverage counters and
records which functions each test ran. A change to a Rust function then runs
only the test targets whose tests ran it. The record is one row per file that
declares tests, with one case per test, and `variance select` answers a diff
from it.

rustc places the counters itself, so the source is never rewritten, and the
profiles are read inside the `variance` process with no `llvm-cov` installed.
Each test runs alone in its own process, so the cost is one process start per
test. Recording this repository's own Rust workspace, 833 tests, takes 15 s
where a plain `cargo test` takes 7 s, once the instrumented build exists; the
first run also builds it, in about a minute.

## Record a Cargo suite

Install the CLI next to the code that runs your suite:

```bash
npm install --save-dev @variance-authority/cli
```

Then, from the crate or the workspace root:

```bash
npx variance cargo --suite unit
```

What follows `--` goes to `cargo test`, before its own `--`: the packages,
features and targets to build.

```bash
npx variance cargo --suite unit -- --workspace --lib --locked
```

The command:

- builds the test binaries once with `-C instrument-coverage` on your
  workspace's crates, not their dependencies, in a `variance` directory under
  Cargo's target directory, so your own build is not rebuilt;
- lists each binary's tests and runs each one alone, as many at once as the
  machine has cores;
- writes the suite's [execution record](execution-record.md), as every other
  runner does.

It exits `0` when every test passed and `101`, Cargo's own code, when a test or
the build failed. A failing test's output is printed and its row is still
written, marked incomplete.

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

## Select from the record

The record is read the way a Node suite's is:

```bash
npx variance select --suite unit --since origin/main
```

It prints the test files the change since `origin/main` does not reach, one per
line: those are the targets you may skip. A test file that is not in the record
is never printed, so it runs. `variance covering` names the tests that ran a
function:

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
