# Spec 0078 — a Swift test is selected inside its target

**Missing:** anything narrower than a target for Swift. `variance reach` reads
Swift and answers at the grain the language gives it: an import reaches a whole
target, and a file reaches every file beside it. No recorder writes a row for an
XCTest or Swift Testing case, no both-texts verdict reads a changed `.swift`
file, and a UI test's journey stops at the app's process.
**Built on:** [ADR-0074](../context/adr/0074-one-reader-per-tree-sitter-language.md)
(the Swift reader is the addon's, which also keeps the grammar off Node's WASM
path), [ADR-0069](../context/adr/0069-every-answer-has-an-owner.md) (the LLVM
profile runtime is the owner),
[ADR-0072](../context/adr/0072-a-change-is-read-before-it-is-charged.md),
[ADR-0070](../context/adr/0070-a-journey-travels-as-trace-context.md),
[0073](0073-a-test-owns-the-files-its-services-ran.md), and
[0027](0027-a-test-is-selected-by-what-it-executed.md).

## Purpose

Every Swift tool that selects without a vendor service stops at the target, and
Tuist's documentation says why: test-to-source dependencies inside a target
cannot be read from the project. That is true of the project and false of a
run. Swift builds with `-profile-generate -profile-coverage-mapping` (Xcode's
code coverage, SwiftPM's `--enable-code-coverage`) emit the same LLVM counters
and coverage map as Rust, so the region grain [0077](0077-a-rust-test-is-selected-by-the-regions-it-ran.md)
reads is here too, and one mapping reader serves both.

## Existing solutions

| Tool | Grain | How it decides | Source |
| --- | --- | --- | --- |
| XcodeSelectiveTesting | test target | a target and package graph from `dump-package` and the Xcode project, walked up from changed files; rewrites the test plan or prints `-only-testing:` | [github](https://github.com/mikeger/XcodeSelectiveTesting) |
| Tuist selective testing | test target | a hash of each test target and its transitive dependencies, compared with the last passing run; "the maximum granularity of selective testing is at the target level" | [docs](https://tuist.dev/en/docs/guides/features/projects/hashing) |
| Bazel `rules_swift`, `rules_apple` | Bazel target | the action cache, and target-determinator or bazel-diff between commits; coverage per test target | [rules_swift](https://github.com/bazelbuild/rules_swift) |
| Xcode coverage (`xccov`) | per run | line coverage per target, file and function for a whole `.xcresult`; no per-test breakdown | `man xccov` |
| Datadog Test Impact Analysis (dd-sdk-swift-testing ≥ 2.2.0) | covered files, per test | starts LLVM gathering at `testWillStart`, snapshots the profile at `testDidFinish`; skips a test whose covered files match a commit where it passed. Only one coverage session at a time, so tests must run serially. | [docs](https://docs.datadoghq.com/tests/test_impact_analysis/setup/swift/), [swift-code-coverage](https://github.com/DataDog/swift-code-coverage) |
| CloudBees Smart Tests (XCTest) | target or class | test history and change similarity, no coverage; prints `-skip-testing:` | [cli](https://github.com/cloudbees-oss/smart-tests-cli/blob/main/smart_tests/test_runners/xctest.py) |
| Teamscale | aggregate | ingests `xccov` and `.xcresult` coverage; per-test Swift is not documented | [docs](https://docs.teamscale.com/reference/upload-formats-and-samples/) |

## Research

No paper on regression test selection for Swift, iOS or XCTest was found (web,
arXiv, dblp). The nearest is Android:

- Do, Yang, Che, Hui, Ridgeway,
  [*Redroid: A Regression Test Selection Approach for Android Applications*](https://ksiresearch.org/seke/seke16paper/seke16paper_223.pdf),
  SEKE 2016. Method-level change impact plus per-test block coverage; on
  Inetify, 16–83% of 206 tests selected for 4 s of overhead against 134 s.
- [*Regression Test Selection for Android Applications*](https://dl.acm.org/doi/10.1145/2897073.2897127),
  MOBILESoft 2016, apparently the short form of Redroid.
- Sharma, Nasre, [*QADroid: Regression Event Selection for Android Applications*](https://dl.acm.org/doi/10.1145/3293882.3330550),
  ISSTA 2019. Static, event grain; 58% fewer activities and 74% fewer events
  over 1,105 releases of 50 apps.
- Machalica et al., [*Predictive Test Selection*](https://arxiv.org/abs/1810.05286),
  ICSE-SEIP 2019. History-based, language-agnostic, at Facebook.

No study measures per-test coverage selection for Swift, or the cost of a
per-test LLVM profile dump on iOS.

## What would discharge it

**1. A both-texts verdict for Swift.** Regions are a function, an initializer, a
computed property accessor, a closure, a `switch` case, an `if`/`guard` arm and
a loop body. `none` for comments and formatting; `bodies` for edits inside them;
`values` for a changed global or `static let`, charged to readers; `load` for a
changed `import`, `@main` or conditional compilation block. A change to a
protocol requirement or a stored property changes layout and witness tables for
every conformer, and is `load` for the target.

**2. The recorder shares 0077's mapping reader.** The coverage map is read once
per binary signature; the counters are cut per test at the test framework's own
boundary: `XCTestObservation`'s `testCaseWillStart` and `testCaseDidFinish` for
XCTest, and the equivalent trait or event for Swift Testing. That boundary is the
framework's, registered by the user once, not a call in every test.

**3. Parallel testing is process parallelism or it is a group.** Xcode's
parallel testing runs clones of the test runner in separate processes, each
with its own counters, which is safe. Swift Testing runs cases concurrently in
one process by default, which is 0073's reset problem: overlapping cases are
recorded as a group or as incomplete. This is the constraint Datadog answers by
requiring serial runs; here it widens instead of refusing.

**4. What no counter sees selects by reach.** Property wrappers and macros
(`@Observable`, `#Preview`) generate code, `@inlinable` bodies are copied into
clients, resources in a bundle and `Info.plist` run no code, and
`Package.swift` is a program. Each is named by the verdict and answered by the
target walk.

**5. A UI test is a journey across two processes.** XCUITest drives the app in
its own process. The test sets the journey id in `launchEnvironment`, which is
the user's carrier, not one we inject; the app's recorder writes its part keyed
by that id, and the fold joins it to the case. An app calling a backend takes
the id onward as `baggage` or an OpenTelemetry trace id.

**6. Measured on a public package.** A SwiftPM package with a history and a
real suite (swift-collections or swift-nio) is replayed commit by commit: target
selection as XcodeSelectiveTesting and Tuist make it, and region selection from
the record, with seeded faults. Recording cost is measured against a bare
`swift test` and against `--enable-code-coverage`, on macOS and Linux.

## Acceptance

1. A comment or formatting edit selects nothing. An edit inside one function
   selects only the tests of its target whose rows name its regions, not the
   whole target.
2. A changed protocol requirement selects every test of the target and of the
   targets that import it.
3. Concurrent Swift Testing cases never produce a row that misses a region
   either ran.
4. An XCUITest case whose app process ran a region has that region in its
   journey.
5. The replay reports tests run and faults missed against target-grain
   selection on the same commits, and the recording cost.

## Boundary

Objective-C and C in a mixed target are recorded as files through their own
coverage, not as Swift regions. On-device runs are not in scope; the simulator
and macOS hosts are.
