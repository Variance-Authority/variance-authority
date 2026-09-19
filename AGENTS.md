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

**Read `docs/context/` before writing anything** — in this order, and stop where
it says to stop. A page written without it re-derives a settled decision,
re-argues one, or contradicts it; a page written after sweeping the whole
directory is a page nobody wrote.

1. [`docs/context/checkpoint.md`](docs/context/checkpoint.md) — where the
   project stands. One read. It states its own budget: verdicts only, no
   deliberation.
2. [`docs/context/README.md`](docs/context/README.md) — what the three
   directories hold, and the rules they are written under. One read.
3. Then only the entries your task names or your terms match. There are dozens
   of ADRs and dozens of journal entries, numbered in the order they were
   written and in no reading order at all, so search them rather than sweep
   them:

   ```bash
   grep -ril "<task terms>" docs/context/adr docs/context/journal
   ```

   Read matching ADRs before matching journal entries: an ADR constrains the
   code and a journal entry records one attempt at it. Stop when a match stops
   changing what you were about to write.

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

### Editorial direction

Write with substance and character, in language that does not require belonging
to the project.

- Respect what the page is doing. An argument persuades, an explanation develops
  understanding, and a reference answers precisely. Each needs its own shape.
- Assume engineering experience, not shared vocabulary. Readers know software;
  they do not know the project's private shorthand or the conversations behind it.
- Make the thought easy to follow. Clear relationships between ideas matter more
  than short sentences or fewer words.
- Preserve the author's intent and voice. Improve how the idea reaches the reader
  without replacing it with a generic documentation pattern.
- Keep the depth. Translate difficult wording while retaining distinctions,
  reasoning, and technical detail that earn their place.
- Let detail serve the purpose. Its placement and prominence depend on what the
  reader came for.
- Keep internal rationale internal. Public documentation does not link to
  `docs/context/`, name an ADR or journal entry, or depend on private project
  history. State any reasoning the reader needs in the public page itself.

**Public documentation** is an enforced set, not a judgment call:
`tools/docs-links.check.ts` holds the root `README.md`, every `docs/*.md`, and
the `README.md` of every package, example and case to the rule above. It refuses
a link that resolves inside `docs/context/` or `docs/specs/`, and it refuses the
strings `ADR-0000`, `journal 0000`, `spec 0000` and any bare `docs/context/…`
path anywhere in one of those files.

Everything else is outside that set and may cite whatever it needs: this file,
`CONTRIBUTING.md`, `docs/context/**` itself, and `docs/specs/**`. That is why
the rules below name a journal entry by number and a `docs/` page may not.

Welcome the reader from the system and constraints they already have. Seek to
understand those choices before presenting another one. Build shared ground,
state tradeoffs fairly, and show how existing tools can remain in place. A strong
position should clarify a decision, not manufacture an opponent. Readability is
better expression of the ideas, not simplification of them.

Apart from the scoping rule above, nothing in this section is checked. It is
held by review, which is why it reads as direction rather than as rules.

### The register

Every published sentence is written for one reader: an engineer who has shipped
software, does not know this codebase, and for whom English is often a second
language. That last part is not a small adjustment. It decides the words.

**A sentence is in register when all five of these hold.**

1. **Who speaks — the engineer who built the thing, now.** Not a story about how
   it got here, not the project as a company, not the software talking about
   itself. This keeps the tense present, and it keeps out the passive that hides
   who acts.
2. **Who is spoken to — one engineer deciding whether to use this.** One person,
   not an audience. They know software. They do not know our words, our history,
   or the arguments behind either.
3. **What makes it true — the thing itself.** Code, output, a measurement, a
   recorded run. **No sentence is true because of another sentence in the
   document.** A page is not an argument. Every paragraph stands on the product
   directly. This is why *it does not follow that*, *hence*, *therefore*, *it
   holds that* and *it suffices to* are out: each one says this sentence comes
   out of the last one, and none of them do.
4. **Words mean what they say.** A term of art passes — `import`, `closure`,
   `graph`, `hydration` mean exactly what they mean, and there is no limit on
   how many a page uses. A figure of speech does not: it is a word used for some
   sense other than its own, and there are none. That one line removes *it does
   not follow* (nothing follows anything), *seamless* (there is no seam),
   *powerful* (there is no power), *simply* (a claim about how the reader feels,
   not about the software), and the pretty inverted title whose shape carries
   what its words do not.

   **Move is the worked example.** To move is to change position. A button can
   move. A box, a line of text, a token, a pixel, a file going to a new path —
   each has a place, so each can move, and this product exists to report exactly
   that. Nothing else in a running system does. State changes. A value changes.
   A hash, a prop, a key, a name, a ratio, a digest, a verdict: all change, none
   move. *State tells you what moved inside the running system* is wrong, and
   the fix is *changed*. A change does not move code either — it changes it.
   Keep the word for the thing on screen that is one place today and another
   place tomorrow, because that is the finding the reader came for, and a page
   that spends *moved* on abstractions has no word left for it.
