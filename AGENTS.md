# Working on this repository

## Before the first command

Node 22 or newer, and Yarn 4 through Corepack — the root `package.json` pins the
exact version in `packageManager`. Every command in this file is run from the
repository root, in a git checkout that has its history: the checks read the
**index** with `git ls-files`, so a file that is not tracked is a file they
cannot see.

```bash
yarn install && yarn build
```

`build` first, and again after pulling. Nothing here imports another package by
relative path, so a check asking the CLI what a setting means resolves through
the manifest's `exports` into `dist/` — the same path a consumer takes. A stale
`dist/` answers wrongly rather than not at all, which is the expensive failure
described under **Verifying**.

`yarn test:since` needs one more thing: a recording. `yarn test` writes it, and
until `yarn test` has run in this checkout there is nothing for it to read.

## Where writing goes

Each kind of writing has one home and one job. A file that does two jobs is
split, not extended.

| Place | Job | Tense |
|---|---|---|
| `docs/*.md` | What the thing **is** and how it is measured. Consumption and advertising material for someone deciding whether to use it. | Present |
| `docs/specs/` | What is not built. One vacancy per file. | Future |
| `docs/context/adr/` | One decision, its alternatives, and its cost. | Present, dated |
| `docs/context/journal/` | What one attempt cost and what it taught. | Past, dated |
| `docs/context/checkpoint.md` | Current state of the whole. | Present, dated |
| `README.md`, `packages/*/README.md`, `cases/*/README.md` | Entry points. Route the reader; do not restate a doc. | Present |
| Source docstrings | Why this code is shaped this way. | Present |

## The rules for writing are in `docs/AGENTS.md`

Who the reader is, what to read before writing, what a `docs/` page may not do,
the editorial direction, and the register every published sentence is held to:
all of it lives in [`docs/AGENTS.md`](docs/AGENTS.md). It governs the whole
published surface — the root `README.md`, `docs/`, package and example
`README.md` files, the site, CLI output and error messages — so read it before
writing any of them, not only when the file you are editing sits under `docs/`.


Writing rules live in [`docs/AGENTS.md`](docs/AGENTS.md): who the reader is,
what to read before writing, the editorial direction, and the register every
published sentence is held to. They govern the whole published surface — the
root `README.md`, `docs/`, package and example `README.md` files, the site, CLI
output and error messages — so read that file before writing any of them, not
only when the file you are editing sits under `docs/`.

## The project reports on itself in code

How far along the project is — what is written and has never run, what nobody
has used, what is measured and what was only ever asserted — is a **status
report**, and it does not go in `docs/` either. `docs/` says what the product
is. A status report written as prose rots in one direction: its optimistic
claims get corrected the moment somebody trips over one, and its pessimistic
claims survive the work landing, because no checker can resolve an absence and
nothing fails when a negative stops being true. A paragraph saying "nothing is
licensed" outlives the licence by however long it takes a human to notice.

So a status claim is written at the line that owns it:

| Marker | What it is for |
|---|---|
| `it.todo('…')` | A claim that would hold if something ran. The title is the sentence that becomes true, and it names what would make it run. |
| `// FIXME:` | A defect in code that ships and works. |
| `// TODO:` | A limb that is not written. |

The boundary between `it.todo` and `// TODO:` is mechanical, not a matter of
taste. An `it.todo` may only live in a file a runner collects — `*.test.*`,
`*.check.*`, `*.measure.*` — because a todo anywhere else is a function call
nothing ever makes. So: a gap a runner could state as a sentence goes in the
collected file that would own it; a gap in a module, a tool or a config is
`// TODO:` at the line. A todo title is `<the sentence that becomes true> —
needs <what would make it run>`; the em dash and the word `needs` are the
checked shape, and a title like "not implemented" fails.

```bash
yarn unrun
```

prints every marker, grouped, with `file:line` — the self-report, generated from
source, so it cannot disagree with the code:

```
unrun: 57 gaps in 46 files

  todo   a claim that would hold if something ran
  TODO   a limb that is not written
  FIXME  a defect in code that ships

@variance-authority/case-storybook
  cases/storybook-case/src/cli.chromium.test.js:409  todo
      a `run` over an unmodified build records a quiet run, so `Button`'s churn over the
      window divides by every run recorded rather than only by the runs it moved in — spec
      0002 acceptance 3, needs this case pointed at a running
      `@variance-authority/server`
```

