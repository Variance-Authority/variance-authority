# Spec 0098 — the runner is handed its selection

**Missing:** a way for a runner to receive the selection other than through its
command line. `variance select --format vitest` and `--format jest` print the
selection as runner arguments, and the documented loop substitutes them into the
runner's argv. That breaks at the scale the product is for. macOS stops a
command line at 1 MiB, which is about seven thousand absolute `--exclude=` paths
of this repository's length. Windows `cmd` stops at 8,191 characters, about
sixty. A private-corpus suite has about twenty-five thousand test files, and one
change to a hub reaches most of them. The format is also where runner knowledge
leaked into the selector: `select.ts` writes Vitest's absolute `--exclude` paths
and Jest's escaped ignore patterns, so how a runner matches a path is decided in
the one place that should not know which runner is asking.
**Built on:** the recording seams in `@variance-authority/sense` — `./vitest`,
`./jest`, `./rstest` and `./runner` — each a `withTestSelection` that wraps the
project's configuration and contributes without replacing anything
([ADR-0043](../context/adr/0043-an-extension-does-not-own-its-host.md),
[ADR-0068](../context/adr/0068-a-seam-takes-the-hosts-own-unit.md)). The safe
skip list of [0046](0046-the-safety-rule-lives-in-one-place.md), bounded by what
the record witnessed
([ADR-0062](../context/adr/0062-a-skip-list-is-bounded-by-what-the-record-witnessed.md)),
and the refusal of a run list
([ADR-0067](../context/adr/0067-a-run-list-refuses-where-a-skip-list-degrades.md)).
The stages of [0091](0091-a-suite-is-selected-by-a-machine.md), which already
asks for one composition shared by `select` and `run --since`. `commit-runs.ts`,
which carries a test a partial run did not run forward from where it last ran.

## Purpose

A seam already sits inside the runner's own configuration, in every process the
runner starts, for every runner the record covers. It is the one place that can
take a selection as a value — a set, read from the record, in memory — instead
of as text a shell has to carry. Handed there, the selection has no size limit
and no runner-specific encoding, and the selector stops knowing which runner is
asking.

The loop this replaces runs two programs and joins them with a shell:

```bash
yarn vitest run $(yarn variance select --suite unit --format vitest)
```

The loop it becomes runs one, the runner the project already runs, with one
variable set:

```bash
VARIANCE_AUTHORITY_SINCE=origin/main yarn vitest run
```

## Definition

### One composition, handed to the seam

The selection is computed by one function, `selectSuite`, over the stages of
[0091](0091-a-suite-is-selected-by-a-machine.md):

```ts
selectSuite({ root, since, suite, atDistance? }): Promise<SuiteSelection>

interface SuiteSelection {
  readonly whole: ReadonlySet<string>;   // the suite's test files the record holds
  readonly skip: ReadonlySet<string>;    // safe to skip: recorded, and entered nothing changed (ADR-0062)
  readonly declined?: string;            // set when a reading could not be made, and which
  readonly notes: readonly string[];     // what a person reads; never parsed
}
```

`skip` is the whole answer a runner acts on. A file the runner discovers and the
record never saw is not in `skip`, so it runs; the seam never turns the
selection into a list of files to run.

`variance select` becomes one caller: it formats a `SuiteSelection` and prints
it. Each seam is another: it asks for the selection once per run, in the process
that starts the run, and drops the files in `skip` at the runner's own drop
point.

The composition cannot move into `sense` whole. `selectOutput` in
`select-command.ts` reads, besides the stages already in `sense/test-selection`:
the install comparison (`installed.ts`, through `sense/lock`), the `before`
closure (`select-before.ts`), the git reading (`since.ts`, `checkout-read.ts`),
the mainline base (`mainline-base.ts`), the suite record and its base
(`suite-record.ts`, `suite-base.ts`), the source graph (`source-graph.ts`), the
history and the store (`resources.ts`), and the execution journal
(`execution-input.ts`). The last parses through `@variance-authority/distill`,
which depends on `sense`, so the composition in `sense` is a package cycle.

What is runner knowledge — where and how to drop a file — stays in the seam in
`sense`, which takes the selection as a function it calls once: `skip: () =>
Promise<ReadonlySet<string>>`. The composition lives above `sense` and `distill`
and hands that function in. Open question 1 is where.