5. **Plain words, plain sentences.** Outside terms of art, use the most common
   word that still means it, and the plainest sentence that still carries it.
   *Use*, not *utilise*. *Enough*, not *sufficient*. *So*, not *hence*. *But*,
   not *albeit*. *About*, not *regarding*. *For example*, not *e.g.* Subject,
   verb, object. One idea per clause. No clause nested in a dash inside another
   dash. No idiom, no irony, no understatement, no cultural reference — those
   are the hardest things to read in a second language, and they carry nothing a
   plain sentence cannot.

   The line is sharp: **a hard word is allowed when it is a name, not when it is
   style.** `hydration` is a name. It has a page that owns it, it is linked the
   first time it appears, and a reader learns it once and keeps it. *Sufficient*
   is style. There is nothing to learn — it is *enough* wearing a suit.

**Expectations.** These hold across a page rather than inside one sentence.

- **One word, one job — and never a second word for the same job.** Swapping in
  a synonym to avoid repeating yourself is a habit from literary English. To a
  reader translating as they go, a new word means a new thing.
- **Every claim is checkable.** The reader can reach the code, the output or the
  number, and a number carries the machine it was measured on.
- **A limitation is a present-tense boundary of the product**, never an absence
  and never the story of an attempt.
- **The reader is the subject of the sentence.** Second person, task first.
- **A name this project made up is introduced on the page that owns it**, before
  any other page uses it.

**Boundaries — what this does not govern.**

- **The subject.** Plain English is not a plain subject. There is no cap on
  terms of art, no ceiling on what one paragraph may work through, and no
  distinction is ever dropped to make a sentence shorter. The language is plain;
  the thinking is not. A page that gave up a distinction to read more easily has
  failed this, not passed it.
- **Length.** A sentence may be long when every part of it is plain and it
  carries one idea. Two short sentences are usually better, and neither is a
  reason to lose the idea.
- **Warmth.** Direct is not cold. Condition 1 puts a person in the prose and
  keeps them there.
- **Scope — the published surface, and nothing else.** All five apply to the
  root `README.md`, `docs/`, package and example `README.md` files, the site,
  CLI output and error messages. `docs/context/` and `docs/specs/` are not
  published and are exempt. Write them in whatever language a machine can read:
  cite themselves, prove things, compress, use every term of art they need. The
  reader there is the next agent, not an engineer meeting this project for the
  first time, and the cost the five conditions buy is not worth paying twice.

**Habits to cut.** Each of these falls out of the five conditions, and each one
is easy to miss while writing.

- **Over-compression.** Write whole sentences, with their articles and their
  verbs. Spell out arrows and abbreviations. `Parser rejects bad date → exit 2,
  no write` becomes *the parser rejects a bad date, exits with code 2, and
  writes nothing*. A reader translating as they go has to decode the first one
  before they can read it.
- **An adverb holding up a weak verb.** *Runs quickly* is *is fast*, or better,
  the number. *Significantly improves* is the measured difference. If the adverb
  is carrying the sentence, the verb is the wrong verb.
- **A fancy way to say is.** *Serves as*, *stands as*, *boasts*, *features*. Say
  **is** or **has**.
- **Filler.** *In order to* is *to*. *Due to the fact that* is *because*. *It is
  important to note that* is deleted. So is a trailing clause that adds nothing:
  *ensuring correctness*, *highlighting the difference*, *reflecting the change*.
- **Stacked hedges.** *Could potentially possibly be argued that it might* is
  *may*. One hedge, or none.
- **Forced structure.** Three items because three sounds right. *From X to Y*
  where X and Y are not on one scale. Use the real number and name the real
  things.
- **Not just X, but Y.** Say Y.
- **A bold label that restates its own line.** **Performance:** performance
  improved. A bold lead-in is right when it names the item and what follows is
  new.
- **An ending that could end any page.** *The future looks bright.* A specific
  fact, or nothing.
- **A sentence that would be true of some other project's docs.** It says
  nothing about this one. Cut it.

Two well-known rules of this kind are deliberately not ours. Em dashes stay;
they are part of how this project sounds. And no word is cut for sounding
abstract when it is a name this project owns: `vantage`, `surface` and
`harness` each have a page, and condition 5 already separates a name from
style. Do not raise either again.

**How to check a sentence.** Ask four things. Who says this. What makes it true.
Which word is not meant literally. Which word would a good non-native speaker
have to look up — and is that word a name, or is it style. Nothing here is
checked by a test, and it is unlikely that it can be.

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

It narrows only where it has a measurement. A changed path the snapshot holds no
row for — an untracked file, a fixture, a page-side module that cannot carry a
probe — runs everything and names the path that caused it:

```
test:since: running the whole suite — the snapshot has no measurement of packages/core/README.md and 30 other path(s), so it cannot say who entered it.
  429 files
```

So a green `test:since` is a smaller claim than a green `verify`: use it in the
loop, and report against the gate.

The recording is not in the checkout and is not in git. It sits under
`$XDG_CACHE_HOME`, or `~/.cache` when that is unset, in
`variance-authority/test-selection/`, in a directory keyed by a digest of this
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

`--at-distance` narrows a reading; it cannot narrow a widening. When a changed
path has no measurement the run is the whole suite and the flag is never
consulted — the message above is the whole output, and no leg of the loop is a
shorter run than `yarn test` until the recording covers what you changed.

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