It has no build step and no dependency, so it reports on a project that does not
compile. `tools/unrun.check.ts` keeps the
markers well-formed and the discovery non-vacuous. `yarn test` reports the todo
count in its own summary line; vitest's default reporter prints no titles for
todo or skipped tests, which is why the printer exists.

In a browser-gated file — one with `const live = READY ? describe : describe.skip`
— write the `it.todo` at **column 0**. Vitest reports everything inside a skipped
block as *skipped*, so a todo nested in the gate leaves the count on exactly the
machines running least of the suite.

A marker beats a paragraph on all three counts that matter: it sits where the
reader is already looking, it moves when the code moves, and **closing the gap
deletes the claim** rather than leaving it to be noticed.

## Architecture chart

The Compass chart root is `.compass/`. It charts the logical system, not the
repository: its blocks are cut by the question each one answers and
deliberately do not line up with `packages/`. The `compass` skill, installed at
`~/.agents/skills/compass`, owns how the chart is read and how it changes; this
section only routes to it.

For non-local work — crossing a boundary, changing a rule or an invariant,
adding a party, asking whether something belongs here, or building any
capability — search the chart first:

```bash
python3 ~/.agents/skills/compass/scripts/compass_search.py --chart-root .compass "<task terms>"
```

It prints the matched sections with their heading, file and line range, and says
which of your terms the chart names:

```
Found 10 section(s): 1 direct, 9 BM25-related. BM25 is a lexical ranking signal, not confidence or semantic proof.
Named by a chart heading, slug, or identifier: flake. Named nowhere in the chart: detection.
[1] variance-authority/GLOSSARY.md:562-572
    kind=glossary signal=exact term='flake' bm25=8.1512
    heading=Glossary — variance-authority > Flake
```

Consult the matched owning sections, then follow the skill's Consume route
through every chart level present; BM25-related results are leads, not semantic
proof. For a one-file fix, a rename, or a bug with a stack trace pointing at the
line, read the code.

The skill's two routes are exclusive. **Consume** reads an existing chart and
applies it to work done elsewhere. **Create** establishes or changes
chart-owned state — a chart file, a coordinate, a boundary, this section. Never
drift from one into the other: Consume never authorizes a chart edit, and a
Consume task that finds the chart missing, stale or disputed records the finding
and stops there.

If `~/.agents/skills/compass` is not installed, the chart is still readable
without it and the work is Consume-only until it is: [`.compass/COMPASS.md`](.compass/COMPASS.md)
is the registry, [`.compass/README.md`](.compass/README.md) states the scope, and
every architectural directory's own `README.md` is its identity document. Replace
the search with `grep -ril "<task terms>" .compass`.

- A source file carries `// compass: <address>` at its top. The address resolves
  in the chart and locates the implementation; it does not define the boundary.
- "Why is this code shaped this way?" follows the coordinate first. A reason
  specific to this implementation lives with the code, not in the chart.
- When chart and code disagree, classify before changing either side: semantic
  change, implementation remapping, or implementation violation.

## Standing rules

- **Commit to `main`.** No branch, no PR, unless asked.
- **Absent is not empty** (ADR-0002). A thing the run could not determine is
  missing from the output, never zero, never `[]`.
- **A package is named for what it is for** (ADR-0042), never for a library it
  imports. A name comes from a requirement the manifest cannot state, from what
  the thing is, or from a target, format or protocol it serves — a format is a
  public interface and a library is not. `tools/boundaries.check.ts` refuses a
  name that shares a word with one of its own third-party dependencies until
  somebody has written down which of the two it is.
- **Code-unit sorting.** Never `localeCompare` in anything that reaches a
  committed artifact — it makes byte-stability a promise about `LANG`.
- **500 lines per file**, enforced by `tools/shape.check.ts`.
- **An export a README names is run by something**, enforced by
  `tools/docs-exercised.check.ts`. Documented and unexercised is how a second
  implementation of a shipped behaviour survives — `summarizeObservation` was
  exported, documented, called by nothing, and drifting from the private copy
  `playwright-test` had grown for the same job. The rule is deliberately
  shallow — it asks whether a test *names* the export, not whether the test is
  about it — and it has no budget and no exemption list: a documented export
  nothing names is answered with a test or with a deletion.