### The trigger is the quantity `--since` already names

A seam selects when `VARIANCE_AUTHORITY_SINCE` is set, and records the whole
suite otherwise. The value means what `--since` means today: the base a diff is
measured from when the journal names no commit. When the journal names one, the
journal's commit wins, because its line ranges are coordinates in that commit's
text and nothing else's (`select-command.ts`). So the variable's presence
switches selection on, and its value is a fallback; this spec keeps the
behaviour and the flag's name together rather than give one meaning two names.

A variable reaches every worker the runner forks and needs no edit to a
configuration the project shares with CI. `VARIANCE_AUTHORITY_AT_DISTANCE`
carries a leg the way `--at-distance` does, and is read only beside
`VARIANCE_AUTHORITY_SINCE`.

No wrapper command runs the runner. `variance test` would be a replacement for
the host's own entry point, which ADR-0043 rules out, and it would have to learn
every runner's flags to pass them through.

### Each runner drops at its own point

| Runner | Drop point | What it costs |
|---|---|---|
| Jest 30 | A `filter` module. Jest runs it before sharding, sorting and `--listTests`. | `filter` is a global setting, not a project one, so the seam sets it on the global configuration and chains the project's own. A command-line `--filter` replaces it and `--skipFilter` turns it off; either means no selection, and the seam says so on stderr. Jest 29's return shape is checked when the seam is written; 29 is in range only if it matches or is adapted in the seam. |
| Vitest 2–5 | A `sequence.sequencer` that wraps the project's sequencer and removes skipped specifications before calling its `shard` and `sort`. Vitest publishes no filter hook in any major. | The sequencer is read from the root configuration only, so under `projects` the seam wraps the root. Reporters are handed the collected paths, skipped files included (`onPathsCollected` in 2, `onTestRunStart` in 4); the summary's "Test Files" count is the run's. The run the seam records is the set the sequencer kept, not the paths reporters were handed. |
| Rstest | None found. The seam's `include` decides which bundled modules are product source, for instrumentation, and drops no test file. | Unresolved; out of the first cut until a drop point is named. |
| Playwright Test | `--test-list-invert <file>`, a skip list as a file. | The flag, not a config hook, so the seam cannot add it alone. It matches paths relative to the config's `rootDir`, compares every test against every entry, and loads files before it drops them: the path-form and quadratic costs this spec refuses for Vitest's `test.exclude`. Out of the first cut. |
| `./runner` | The `skip` function, exported as it is. The author drops files where their runner discovers them, as they place the four existing calls. | Nothing new. |

Runner versions are known in the seam for that runner and nowhere else. A
configuration wrapped twice selects once: the second wrap sees the first's mark
and adds nothing.

### A seam declines and refuses exactly where `select` does

`select` declines to narrow in four named cases — no journal, no diff, no
install to compare, nothing recorded whole — and skips nothing, saying which on
stderr. A seam asked to select does the same: the whole suite runs and
`declined: <which>` is printed. This keeps 0091's posture that an absent reading
never narrows. Where `select` refuses by name — a journal that names no commit
with no `since` beside it, a snapshot it cannot read — the seam fails the run
with the same message.

A selection that skips everything is an answer: the change reached no test the
record holds. The seam prints `selected none of M`, and the run exits as the
runner exits with no tests. Jest exits 1 there unless the project set
`passWithNoTests`; the seam does not set it, because that is the runner's option
(ADR-0068).

### One selection per commit and record

A sharded run starts one process per shard, often on separate machines, and each
computes its selection. Both Jest and Vitest sort by a hash and slice, so where
a file lands depends on the whole list: two shards that computed different
selections can each drop a file the other assigned. A selection is therefore a
function of the commit, the record, the suite and the leg, and a sharded run
hands every shard the same record. Dropping happens before sharding in both
runners, so every shard slices the same list.

### Watch mode does not select

Jest re-runs through the filter and Vitest through the sequencer, so a file
edited during a watch session could stay dropped by a selection computed before
the edit. A seam in watch mode ignores the variable and says so once.

### A selected run is a partial run

