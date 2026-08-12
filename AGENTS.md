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

## Standing rules

- **Commit to `main`.** No branch, no PR, unless asked.
- **Absent is not empty** (ADR-0002). A thing the run could not determine is
  missing from the output, never zero, never `[]`.
- **Code-unit sorting.** Never `localeCompare` in anything that reaches a
  committed artifact — it makes byte-stability a promise about `LANG`.
- **500 lines per file**, enforced by `tools/shape.check.ts`.
- A limitation is a bug or a position, never an apology. Classify it before
  writing "we cannot".

## Verifying

```bash
yarn build && yarn verify
```

`verify` includes the documentation checks in `tools/`: every link resolves,
every path named in prose exists, every `file:line` lands where it says, stated
counts are the counts, and the CLI command lists match the binary's own table.
