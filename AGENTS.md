# Working on this repository

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

## `docs/` is not a work log

A `docs/` page describes the product as it stands at the end of the cycle. It is
read by someone who does not know this repository, has no interest in how it got
here, and will not open the git history.

It **must not**:

- **Mention a date.** Dates belong to the journal, the ADRs and the checkpoint.
  The exceptions are measurement provenance for an external fact (a competitor's
  published behaviour, a version number) and dates inside example data.
- **Narrate an absence.** No "nothing read this until…", "nobody had written
  this down", "said out loud for the first time", "this work did not make",
  "the first implementation reported eleven". A limitation is stated as a
  present-tense boundary of the product — *the sweep reads every subject in plan
  order* — not as a story about what was tried.
- **Tell another page's story.** Single responsibility. A page about composition
  says what composition is; the flake question belongs to `flakiness.md` and is
  reached by a link, not absorbed.
- **Compare itself to a previous version of itself.** Eleven→zero, first cut,
  used to be, now does. The reader is meeting this for the first time; there is
  no *before* in their world.

It **may**: state what the thing is, how it is measured, what a number is, what
the product refuses to conclude, and what it cannot reach — all in the present.

The journal is where "we tried X, it cost Y, we changed to Z" goes. It is
written for us, and it is the only place that shape is welcome.

## Who the reader is, and what they already know

**Read `docs/context/` before writing anything.** The checkpoint says where the
project stands, the ADRs hold the decisions and what each one cost, the journal
holds what was tried. A page written without them re-derives a settled decision,
re-argues one, or contradicts it. They are the first source, not the last resort.

**Write from a senior engineer's baseline.** The reader has shipped software, has
opinions about build tools, and has been bitten by most of what this project is
defending against. So:

- **Nothing foundational is explained.** Not what a git blob is, not what a
  symlink does, not why a stringified closure loses its scope, not how
  case-insensitive filesystems behave. Name it and move on; the reader fills it
  in faster than the sentence takes to read.
- **A defence is not a story.** State what the code refuses and why it matters
  *here*. The failure mode it prevents is a clause, not a section — and if it
  needs a section, it is an ADR.
- **Every paragraph earns its place in one story.** A page has a spine. Anything
  true but off-spine goes in an ADR, a docstring, or nowhere. Interesting is not
  a reason to include something.

The failure this rules out is a correct page nobody finishes: three levels of
detail on a defence that runs once, in front of the mechanism the reader opened
the page for.

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

```bash
yarn unrun
```

prints every marker, grouped, with `file:line` — the self-report, generated from
source, so it cannot disagree with the code. `tools/unrun.check.ts` keeps the
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

Consult the matched owning sections, then follow the skill's Consume route
through every chart level present; BM25-related results are leads, not semantic
proof. For a one-file fix, a rename, or a bug with a stack trace pointing at the
line, read the code. Consume never authorizes a chart edit: changing the chart,
a coordinate, or this section is a Create task with its own authority.

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
  `playwright-test` had grown for the same job. `EXERCISE_DEBT` is a per-package
  budget that may only shrink, on the same terms as `OPTION_DEBT`.
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

## Verifying

```bash
yarn build && yarn verify
```

`verify` includes the documentation checks in `tools/`: every link resolves,
every path named in prose exists, every `file:line` lands where it says, stated
counts are the counts, and the CLI command lists match the binary's own table.
It also runs `yarn measure`, the `*.measure.ts` files that gate on what the
product costs — separate from the suite because the suite instruments what it
loads, and a ratio cannot be timed through the thing timing it.

`yarn test` records which test file executed which region of which module.
`yarn test:since` reads that back and runs the files a change reached:

```bash
yarn test:since            # since the commit the snapshot was recorded at
yarn test:since main       # since the merge base with main
yarn test:since --dry-run  # decide, explain, run nothing
```

It narrows only where it has a measurement. A changed path the snapshot holds no
row for — an untracked file, a fixture, a page-side module that cannot carry a
probe — runs everything and names the path that caused it. So a green
`test:since` is a smaller claim than a green `verify`: use it in the loop, and
report against the gate.

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
