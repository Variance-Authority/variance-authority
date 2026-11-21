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
build. Every test the build lists runs, so a test filter, or a libtest flag
after a second `--`, is refused.

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
written, marked incomplete. Two rows are marked incomplete though nothing failed,
because what their tests ran is not known: a target with its own `main`
(`harness = false`), which lists no tests to run alone and so runs once as
`cargo test` runs it, and a target with a test whose process, or one it started,
left no counters to read. The counters are written as they count, so a process
that aborts or calls `_exit` still leaves what it ran. An incomplete row is
selected by every change.

No test reads `Cargo.toml`, `Cargo.lock`, a build script, Cargo's configuration
in `.cargo/config.toml` or the toolchain file, yet each changes what every test
runs, so the record holds them under every row: a change to one selects every
target. So does a change to a file a build script names with
`cargo::rerun-if-changed`, such as a schema it generates code from, and to a file
a crate reads as it compiles, through `include_str!` or `include_bytes!`. A
build script that names nothing is run again by Cargo on a change to any file of
its package, so every file of that package is held the same way. So is every
file of a crate under the repository root that your crates depend on by path but
the workspace leaves out, since it is built without counters.

Cargo reads its configuration from the directory it runs in and those above it.
A configuration file added there later, or a file added later in a directory a
build script names or a package it watches whole, is held by no row until you
record again, so its addition alone selects nothing.

A test that starts one of the workspace's binaries, as an integration test does
through `CARGO_BIN_EXE_<name>`, is charged with what that process ran too, even
when it aborts. A process started with a cleared environment does not know where
to write its counters, so what it ran is not charged.

What runs as the crate compiles, such as a `const fn` evaluated in a `const` or
a `macro_rules!` macro, is charged to every test of each target that compiled
its file, so an edit to it selects them all.

It differs from `cargo test` in four ways:

- doctests are not run, so run `cargo test --doc` beside it;
- each test is its own process, so tests that take turns through a `static`
  lock, or through `serial_test`, now run at the same time;
- a test process gets `CARGO_MANIFEST_DIR`, but not the rest of the
  environment Cargo gives it, such as `CARGO` or the library search path;
- a test binary runs on the machine itself, never through a `runner` set in
  Cargo's configuration, so a suite built for another target cannot be recorded.

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
A change there selects every target that compiled the file, since what it
declares is read as the crate compiles.

A row is the file the tests are declared in: `src/lib.rs` for a crate's unit
tests, `tests/negates.rs` for an integration test target. A case in the row is a
test by its libtest path, such as `tests::adds`. Only files under the repository
root are recorded, so a dependency in the Cargo registry is never a region.
