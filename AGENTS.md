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

This project uses Backlog.md for task and project management.

**For every user request in this project, run `backlog instructions overview` before answering or taking action.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:
- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
