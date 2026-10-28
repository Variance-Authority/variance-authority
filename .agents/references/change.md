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

**Does it change how a record is carried or read?** Carrying, the case index,
and the selection and comparison read off them, keep one contract: an
ambiguous correspondence never becomes measured absence, and evidence never
lands on a region that did not earn it. A unit test of one function cannot show
either. A defect there shows only over a history: a cut, an edit, a run of other
tests, then a selection that misses a test or a comparison that calls a region
lost. So a change to these mechanisms names, in its PR, the clause of the
contract it keeps and the journey in
`packages/sense/src/test-selection/__fixtures__/carry-stories.ts` that exercises
it, in-process and through the CLI, adding the journey when none does. It also
shows the regression test failing on the code before the fix: the command and
its failing assertion, quoted in the PR's `Pinned by` column. The
`carry contract` step of the `rules` job in
[`check.yml`](../../.github/workflows/check.yml) runs these journeys by path rather than by selection, because a carrying defect
corrupts the very record a selection would be read from.

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
- **A budget per written surface**, in content lines: a file overview 15, a
  declaration's docblock 10, a block comment in code 5, a public page's lead 15.
  Blank lines, bare tags and pragmas such as `// compass:` do not count.
  `tools/budgets.check.ts` reads comments with oxc and holds the debt recorded
  in `tools/budgets.baseline.json`.
- **A breach is a collapse, not a trim.** Write what the task needs while you
  work; the limits are checked once, in `verify:rules`. A surface or file that
  breaches is collapsed in the same change, as a commit of its own before the
  feature commit, and well under the limit: a comment to about half its budget,
  a file split by responsibility to about 300 lines each. Overflow moves to its
  owner — down to the site it governs, up to the folder or package, or to the
  export's docblock — and an owner that does not exist is created, held to its
  own limit. A change that grows a surface on the debt list collapses the whole
  surface, not the lines it added. A debt entry that shrinks is written down with
  `yarn budgets --write`.
- **An export a README names is run by something**, enforced by
  `tools/docs-exercised.check.ts`. The rule is deliberately shallow — it asks
  whether a test *names* the export, not whether the test is about it — and it
  has no budget and no exemption list. A documented export nothing names is
  answered with a test or with a deletion.
- **Every answer has an owner.** See [orient](orient.md). Three idioms keep
  being typed again: a SHA-256 digest, a code-unit comparator and a
  write-then-rename. `tools/owners.check.ts` holds their sites per file and
  names each owner, and `tools/clones.check.ts` holds pasted blocks per pair of
  files. Neither sees a long flow re-typed with new names; the Alignment
  reviewer looks for that.
- **One implementation.** A second way to compute an answer that already has
  one is a defect, however it is spelled: a new flag beside an old one, a fast
  path beside the general path, a fallback beside the reader that refused. The
  change extends, calls or replaces the first; it never sits next to it.
- **Four roles, and complexity goes down.** Each file plays one of them. A
  shell imports decisions and mechanisms, a mechanism imports engines, and a
  decision imports only decisions and types; nothing imports a shell. A role is
  not a package layer: those are depth in the import graph, from
  `variance layers`.
  1. **Engine** — borrowed: oxc parses, git finds files and diffs, TypeScript
     answers types, Chromium paints, the runner says what an import meant under
     test. We call an engine; we never re-implement it.
  2. **Mechanism** — our deep modules: complex inside, a narrow interface out,
     no policy. The source index, the recording, the comparator.
  3. **Decision** — pure functions over values a mechanism returned. No I/O,
     no clock, no process.
  4. **Shell** — wiring: read arguments, call, print. No branches beyond
     dispatch.

  A rule that wants a loop over bytes goes down a role into a mechanism; a
  mechanism that wants a policy takes it as a parameter. Before writing a
  mechanism, ask whether an engine already answers it. This is Bernhardt's
  "functional core, imperative shell" with the core split into Ousterhout's
  deep modules. Nothing checks a role yet: a file does not declare one
  (`tools/relations.check.ts` holds the marker).
- **Scope stops at a neighbour's answer.** What another tool owns — the table in
  [`.compass/COMPASS.md`](../../.compass/COMPASS.md#not-ours) — is asked of that
  tool, never grown here. A capability that would make variance answer its
  neighbour's question is a separate decision, not a step inside a feature.
- **No runner is the default.** Runner-neutral code reads no runner's
  integration: Jest, Vitest and Rstest are peers, and what two of them share
  moves into a neutral file they each call. `.relations.json` beside the
  integrations holds the fence, and `yarn restrictions` (in `verify:rules`)
  fails an import across it. A feature lands for every runner or says, at the
  site, which runner it waits for.
- **A specialist keeps its colour.** A package means one thing: `sense` reads
  source and selects tests, `react` knows React, `storybook` knows Storybook. A
  generic package, such as `cli`, composes colours and has none of its own. A
  specialist that learns another domain's private names or imports its
  packages gives that knowledge two homes, so the next change to the domain
  updates one of them. The fix is an extension point in the specialist, filled
  by the package of that colour, never a quieter place for the same
  knowledge: a story in `sense` asks what kind a component is, and only the
  `react` package answers with React's names. `COLOURS` in `tools/colours.mjs`
  declares each package's colour, and `tools/colours.check.ts` (in
  `verify:rules`) fails a new import or private name of another colour.
  Calling a package `mixed` takes it out of the check, so only a package
  whose job is composing others is `mixed`. A colour finding is never set
  aside, whoever raises it: a reviewer, CodeRabbit or the check. A recorded
  site carries a `// FIXME:` saying where its colour belongs. The check sees
  names and imports, not meaning: a specialist that re-derives another domain
  under our own names is the reviewers' to catch.
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
  A navigation, a reload, a new browser, page or context is a `fresh-page` site, and a
  `setTimeout`, `setInterval` or `waitForTimeout` is a `timer` site:
  `tools/owners.check.ts` holds today's per file, tests included, and a new one
  fails. Readiness
  is a signal — an event, a promise, `aria-busy`, the harness hook — and a timer
  is only a deadline that names what never answered. A deadline lands the way
  any recorded site does: its reason at the site, then `yarn owners --write`.
- **No magic, and not alone.** Nothing performs an operation the user did not
  ask for, in a place they would not look for it. We never keep the user blind,
  and we never fix an edge case behind their back. Across a boundary we ride what
  others already carry rather than patching around it or inventing a protocol
  nobody forwards. The user sees what we did, where, and why.
- **A path is the file.** A path is a file's name relative to the checkout,
  and two different paths are two different files, entirely and always. Nothing matches a path by its name, a shared suffix or
  "the same file under another root", and nothing offers the user a path they
  did not give as the one they meant: a guess at what they meant is magic. The
  one mapping between paths is built output to its source
  ([ADR-0080](../../docs/context/adr/0080-built-output-is-read-as-its-source.md)),
  declared by the configuration that owns it. A path the record does not hold is
  not held, and the answer says exactly that.
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
