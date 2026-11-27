# Supported frameworks

[Variance Authority](README.md) records which tests ran each line of your code under Vitest
4.1+, Jest 30, Rstest, Playwright, Storybook, `node:test`, a JVM on the JUnit
Platform, Cargo, pytest, and any other runner you wrap by hand. This page lists
what each of them does with that record, when a test file it leaves out could
still have failed, and where each capability is turned on.

## What each runner does

| Your tests run under | [Records which tests ran](#record-which-tests-ran-each-line) | [Leaves out unreached tests](#leave-out-the-tests-a-change-did-not-reach) | [Skips unreached cases](#skip-the-cases-a-change-did-not-reach) | [Shards by recorded time](#split-a-run-across-ci-jobs) | [Test stories](#record-a-test-story) | [Visual review starts from](#add-visual-review) |
|---|---|---|---|---|---|---|
| Vitest 4.1+ | each case; each file in browser mode | itself | yes | yes | yes | [jsdom](start-unit.md) or [browser mode](start-vitest-browser.md) |
| Jest 30 | each case | itself | yes | yes | yes | [jsdom](start-unit.md) |
| Rstest | each case; each file in browser mode | itself | no | no | yes | [jsdom or `@rstest/playwright`](start-rstest.md) |
| Playwright | each test | itself | no | yes | yes | [the spec](start-playwright.md) |
| Storybook | each story | `variance run --since` skips them | n/a: a story is a case | `variance run --shard` | yes | [the story](start-storybook.md) |
| [A JVM on the JUnit Platform](jvm.md) | each test class | `variance select` prints them | no | no | no | no |
| [Cargo](rust.md) | each test | `variance select` prints them | no | no | no | no |
| [pytest](python.md) | each test | `variance select` prints them | no | no | no | no |
| [`node:test`](node-test.md) | each case | itself | no | no | yes | no |
| `bun test` | not recorded: [no hook to attach](node-test.md#bun-is-not-recorded) | no | no | no | no | no |
| XCTest and Swift Testing | not recorded: [`variance reach`](polyglot.md#one-reader-per-language-one-graph) answers for Swift by target | no | no | no | no | no |
| Any other runner | each case you hand to `observer.case` | `variance select` prints them | no | no | yes, in Node | [a custom collector](start-custom.md) |

"Itself" means the runner reads `VARIANCE_AUTHORITY_SINCE` and never starts the
files it leaves out. "`variance select` prints them" means the same list comes
out of the CLI, one path per line, for the script that starts your runner to
leave out.

## When you can rely on what was left out

Every runner keeps one rule: a test file is left out only when its last whole
run covered none of the code you changed, and a test file the record cannot
answer for runs. [What a skipped test promises](selection-safety.md) states the
rule and every case where it runs more.

What differs between runners is what the recorder can see, and that depends on
one thing: **whether each test file runs in a process or module graph of its
own.** When it does, everything the file needs runs again for it and is
recorded under it. When several test files share one process, work done once
for all of them is recorded under the first file that ran it. A later file that
only uses the result is not charged, so a change to that work can leave the
later file out.

A test file left out this way is not a silent pass forever. The whole-suite run
on your main branch runs it, and [that run is where it
fails](selection-safety.md#the-whole-run-on-main-catches-what-a-skip-hid). Until
then, a pull request can be green without it. The table names, for each runner,
when that can happen and what closes it.

| Your tests run under | Each test file runs in | A test file that should run can be left out when | What closes it |
|---|---|---|---|
| Vitest, Rstest | its own module graph, unless `isolate` is `false` | the suite sets `isolate: false` and records `entries` or `presence`, and a file only reads a value another file evaluated; or a function returned a result cached from an earlier case | `isolate: true`, or `symbol` precision: [a record needs a module graph per test file](selecting.md#a-record-needs-a-module-graph-per-test-file); [a result a cache returned](selecting.md#a-result-a-cache-returned) |
| Jest 30 | its own module registry | a function returned a result cached from an earlier case | [a result a cache returned](selecting.md#a-result-a-cache-returned) |
| Playwright | a new page per test, unless you keep one | a function in the page returned a result cached from an earlier test | [a result a cache returned](selecting.md#a-result-a-cache-returned) |
| Storybook | one preview for every story | a function returned a result cached from an earlier story | [a result a cache returned](selecting.md#a-result-a-cache-returned) |
| `node:test` | its own process | a function returned a result cached from an earlier case | [a result a cache returned](selecting.md#a-result-a-cache-returned) |
| [A JVM on the JUnit Platform](jvm.md) | one JVM for every test class it runs | JUnit runs classes in parallel inside one JVM; a thread a class started, or the common pool, is still busy when the next class starts; or a method runs once and later classes reuse its result, such as a `@Bean` method of a cached Spring application context | record with JUnit's parallel execution off, and read `survivor` and `pool-busy` in `events.tsv`: [what a row holds](jvm.md#what-a-row-holds) |
| [Cargo](rust.md) | its own process, one per test | a test starts a process with a cleared environment; or a Cargo configuration file, or a file in a directory a build script watches, is added after the recording | record again after adding one: [what a row holds](rust.md#what-a-row-holds) |
| [pytest](python.md) | one process for the whole suite | a fixture with `session` or `package` scope, or a function cached across test files, is charged only to the first test that ran it; a test only reads a value a module sets as pytest imports it, such as a constant, and calls none of the module's functions; a dependency or a pytest setting changes in a file the suite does not name in `before`, such as `pyproject.toml` or `requirements.txt`; or the record came from a run narrowed with `-k` or `-m` | name the project's manifests, lockfiles and pytest configuration in the suite's [`before`](changes-before-and-beyond.md#how-a-change-before-reach-is-declared), and record the whole suite: [what a function is](python.md#what-a-function-is) |
| Any other runner | whatever your harness gives it | work of one case runs outside the body you hand to `observer.case` | bracket the whole case: [Sense](../packages/sense/README.md#record-a-runner-this-package-has-no-seam-for) |

Three runners need a note the table does not fit:

- **Cargo runs no doctests.** `variance cargo` records test binaries, so a
  doctest is in no record and in no list `variance select` prints. Run `cargo
  test --doc` beside it.
- **Kotlin runs through the JVM agent with coarser regions.** Its methods are
  cut from the class's line table, because javac does not parse Kotlin, so an
  edit near a method's last line can charge every test that ran the file. The
  agent's own tests record Java suites only.
- **`bun test` and Swift's runners record nothing, so they leave nothing out.**
  Every test runs. For Swift, [`variance reach`](polyglot.md#one-reader-per-language-one-graph)
  lists what a diff can reach at target grain.

## Record which tests ran each line

Every other capability reads this record, so it is the first thing a suite sets
up. It is one wrap in the configuration your runner already reads:

| Your tests run under | Install | Wrap |
|---|---|---|
| Vitest | `@variance-authority/sense` | [`withTestSelection`](../packages/sense/README.md#cut-a-vitest-run-down-to-a-diff) from `@variance-authority/sense/vitest`, around `defineConfig` |
| Jest 30 | `@variance-authority/sense` | [`withTestSelection`](../packages/sense/README.md#cut-a-jest-run-down-to-a-diff) from `@variance-authority/sense/jest`, around the configuration you export |
| Rstest | `@variance-authority/sense` | [`withTestSelection`](../packages/sense/README.md#cut-an-rstest-run-down-to-a-diff) from `@variance-authority/sense/rstest`, inside `defineConfig` |
| Playwright | `@variance-authority/playwright-test` | [`withTestSelection`](../packages/playwright-test/README.md#record-what-each-spec-executed) from `@variance-authority/playwright-test`, inside `defineConfig` |
| Storybook | `@variance-authority/storybook-collector` | [`tests: true`](../packages/storybook-collector/README.md#skipping-stories-nothing-touched) in `storybookCollector` |
| A JVM on the JUnit Platform | the agent and listener jars | [the agent on the test JVM](jvm.md#record-a-jvm-suite) |
| Cargo | `@variance-authority/cli` | none: [`variance cargo`](rust.md#record-a-cargo-suite) runs `cargo test` |
| pytest | `@variance-authority/cli` | none: [`variance python`](python.md#record-a-pytest-suite) runs `pytest` |
| `node:test` | `@variance-authority/sense` | [`runNodeTest`](node-test.md#record-the-suite) from `@variance-authority/sense/node-test`, in place of `node --test` |
| Any other runner | `@variance-authority/sense` | [`observer.case`](../packages/sense/README.md#record-a-runner-this-package-has-no-seam-for) around the body of each case |

[What each host records](execution-record.md#what-each-host-records) says what
the record holds under each of them.

## Leave out the tests a change did not reach

Under Vitest, Jest, Rstest, Playwright and [`node:test`](node-test.md), `VARIANCE_AUTHORITY_SINCE` on the run
you already call leaves out the test files the record proves a change did not
reach. `variance run --since` leaves out the stories a change did not reach.
Under a JVM, Cargo, pytest and any other runner, `variance select` prints the same list for
the run to skip. The runner says what it kept before it starts:

```text
selected 12 of 340
```

[Run the tests an edit needs](test-an-edit.md) walks through both.

## Skip the cases a change did not reach

Under Vitest and Jest, `VARIANCE_AUTHORITY_GRAIN=case` also skips the cases of a
kept file that entered nothing the change touched. Every other runner runs a
kept file whole. [Skip the cases your edit did not
reach](test-an-edit.md#skip-the-cases-your-edit-did-not-reach) says when a file
still runs whole.

## Split a run across CI jobs

Vitest, Jest and Playwright place test files on shards by the time each took on
the mainline's last run, and `variance run --shard` places Storybook stories by
the same rule. [Split a test suite across CI jobs](sharding.md) sets it up.

## Record a test story

`VARIANCE_AUTHORITY_STORY=1` records what one test did, in order, under every
runner above but a JVM, Cargo and pytest. [Record one](test-stories.md#record-one) lists each
runner's setup.

## Add visual review

Visual review captures what a test or a story renders and compares it with the
approved image. Each link in the table's last column is the first page for that
runner; [your first run](start.md) covers the choice when more than one applies.
