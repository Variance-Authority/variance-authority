# Change

Phase 3 of [`AGENTS.md`](../../AGENTS.md). The rules every edit is held to, and
where each kind of writing goes.

## Look around

**Which tests stand on it?** Before an edit, `yarn variance covering --file
<path>` names the tests that entered the code, and the change starts there:

1. Amend the test that pins the behaviour being changed, or add one beside it,
   so that it states the behaviour the change is for.
2. Run it and watch it fail on the code as it is. A test that passes before the
   change pins nothing the change does.
3. Change the code until it passes, and the tests `covering` named still pass.

A behaviour nothing covers is pinned as it is before it is changed: one test per
edge case, green on the old code, so the change shows up as the tests it turns
red, and the test the change is for is still written to fail first. `covering`
answers from the last recording, so for a file it has never seen, put the edit
in the tree and read `yarn variance select --suite <slice>`: it selects from the
diff, and says nothing about a file that has not changed.

**Is it this task?** A task is the sentence of done from [refine](refine.md),
and its code is its branch's diff, `git diff origin/main`. A defect in that diff
is the task's, whoever finds it — the agent, a reviewer, CodeRabbit, CI, the
person who asked — and needed or not: a missing pin, a wrong word, an unbroken
tie in a function the task added. It is fixed on the branch before the PR
merges, never in a PR after it. Split off, each correction reaches `main` as a
PR nobody reviewed against the whole, and each can leave `main` red.

Work the task needs for its sentence of done to hold is the task's too,
wherever the code is: a refactor it stands on, a neighbour's defect it cannot
pass, and, when the task fixes a defect, every other place that defect lives. A finding the
task neither needs nor wrote — dead code, a stale doc, a defect in a neighbour
the task works without — is outside the task: it goes on its own branch cut from
`origin/main`, with its own PR. Folded into this one, it hides in a diff nobody
reviews for it.

A merged task is closed. A defect found in its code afterwards is fixed like any
other, in a new change cut from `origin/main`, its body quoting the PR that
merged it.

**Where does the writing go?** Each kind of writing has one home and one job. A
file that does two jobs is split, not extended.

| Place | Job | Tense |
|---|---|---|
| `docs/*.md` | What the thing **is** and how it is measured. Consumption and advertising material for someone deciding whether to use it. | Present |
| `docs/specs/` | What is not built. One vacancy per file. | Future |
| `docs/context/adr/` | One decision, its alternatives, and its cost. | Present, dated |
| `docs/context/journal/` | What one attempt cost and what it taught. | Past, dated |
| `docs/context/checkpoint.md` | Current state of the whole. | Present, dated |
| `README.md` | The entry point: what the product is and where to go next. Route the reader; do not restate a doc. | Present |
| `packages/cli/skills/variance-authority/` | How to run it: one question per file, every flag and edge case. For agents, our main users; it ships with the CLI. | Present |
| `packages/*/README.md`, `cases/*/README.md` | How to use the package or example, in the `context-docs` skill's *Package README* role. Short: what grows past that moves to `docs/`. | Present |
| JSDoc on exported symbols | What the symbol accepts, returns and refuses. | Present |
| Source docstrings | Why this code is shaped this way. | Present |
| `.changeset/*.md` | What this change does to a published package, for someone upgrading. | Present |

**Does it ship?** A change to a published package's code, manifest, schema or
skills carries a changeset: `yarn changeset`, the product's bump, and a body
saying what the user sees and runs. It is written with the change, because only
its author knows what the change does; at release time it is reconstructed from
diffs, or it is missing and the changelog says only that the version moved.
[`.changeset/README.md`](../../.changeset/README.md) shows one. A change that
touches a package and ships nothing worth naming — a build script, an internal
rename — carries `yarn changeset --empty`, which says so. The `changeset` step
in [`check.yml`](../../.github/workflows/check.yml) runs `yarn changeset status`
against the base and refuses a pull request with neither. Tests, fixtures and a
package's README do not count as a change; `changedFilePatterns` in
[`.changeset/config.json`](../../.changeset/config.json) lists what does not.

**What order does the page take?** A top-layer page — the root `README.md`, a
`docs/*.md` page, the site — is outlined from a brief, not from the spec or the
code. The `content-flow` reviewer reads its lead and headings cold before it is
drafted, and the finished page once. [Content flow](content-flow.md) holds the
three layers, the brief, the order and the cold read. It comes before any
sentence is written.

**Who reads the sentence?** [`docs/AGENTS.md`](../../docs/AGENTS.md) holds who
the reader is, what to read before writing, the editorial direction, and the
register every published sentence is held to. It governs the whole published
surface — the root `README.md`, `docs/`, package and example `README.md` files,
the site, CLI output and error messages. Read it before writing any of them.

## Code rules