- **Every answer has an owner, and computing one yourself is a defect**
  (ADR-0069). Before writing a loop, name the party that already knows: git owns
  what files exist, what they contain and what moved; the manifest and the
  configuration own what a specifier means; the parser owns what a module
  declares; the recording owns what ran. Four rules follow and none of them need
  a measurement to apply. **Carry, never recompute** — a value an upstream stage
  produced is propagated, not derived again at the far end. **Holding an answer
  and not using it is a bug**: `scan_graph_with_tree` computed every file's
  object name, spelled an identity out of it, and then opened all of them off the
  disk. **Never override an owner's configuration** — sense passed
  `core.fsmonitor=false` to every `status` call, which is the control row of a
  benchmark script pasted into the shipped path, and it made the watcher
  `docs/performance.md` tells readers to enable unreachable. **Fall back, never
  fake**: when the owner cannot answer, compute it and say so — `read_blob` drops
  to `open_and_parse` on every failure path, and that valve is what makes the
  other three safe to apply without hedging. The design question is *whose answer
  are we ignoring*, which is answered by reading; neither defect above would have
  survived it being asked, and neither was caught by three journals of
  measurements.
- **Performance is earned, and isolation is not how it is earned.** A session
  keeps one browser, one context and one page (ADR-0009), and switches subjects
  **in place** through the harness's own API — Storybook's story switch, never a
  reload and never a fresh fixture. Playwright's per-test isolation is rejected
  here on measurement, not taste: it costs 2.3x to 6.4x the whole subject, the
  tax falls hardest on the engine that paints fastest, and a benchmark shaped
  like it reports process setup while claiming to report the engine
  ([journal 0036](docs/context/journal/0036-the-model-picks-the-engine.md)).
  Storage and cookies may be cleared between subjects — 0.30 ms, which is the
  entire price of the objection. On a host that translates instructions the same
  tax is 8.9x to 28.7x, because translation is expensive at process creation and
  cheap in steady state — reuse pays it once, a fixture pays it per subject
  ([journal 0037](docs/context/journal/0037-the-container-is-not-the-tax.md)).
  A subject that is *unstable* under reuse is a finding: divergence analysis names
  the writer and the selector that connected them, and **we guide the fix**.
  Rinsing to make an unstable subject look stable hides the defect and charges
  every other subject for it.
- A limitation is a bug or a position, never an apology. Classify it before
  writing "we cannot".
- **A status claim is a marker, not a sentence in `docs/`.** `it.todo` for what
  would run, `// FIXME:` for a defect, `// TODO:` for a limb.
- **No magic, and not alone.** We are a piece of boring technology, not a
  magic wand: nothing performs an operation the user did not ask for, in a
  place they would not look for it. We never keep the user blind, and we never
  fix an edge case behind their back. Across a boundary we ride what others
  already carry rather than patching around it or inventing a protocol nobody
  forwards. We are in this together: the user sees what we did, where, and why.

## Verifying

```bash
yarn build && yarn verify
```

`verify` is `yarn lint && yarn check && yarn measure && yarn test`, in that
order. `check` is the `tools/*.check.ts` suite, which includes the documentation
checks: every link resolves,
every path named in prose exists, every `file:line` lands where it says, stated
counts are the counts, and the CLI command lists match the binary's own table.
It also runs `yarn measure`, the `*.measure.ts` files that gate on what the
product costs — separate from the suite because the suite instruments what it
loads, and a ratio cannot be timed through the thing timing it.

`yarn test` records which test file executed which region of which module.
`yarn test:since` reads that back and runs the files a change reached:

```bash
yarn test:since                    # since the commit the snapshot was recorded at
yarn test:since main               # since the merge base with main
yarn test:since --dry-run          # decide, explain, run nothing
yarn test:since --at-distance 0-2  # only the tests within two imports of the change
yarn test:since --help             # every flag, and the loop below
```

It selects on what the recording measured, and on nothing else. Each changed
file is read from both of its texts first, and prints a `read` line saying what
the edit does. A module added since the recording is read the same way, with
every export counted as changed, so it selects the tests that entered a function
reading one. A changed file with no row that reading cannot answer — a
stylesheet, a page-side module that cannot take a probe — is asked of the import
graph, and the nearest measured files that import it select their tests; a bumped package is answered
the same way by its measured importers. A changed path the graph does not list
either — a README, a fixture — selects nothing by itself and is reported. What
the harness loads without importing it is declared instead: the seam declares
`vitest.config.mts` and the local modules it imports, such as
`tools/page-side.mjs`, and the config names the rest in `preconditions`
(`tsconfig.base.json`). A change to any of them selects every test. A change
confined to manifests is read as the install it records, and runs nothing when
no installed package moved. A fixture a test reads with `fs` is named in
`preconditions` the same way, or a change to it selects nothing.