The seam records what ran and nothing else. `commit-runs.ts` already carries
every test a partial run did not run forward from where it last ran, which is
what `$(variance select)` runs produce today. Selection in the seam changes the
command line that started the run, not the record the run writes.

## What would discharge it

**1. `selectSuite` exists where the seams can be handed it.** It composes
0091's stages and returns a `SuiteSelection`. `selectOutput` calls it and only
formats. The runner argument encodings in `select.ts` — `jestIgnore` and the
Vitest path form — go with the formats in item 6.

**2. The Jest seam drops through `filter`.** With `VARIANCE_AUTHORITY_SINCE`
set, a Jest run under `withTestSelection` does not start a file in `skip`, under
`--shard` and `--listTests` alike, a project `filter` still runs, and
`--filter` or `--skipFilter` on the command line is reported.

**3. The Vitest seam drops through the sequencer.** The same, on Vitest 2 to 5,
under `--shard` and under `projects`, with a project sequencer still consulted.

**4. Declined, refused and empty are reported.** Each seam prints `selected N of
M`, `declined: <which>` or `selected none of M`, and fails by name where
`select` refuses.

**5. This repository uses it.** `tools/test-since.mjs` and the
`tools/since-*.mjs` helpers are deleted, and what they did is carried as
follows. `test:since` is the runner calls for each suite, joined so the first red
suite stops the rest, each with the variables set. `--dry-run` is `variance
select`, which prints the selection for a person; the pre-verify reference's
`read` lines are read from it. `--shard` and the matrix are the runner's own
`--shard`. `verify:near` and `verify:far` set `VARIANCE_AUTHORITY_AT_DISTANCE`.

**6. The argv formats are deprecated.** `--format vitest` and `--format jest`
print a deprecation on stderr that names the variable, for one minor release,
then are removed without an alias, with their pages in `packages/cli/README.md`
and `docs/coverage-test-selection.md`.

**Acceptance:** a change that reaches twenty-five thousand test files of a
generated suite is run by Jest and by Vitest with the variable set, on macOS and
on Windows, with no argument longer than the command the project already typed.
The files each runner starts are the files it discovers minus `skip` from
`variance select` for the same commit and suite, and a test file the record has
never seen runs.

## What it forecloses

**No runner knowledge in the selector.** `selectSuite` returns
repository-relative test files. How a runner names, matches or shards them is
its seam's question.

**No selection on argv.** No format prints a list meant to be substituted into a
command line. A list for a person, or for a tool that reads a file, is still
printed.

**No second composition.** `variance select`, `variance run --since` and every
seam call one function. A seam that reads the record its own way is a defect.

## Open questions

These are the owner's to decide; each has a recommendation.

1. **Where `selectSuite` lives.** In a new package above `sense` and `distill`,
   which the configuration imports a selecting seam from, wrapping `sense`'s
   (recommended: the cycle is in the composition, so the composition moves, and
   `sense` keeps only the drop point). Or the journal's parser moves from
   `distill` down into `sense` and the composition with it, so the import a
   configuration already has is enough; this is the smaller import change and
   the larger move.
2. **The trigger.** `VARIANCE_AUTHORITY_SINCE` with `--since`'s meaning
   (recommended: one quantity, one name, already documented), a separate on
   switch beside it, or a seam option alone.
3. **Vitest's drop point.** The sequencer (recommended), or rewriting
   `test.exclude` at config time, which stops collection but brings back the
   path form per major and matches twenty-five thousand patterns against
   twenty-five thousand files.
4. **The test-host chart.** `.compass/externals/test-host.md` lists four things
   asked of a runner, and a fifth for case-level recording. Dropping files is a
   sixth ask and changes the chart.
5. **Exit code on an empty selection.** The runner's own no-tests exit with the
   count printed (recommended: the seam does not set the runner's options, and a
   project that wants 0 already has `passWithNoTests`), or 0 by the seam's
   choice, which overrides that option.
6. **Runners in the first cut.** Jest and Vitest (recommended: they have a drop
   point that costs nothing per file; Rstest has none named and Playwright's
   brings back the costs refused above), or all four together.
7. **The deprecation window** for `--format vitest|jest`: one minor release
   (recommended: the documented loop uses them, so a reader gets one release of
   the message naming the variable), or removal in the change that lands item 1.
