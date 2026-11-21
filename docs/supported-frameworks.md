# Supported frameworks

[Variance Authority](README.md) records which tests ran each line of your code under Vitest
4.1+, Jest 30, Rstest, Playwright, Storybook, a JVM on the JUnit Platform, Cargo,
and any other runner you wrap by hand. This page lists what each of them does with that
record, and where each capability is turned on.

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
| Any other runner | each case you hand to `observer.case` | `variance select` prints them | no | no | yes, in Node | [a custom collector](start-custom.md) |

"Itself" means the runner reads `VARIANCE_AUTHORITY_SINCE` and never starts the
files it leaves out. "`variance select` prints them" means the same list comes
out of the CLI, one path per line, for the script that starts your runner to
leave out.

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
| Any other runner | `@variance-authority/sense` | [`observer.case`](../packages/sense/README.md#record-a-runner-this-package-has-no-seam-for) around the body of each case |

[What each host records](execution-record.md#what-each-host-records) says what
the record holds under each of them.

## Leave out the tests a change did not reach

Under Vitest, Jest, Rstest and Playwright, `VARIANCE_AUTHORITY_SINCE` on the run
you already call leaves out the test files the record proves a change did not
reach. `variance run --since` leaves out the stories a change did not reach.
Under a JVM, Cargo and any other runner, `variance select` prints the same list for
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
runner above but a JVM and Cargo. [Record one](test-stories.md#record-one) lists each
runner's setup.

## Add visual review

Visual review captures what a test or a story renders and compares it with the
approved image. Each link in the table's last column is the first page for that
runner; [your first run](start.md) covers the choice when more than one applies.
