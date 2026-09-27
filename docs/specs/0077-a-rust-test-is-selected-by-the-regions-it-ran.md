# Spec 0077 — a Rust test is selected by the regions it ran

**Missing:** a record of the regions each Rust test ran, and a both-texts
verdict for a changed `.rs` file. `variance reach` reads Rust today and walks a
changed file as a whole file. No recorder writes a row for a `#[test]`, and a
Vitest case that calls into a napi-rs addon names none of the Rust it ran.
**Built on:** [ADR-0074](../context/adr/0074-one-reader-per-tree-sitter-language.md)
(the Rust reader is the addon's),
[ADR-0069](../context/adr/0069-every-answer-has-an-owner.md) (rustc's coverage
counters and mapping are the owner),
[ADR-0072](../context/adr/0072-a-change-is-read-before-it-is-charged.md),
[ADR-0070](../context/adr/0070-a-journey-travels-as-trace-context.md),
[0073](0073-a-test-owns-the-files-its-services-ran.md) (the lane model), and
[0027](0027-a-test-is-selected-by-what-it-executed.md).

## Purpose

`-C instrument-coverage` is stable since Rust 1.60. It puts a counter on every
code region and writes, into the binary, a coverage map that names each region
by file, line and column. That is a region-grain record already cut by the
compiler, and every tool below reads it through `llvm-cov export`, which
cargo-affected calls "the expensive part". Reading the mapping sections and the
`.profraw` counters directly, once per binary signature, is the owner's answer
without the round trip.

The second reason is this repository. The sense addon is Rust under napi-rs,
called from Vitest. A record in which one test names both the TypeScript and
the Rust regions it ran is the case no single-language tool can state, and it
is measured here before anywhere else.

## Existing solutions

| Tool | Grain | How it records and selects | Source |
| --- | --- | --- | --- |
| cargo-affected | function line span, per test | nextest process per test, one `LLVM_PROFILE_FILE` each; `llvm-cov export` per binary; `git diff -U0` intersected with stored spans; a hunk outside every span (a struct field, a derive, a `const`, a `use`) selects every test that touched the file. "Extremely early"; no overhead published. | [github](https://github.com/max-sixty/cargo-affected) |
| cargo-difftests | file by default, region with a full index | a process per test since 0.6.0; `fs-mtime`, `git-diff-files` and `git-diff-hunks` selectors. No release since February 2024. | [github](https://github.com/dnbln/cargo-difftests) |
| RustyRTS | crate, function (static), function (dynamic) | a rustc driver: a crate graph, a MIR call graph, or MIR instrumentation tracing executed functions; pinned to `nightly-2023-12-28` | [github](https://github.com/tum-i4/rustyrts) |
| cargo-nextest | none | process per test, which is the attribution the tools above borrow; hash and slice partitions; rerun of failures | [nexte.st](https://nexte.st/docs/design/why-process-per-test/) |
| cargo-llvm-cov | aggregate | wraps `-C instrument-coverage`; no per-test attribution | [github](https://github.com/taiki-e/cargo-llvm-cov) |
| minicov | per capture | an LLVM profile runtime with `reset_coverage` and `capture_coverage`; nightly; capture is not thread-safe | [github](https://github.com/Amanieu/minicov) |
| guppy determinator | package | packages changed between two commits | [github](https://github.com/guppy-rs/guppy/tree/main/tools/determinator) |
| Bazel `rules_rust`, bazel-diff | Bazel target | input hashes at two revisions | [bazel-diff](https://github.com/Tinder/bazel-diff) |
| Datadog, CloudBees Smart Tests | — | Rust is not listed by Datadog; CloudBees has no cargo runner | [docs](https://docs.datadoghq.com/tests/test_impact_analysis/) |

Every tool that attributes per test uses a process per test. None resets the
counters in one process, though compiler-rt exports
`__llvm_profile_reset_counters` and `__llvm_profile_write_file`
([clang docs](https://clang.llvm.org/docs/SourceBasedCodeCoverage.html)).

## Research

- Hundsdorfer, Würsching, Pretschner,
  [*RustyRTS: Regression Test Selection for Rust*](https://ieeexplore.ieee.org/document/10988992/),
  ICST 2025, pp. 338–348. The first RTS for Rust. On mutants in 9 projects the
  three modes selected 99.99%, 97.87% and 99.97% of the failing tests; on the
  history of 13 repositories they cut end-to-end test time to 67.8%, 62.5% and
  52.8% of retest-all. It treats dynamic dispatch and compile-time evaluation.
- Cazzola, Maurina, Ghosh,
  [*BabelRTS: Polyglot Regression Test Selection*](https://ieeexplore.ieee.org/document/10944548/),
  TSE 2025. Static, file grain, twelve languages over 142 systems; whether Rust
  is one of them is not confirmed.

## What would discharge it

**1. A both-texts verdict for Rust.** The reader is there; the verdict is not.
Regions are a function, a method, a closure, a `match` arm, an `if`/`else` arm
and a loop body, each identified by its address in the tree and a digest of its
own text. `none` for comments, doc comments that are not doctests, and
formatting; `bodies` for an edit inside functions; `values` for a changed
`static`, `const` or `const fn`, charged to what reads it; `load` for a changed
`mod`, `use`, `#[cfg]` or feature.

**2. The recorder reads rustc's map and counters itself.** The mapping comes
from the binary's `__llvm_covmap` and `__llvm_covfun` sections, keyed by the
binary signature `%m` gives, and is read once per build. Counters come from the
`.profraw`. A counter region is charged to the innermost tree region that
contains it. A region inside a macro expansion is charged to the region of the
call site.

**3. Per test, two ways, measured against each other.** A process per test
through nextest with `LLVM_PROFILE_FILE` per test is the known answer.
Resetting and writing in one process, around each test, is the cheaper one if
the test harness can be bracketed and tests run one at a time; the default
harness runs tests on threads, so overlapping tests are a group, as in
[0073](0073-a-test-owns-the-files-its-services-ran.md). The spec does not pick;
the replay does.

**4. What no counter sees selects by reach.** A `macro_rules!` or proc-macro
body runs at compile time, a `build.rs` runs before the test, `include_str!` and
`include_bytes!` read files, a `#[derive]` generates code with no source line of
its own, and a generic is compiled into its caller's crate. Each is named by
the verdict and answered by the walk, as cargo-affected's documented false
negatives show is needed.

**5. The addon is a journey participant in-process.** A Vitest case that calls a
napi-rs function writes one row that names both sides: the JavaScript regions
through `presence-v5` and the Rust regions through the counters, cut at the same
test boundary. A Rust service (axum, tonic) takes the journey id from `baggage`
or the OpenTelemetry trace id carried by `tracing`, and runs in a lane.

**6. Measured on public code and on this repository.** A subset of RustyRTS's
13 repositories is replayed, so the numbers are comparable with the paper, with
seeded faults as in [`jvm/measure`](../../jvm/measure/README.md). The recording
cost is measured against a bare `cargo nextest run` and against
`cargo llvm-cov nextest`. This repository's own `packages/sense` suite is the
cross-language case.

## Acceptance

1. A doc-comment or `rustfmt` edit selects nothing. An edit inside one function
   selects only the tests whose rows name its regions.
2. A changed `const` selects every test that reads it, including tests whose rows
   lack the declaring file. A changed `macro_rules!` selects the tests of every
   expansion site.
3. A changed `build.rs` or an `include_str!` target selects by reach.
4. Overlapping tests in one process never produce a row that misses a region
   either ran.
5. A Vitest test that calls into the sense addon has a row naming the Rust
   regions it ran, and an edit to one of them selects it.
6. The replay reports tests run and faults missed for this selector,
   cargo-affected and RustyRTS's published figures, and the recording cost.

## Boundary

`unsafe` FFI into C and inline assembly are recorded as the calling region. A
test that spawns a binary is a process edge and follows
[0036](0036-a-journey-crosses-processes.md).