- **Absent is not empty** (ADR-0002). A thing the run could not determine is
  missing from the output, never zero, never `[]`.
- **A package is named for what it is for** (ADR-0042), never for a library it
  imports. A name comes from a requirement the manifest cannot state, from what
  the thing is, or from a target, format or protocol it serves — a format is a
  public interface and a library is not. `tools/boundaries.check.ts` refuses a
  name that shares a word with one of its own third-party dependencies until
  somebody has written down which of the two it is.
- **Code-unit sorting.** Never `localeCompare` in anything that reaches a
  committed artifact: it makes byte-stability a promise about `LANG`. Sort with
  `codeUnitOrder` from `@variance-authority/core/segment`, not a local
  comparator.
- **500 lines per file**, enforced by `tools/shape.check.ts`.
- **An export a README names is run by something**, enforced by
  `tools/docs-exercised.check.ts`. The rule is deliberately shallow — it asks
  whether a test *names* the export, not whether the test is about it — and it
  has no budget and no exemption list. A documented export nothing names is
  answered with a test or with a deletion.
- **Every answer has an owner.** See [orient](orient.md). Three idioms keep
  being typed again: a SHA-256 digest, a code-unit comparator and a
  write-then-rename. `tools/owners.check.ts` holds their sites per file and
  names each owner, and `tools/clones.check.ts` holds pasted blocks per pair of
  files. Neither sees a long flow re-typed with new names.
- **Performance is earned, and isolation is not how it is earned.** A session
  keeps one browser, one context and one page (ADR-0009), and switches subjects
  **in place** through the harness's own API — Storybook's story switch, never a
  reload and never a fresh fixture. Playwright's per-test isolation is rejected
  on measurement: it costs 2.3x to 6.4x the whole subject, the tax falls hardest
  on the engine that paints fastest, and a benchmark shaped like it reports
  process setup while claiming to report the engine
  ([journal 0036](../../docs/context/journal/0036-the-model-picks-the-engine.md)).
  Storage and cookies may be cleared between subjects — 0.30 ms, which is the
  entire price of the objection. On a host that translates instructions the tax
  is 8.9x to 28.7x
  ([journal 0037](../../docs/context/journal/0037-the-container-is-not-the-tax.md)).
  A subject that is *unstable* under reuse is a finding: divergence analysis
  names the writer and the selector that connected them, and we guide the fix.
  Rinsing an unstable subject until it looks stable hides the defect and charges
  every other subject for it.
- **No magic, and not alone.** Nothing performs an operation the user did not
  ask for, in a place they would not look for it. We never keep the user blind,
  and we never fix an edge case behind their back. Across a boundary we ride what
  others already carry rather than patching around it or inventing a protocol
  nobody forwards. The user sees what we did, where, and why.
- **Stop only what you started.** A server you start gets a fixed port and is
  stopped by its pid or by that port (`lsof -tiTCP:<port> -sTCP:LISTEN`), never
  by `pkill -f` or `killall`. Other projects' servers run on the same machine.

## A status claim is a marker, not a sentence

How far along the project is — what is written and has never run, what nobody
has used, what is measured and what was only ever asserted — is a status report,
and it does not go in `docs/`. A status report written as prose rots in one
direction: its optimistic claims get corrected the moment somebody trips over
one, and its pessimistic claims survive the work landing, because no checker can
resolve an absence. So a status claim is written at the line that owns it:

| Marker | What it is for |
|---|---|
| `it.todo('…')` | A claim that would hold if something ran. The title is the sentence that becomes true, and it names what would make it run. |
| `// FIXME:` | A defect in code that ships and works. |
| `// TODO:` | A limb that is not written. |

The boundary between `it.todo` and `// TODO:` is mechanical. An `it.todo` may
only live in a file a runner collects — `*.test.*`, `*.check.*`, `*.measure.*` —
because a todo anywhere else is a function call nothing ever makes. A gap a
runner could state as a sentence goes in the collected file that would own it; a
gap in a module, a tool or a config is `// TODO:` at the line. A todo title is
`<the sentence that becomes true> — needs <what would make it run>`; the em dash
and the word `needs` are the checked shape, and a title like "not implemented"
fails.

```bash
yarn unrun
```

prints every marker, grouped, with `file:line`. It has no build step and no
dependency, so it reports on a project that does not compile.
`tools/unrun.check.ts` keeps the markers well-formed and the discovery
non-vacuous. `yarn test` reports the todo count in its own summary line; vitest's
default reporter prints no titles for todo or skipped tests, which is why the
printer exists.

In a browser-gated file — one with `const live = READY ? describe : describe.skip`
— write the `it.todo` at **column 0**. Vitest reports everything inside a skipped
block as *skipped*, so a todo nested in the gate leaves the count on exactly the
machines running least of the suite.

Closing the gap deletes the claim, rather than leaving it to be noticed.