The whole suite runs only when the reading itself could not be made — an
install it could not compare, or a snapshot with no whole observation of any
file the suite collects — and it says which:

```
test:since: running the whole suite — the install could not be compared against 03984ae78218.
  429 files
```

So a green `test:since` is a smaller claim than a green `verify`: use it in the
loop, and report against the gate.

The recording is not in git. It sits in [the cache](docs/cache.md), under
`<cache>/test-selection/`, in a directory keyed by a digest of this
checkout's absolute path — a worktree's own under `.work/`, layered over the
primary checkout's, which it reads and never writes. Every `yarn test` folds its
run into it; that is the whole of the invalidation. Nothing expires and nothing
is checked for age, so an answer the snapshot gets wrong stays wrong until a run
replaces it. To force a cold recording, delete that directory and run
`yarn test`.

**Run the near end first.** Every selected test also carries its distance from
the change — the number of imports between them, counted through the modules
that test actually entered. The near ones fail first and for the simplest
reason, so the loop is:

```bash
yarn test:since --at-distance 0-2   # while the edit is still open
yarn test:since --at-distance 2-4   # before handing the change over
yarn verify                         # the gate, and the only green that counts
```

`0-2` is *no more than two imports away*, not *the first two groups*: a change
whose nearest test is five hops out answers it with nothing, which is the true
answer. Start at `0` — that is a test whose own source you just edited. The
overlap at two hops is deliberate: it reconnects the wider run to the boundary
the edit loop already exercised.

**That loop is not a partition, and does not try to be.** `2-4` leaves anything
five hops or further out, and every test the reading could not place, to
`yarn verify` — which is the gate, and runs them. When you do want a partition,
it is `0-2` then `3-`: a leg whose range is open at the top carries the tests
with no measurable distance, so those two legs together run every selected file
exactly once. Either way, every run prints the files the leg it took left
behind.

`--at-distance` narrows a reading; it cannot narrow a widening. When the reading
could not be made the run is the whole suite and the flag is never consulted —
the message above is the whole output, and no leg of the loop is a shorter run
than `yarn test` until the install compares or the recording has a whole
observation.

Two findings arrive whether or not anything failed: an import that reached past
a directory's own entry point, and a test the change entered by no route it
imported. Both have an address. [`docs/distance.md`](docs/distance.md) is the
reference.

**An out-of-date checkout reports defects, not errors, and that is what makes it
expensive.** Nothing here imports another package by relative path, so a check
asking the CLI what a setting means resolves through the manifest's `exports`
into `dist/` — the same path a consumer takes. A *missing* build announces
itself. A **stale** one answers every question fluently and answers some of them
wrong, and the answer arrives dressed as a defect in whatever was asked about:
`packages/cli/README.md` documenting a setting the parser rejects, run against a
`dist/` built before that setting existed. A stale `node_modules` does the same
one layer down — *Invalid hook call … more than one copy of React*, which reads
as a defect in the runtime layering and is not one.

Both are worst in a fresh worktree, which starts with neither. So:

```bash
yarn install && yarn build && yarn verify
```

The cost is never the red line. It is the change somebody makes to satisfy it —
correct documentation deleted, working code rewritten — so **reconcile the
checkout before believing a failure**, and re-run before reporting one.

<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.50.1 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management. Backlog governs
task processing, not repository orientation.

Invoke Backlog only when the request processes a Backlog task: searching,
reading, creating or updating one, or executing or finalizing work already
identified as a Backlog task. Reading `AGENTS.md` or `docs/context/`, inspecting
the checkout, locating files or tools, answering an ad hoc question, and making
an ad hoc change are not Backlog task processing and must not invoke it.

At the start of Backlog task processing, run
`./node_modules/.bin/backlog instructions overview` and
use it to decide whether to search, read, create or update tasks. Run Backlog
commands independently from orientation and context reads so a CLI failure
cannot prevent those reads.

Before task lifecycle actions, read the matching detailed guide:
- `./node_modules/.bin/backlog instructions task-creation` before creating or splitting tasks
- `./node_modules/.bin/backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `./node_modules/.bin/backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `./node_modules/.bin/backlog <command> --help` before running unfamiliar
commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
