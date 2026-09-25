---
name: variance-authority
description: Use when asked to inspect, explain, distill, or verify a Variance Authority run, watcher, evidence artifact, or MCP connection.
---

# Variance Authority

Read the product's retained evidence to answer what a visual run observed, what a
test addressed, what React updated, and what source executed.

**No question here drives a browser or a runner.** Every command below reads a
file or asks a listening process; none renders, navigates, clicks, replays an
event, or starts a suite. When an answer is missing, the move is to arrange the
producer and re-run the suite with your ordinary tools — never to drive the page
from here in order to manufacture the reading. The distillation loop below does
rerun tests: that is an experiment you run, and its evidence comes back through
the same read-only commands.

Choosing which tests to run after an edit, and which of them to run first, is a
different question with its own skill: `variance-test-selection`, shipped at
`packages/sense/skill/SKILL.md`. What a workspace publishes, where a symbol is
declared and which story already calls it is a third: `variance-workspace-api`,
shipped at `packages/help/skill/SKILL.md`. Neither reads a run, and neither of
those questions is answered from evidence.

## Before the first command

The `variance` binary is `bin` of **`@variance-authority/cli`**, and it is a
devDependency, never a global. So every invocation is `npx variance <command>`;
a bare `variance` is only on `PATH` inside a package script.

```bash
npm  install --save-dev @variance-authority/cli    # or: yarn add -D / pnpm add -D
npx variance ask                                   # prints every question and what each needs
```

Check each of these before spending a question:

1. **The CLI is installed in this checkout.** `npx variance ask` printing the
   question list is the whole test. It answers with no config and no run.
2. **The working directory holds `variance.config.json`**, or you pass
   `--config <path>`. There is no search of parent directories and no defaulting:
   a missing file is exit `2` with `cannot read the config file
   variance.config.json`. This is true of the live questions too — `ask self
   --at <address>` loads a config it never reads. Every command below except
   `watch`, `distill` and `covering` needs one.
3. **A run has finished.** `variance ask` reads the file the run left at the
   config's `report` path, which defaults to `.variance/report.json`. No question
   re-runs anything, so an absent report is an absent answer, not a stale one.
4. **The checkout is at the revision the run was made at.** `--from` and `--to`
   on `locate` are facts about the source tree and are read from this working
   directory, not from the report. `summary` names the commit the run's index
   stands at and how many files differ from it.
5. **The build kept `file:line`.** A production build strips the line, and a
   build with owner links stripped has an empty `createdBy` everywhere; both
   degrade `locate` and `describe` without failing.
6. **Retention is not `ephemeral`** if you need the run to be answerable after
   the process that made it. An ephemeral run answers while its report file is
   still there and keeps no images.
7. **The suite is React**, for update initiators and `createdBy`. Search is
   absent altogether on a raster-only capture and on a suite that is not React.

`watch`, `distill`, `covering` and `select` are the exceptions: they read no
project configuration at all.

`locate --from` and `locate --to` additionally need **`@variance-authority/sense`**
installed — a start point is a path in the source tree, and that is the package
that reads the tree. Without it the question is refused in that sentence; asking
without a start point is unaffected.

**On the caches.** In the cache (https://variance-authority.dev/docs/cache),
`<cache>/renders` holds rendered images and `<cache>/test-selection` holds the
source index, the scan's memory of the repository. Nothing has to be invalidated by hand: both are
content-addressed — a parse under the digest of the bytes it came from, a record
under that digest and a digest of the tree shape — so a stale entry, a cache from
another branch, or no cache at all costs a slower run and can never produce a
different graph or a different image. Runs prune the render cache themselves. To
force a cold read anyway, delete the directory.

## Ask the run, from the shell

`variance ask` answers from the report the last run wrote. It needs no server, no
MCP client configuration and no connection — only the config file and the report
named in points 2 and 3 above:

```bash
npx variance ask                          # the questions, and what each one answers
npx variance ask summary                  # start here; every other question takes an id it prints
npx variance ask changes                  # the distinct changes behind the changed subjects
npx variance ask composition              # what explains each movement; flake vs suspect
npx variance ask describe --subject <id>  # one subject: regions, components, files, fingerprints
npx variance ask locate --query "<words>" # the subject you can only describe, by the names the run saw
npx variance ask search --query "<word>"  # the exported name you can only describe, by the source; no run needed
npx variance ask search --query "<word>" --format json  # the same answer as data: specifier, file, line, counts
```

`summary` is the shape of every answer — counts, then the subjects that need
attention, then what was not observed:

```
3 subject(s) observed, ephemeral run at 2026-09-17T21:23:34.804Z
rendered by playwright-chromium (chromium@151.0.7922.34, darwin/arm64, 1x)
3 changed
observed everything — the execution index stands at 30783c2f…, 7 file(s) differ from it

[changed] card/summary — Button: 3,402 pixels differ across 2 regions in Button, Avatar
[changed] badge/standalone — Badge: 1,017 pixels differ across 1 region in Badge

coverage: every planned subject was observed.
findings: none in 3 inspected subject(s).
```

Each answer is text, produced by the same function an MCP client would call, so
nothing is lost by asking this way. `variance ask` exits `0` for every answer,
including one that describes changes; the verdict belongs to `variance run` and
`variance report`, which exit `1` when something needs review. Do not read a `1`
from those as a crash — a crash is `2`, and so is a missing config file.

## Ask in order

Two questions are unconditional, and in this order:

1. **`summary`** — verdict counts, the subjects needing attention, and the
   subjects that were not observed at all. Unobserved is not unchanged.
2. **`changes`** — a token edit touching forty stories is one change, not forty.
   Ask this before asking about any individual subject; it decides how many of
   the remaining questions are worth spending. It prints the component, its
   `file:line`, its reach, and the `variance accept --shape` digest that settles
   it:

   ```
   3 subject(s) changed, and they are 3 distinct change(s) — 2 of which can be decided in one action

   Button
     examples/agent-claim/src/system.js:28
     reaches 2 subject(s); it is the whole change in 1
     in the other 1, something else also moved, so accepting this shape there would
     promote a difference nobody reviewed
     5650 pixel(s): card/summary, card/compact
     variance accept --shape v1:203640236f6a486afeca1e45f656e4dd
   ```

The rest are conditional. Ask each only when its condition holds:

- **`adjudicate --claims <path>` — if you made the edit**, and before you read
  the diff. Declare what you meant to change. Its third answer — declared, and
  did not happen — is how you learn an edit never landed, which no comparison of
  images can tell you. Claims copied out of `changes` score the run against
  itself and are worthless. Adjudication is *not* a `variance ask` question in
  this position: `npx variance adjudicate --claims <path>` is its own command and
  exits `1` when a claim is unmet. **The file format is below.**
- **`composition` — before calling anything flaky.** It names what explains a
  movement, and separates `flake` (read twice, differed) from `suspect` (never
  read twice). Also ask it when a change has no obvious author.
- **`locate --query <words>` — when you can describe the subject but do not hold
  its id.** It matches over every name the run wrote down and each hit prints the
  field it matched; `composition --subject <id>` then says what that subject is
  made of. **Locate in full** is below.
- **`describe`, `explain-verdict`, `trace-component`, `findings` — once you know
  which subject or component matters.** Narrow, one at a time. Reach for
  `explain-verdict` when a subject was not compared at all; it separates
  `incomparable` (a baseline exists, another machine rendered it) from `new` (no
  baseline) from never observed.
- **`changelog` — before proposing an accept, and never after.** It previews what
  acceptance would write down.

`variance ask diff` has two subjects and the flag decides which. With `--at
<address>` it asks a watcher what moved since the last reading that watcher
handed out — the progress question. Without it, it compares the report against
the state recorded beside it by the previous successful `ask` (in `asked.json`,
in the report's directory) — the re-run question. The first invocation of either
records state and has nothing to compare:

```
The current state matches the previous invocation.
```

## Declare before you read: the claims file

`--claims <path>` is JSON, and it is the one argument with no default — it holds
what you meant to change, and nothing can infer that. Accepted as a bare array or
as `{"claims": [...]}`. Each claim is a `root` (`component:Button`,
`shape:<fingerprint>`, or a bare component name), a `reason` in your own words —
required, because it is carried into the answer a reviewer reads — and an
optional `maxSubjects` bound:

```json
{
  "claims": [
    { "root": "component:Button", "reason": "new brand accent on the primary action", "maxSubjects": 1 },
    { "root": "component:Badge", "reason": "new brand accent on the status pill" },
    { "root": "component:Card", "reason": "tighten the gap between the avatar and the action" }
  ]
}
```

An empty array is refused rather than adjudicated: "0 claims, 0 undelivered"
reads as reassurance. A file it cannot parse is refused for the same reason.

```bash
npx variance adjudicate --claims claims.json
```

```
An edit you declared did not take. Fix that before reading anything else.
4 claim(s): 1 delivered, 1 undelivered, 1 over-reaching, 1 unchecked. 1 unclaimed change(s).

  [undelivered] component:Card
      declared (tighten the gap between the avatar and the action) and `Card` rendered in
      2 subject(s) — card/summary, card/compact — and did not change. The edit did not take:
      wrong file, a dead branch, a rule something else overrides, or a stale build.

  [unobservable] component:Tooltip
      declared (arrow follows the new accent) and this run never rendered `Tooltip` in any
      subject, so nothing here is evidence about it either way.

  [overreached] component:Button
      declared (new brand accent on the primary action) and delivered, but reached
      2 subject(s) against the 1 declared — the change is the intended one, its reach is not.
      examples/agent-claim/src/system.js:28

  [unclaimed] Avatar
      Avatar moved and no claim covers it — 1 subject(s), 577 pixel(s), nothing it can settle
```

Five verdicts, and `unobservable` is not `undelivered`: the first says the run
never looked, the second says it looked and nothing moved.

## Locate a subject you can only describe

Every narrow question takes an id. You hold a description. `locate` is the one
question that goes the other way, and it searches the names the run wrote
down while comparing subjects: ids, examples, accessible names, visible text,
components, creators, declaring files, roles, custom properties, and the regions
a journey entered. It does not read the repository, and it is not code search.

**You expand the query; this does not.** Matching is lexical — your words
against the recorded names, ranked by how many matched and how rare each one is.
There is no thesaurus, no stemmer past a trailing plural, no embedding and no
model, so `auth` does not reach a screen that says *Sign in* through a component
called `CredentialGate`. Nothing will bridge that for you, and nothing should:
you have the ticket, the conversation and the checkout, and you already know
`auth` means `login`, `session`, `credential`, `token`, `jwt` — which is the
judgement a shipped synonym table would be guessing at.

So when a term comes back unmatched, do not reword it. Ask again in a different
**kind** of name. Each row below is a field, readable for whichever subjects the
run took that reading on — the header of every answer says which:

| kind | example query |
|---|---|
| what the screen says | `Sign in`, `Mark as done` |
| what the component is likely called | `Credential`, `Login`, `Session` |
| where it is likely written | `session`, `entry`, `auth/` |
| what it is, structurally | `checkbox`, `dialog`, `alert` |
| what styles it | `--va-space-2` |

Two or three of those, asked in one turn, cost two or three calls and tell you
which vocabulary this suite uses — and every question after that one is
cheaper for knowing it. An unmatched term is named as such in the answer, with
accessible names the run did record printed beside it; build the next query out
of those.

**Hand the description over as words.** No word in `--query` is ever read as
syntax, so a product that says *Under review*, *Show more* or *Inside sales* is
searched for those words:

```bash
npx variance ask locate --query "footer filter chips"
```

Every answer opens with what was searched and what was not, then the hits, then
where to take the id:

```
1 of 3 subject(s) match `badge`.
Read: id, example, names, text, components, createdBy, files, roles, tokens.
Not read: regions (no execution journal was read).

badge/standalone · 1 boundary · example of Badge
  badge: id `badge/standalone`; example `Badge`; components `Badge`

next: variance_composition {subject: "badge/standalone"} · variance_describe {subject: "badge/standalone"}
```

**Say where you are standing when the suite is large.** On a few hundred
subjects the description carries it; on a few thousand the missing word is the
place, not a better adjective. `--from <path>` answers from what that path
reaches along the imports, `--to <path>` from what reaches it. Both also change
what your words are worth: rarity is counted inside the scope, so a word common
to that area is worth nothing there.

```bash
npx variance ask locate --query "contract warning" --from "app/dispatch/page.tsx"
```

A path is a fact about the source tree, so ask from a checkout of the repository
the run was made in. Say the parent along with the file name — `Provider.tsx` is
not unique. `app/dispatch/*` is that folder's files; `app/dispatch/` is
everything under it at any depth.

**Say the arrangement when your description is a relation.** *The warning under
the Carrier field, on the dispatch drawer* names two things and how they sit;
counting matched words cannot answer it, because the surface where the warning
sits *above* the field says the same words. Name the three parts separately —
the relation is the name of the flag:

```bash
npx variance ask locate --query "warning" --under "Carrier" --on "dispatch drawer"
```

`--under`, `--above`, `--inside`, `--beside`, `--left-of` and `--right-of` take
the anchor, the thing it sits by. `--on` takes the surface, and is worth saying:
without it the anchor has to pick the surface as well. One relation per question;
two is refused.

**`--inside` is the only relation a run without layout can answer.** The other
five are decided from the rectangles the run resolved, so a run that resolved no
layout refuses them outright rather than falling back to document order, and says
so: *"This run did not resolve layout, so no landmark carries a rectangle and
nothing here knows what sits beneath what."* Containment needs no rectangle, so
`--inside` answers either way. Check the run's layout before reaching for the
other five.

**Every hit is already a place.** `where:` carries the thing on that surface
saying your words, the file and line it is declared at, and what encloses it. A
production build strips the line, so the place reads `in CarrierPicker ·
src/dispatch/CarrierPicker.tsx` — a source to open rather than a coordinate. Do
not spend a second question asking where something lives.

On a relation answer, read three things before acting:

- `matched on place` — nothing on the screen says your word; the landmark was
  found by where it is, not by what it is called. When your word is on it, the
  answer says so instead.
- `also beneath` (and the other relations) — everything else in that relation,
  nearest first. The one you meant is sometimes the second.
- `4px away` — measured between resolved rectangles. Absent when the run
  resolved no layout.

**Read the header before reading a nil answer.** Three different states look
alike and the header separates them per field: *read, and nothing matched* — the
names exist and your word is not among them, so ask again in another
kind of name, per the table above; *not read* — no journal means no regions, no snapshot means no
names, text or roles, no source index means no files, so nothing was searched;
*read, and genuinely empty* — a build with the owner links stripped has an empty
`createdBy` everywhere. Search is absent altogether, and says so, on a
raster-only capture, a run under ephemeral retention, and a suite that is not
React.

The order of hits is orientation, not evidence. Nothing in it carries a verdict
or a pixel count. Read the field each term matched on, narrow, then take the id
to `composition`, `describe` or `explain-verdict`.

## Ask a suite that is still running

A finished run left a file. A suite in flight has not, and what it says exists
only in whatever was listening at the time — so start the listener first, in its
own shell.

That listener is a **vantage**: one process, holding one run in memory, reachable
at the address it prints. `VARIANCE_AUTHORITY_VANTAGE` carries that address into
the suite's environment, and it is both the opt-in and the collision-free name of
*this* watcher — which is why there is no constant port to hard-code.

```bash
npx variance watch                     # prints VARIANCE_AUTHORITY_VANTAGE=…, stays up
```

```
variance-authority is watching. Start the suite with this in its environment:

  VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:64655

Ask it, from any other shell, with the same address:

  variance ask self --at http://127.0.0.1:64655

It holds the run in memory and writes nothing down. Stop it and the run is gone.
```

`watch` reads no config and can be started in any directory. Start the suite with
that exact assignment in its environment. An address added afterwards belongs to
the next run. Then, from any shell that can reach it **and that has a
`variance.config.json` or a `--config <path>`** — `ask` loads a config even for
the live questions, which never read it:

```bash
npx variance ask self         --at "$VARIANCE_AUTHORITY_VANTAGE"  # where it listens, what it holds
npx variance ask run-signals  --at "$VARIANCE_AUTHORITY_VANTAGE"  # tests in opening order
npx variance ask waiting      --at "$VARIANCE_AUTHORITY_VANTAGE"  # tests stopped at variance.observe()
npx variance ask test-signals --at "$VARIANCE_AUTHORITY_VANTAGE" --test <id>
npx variance ask diff         --at "$VARIANCE_AUTHORITY_VANTAGE"  # what moved since the last reading
```

`--at <address>` names the watcher and defaults to `VARIANCE_AUTHORITY_VANTAGE`.
`self` answers before any run has arrived, which is the point of asking it first:

```
Nothing has reported to this vantage yet.

A run reports here when it is started with this in its environment:

  VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:64672

That is the same env block `VARIANCE_AUTHORITY_EVENTS` goes in. The suite needs
`varianceFixtures` from `@variance-authority/playwright-test` and nothing else.
```

Ask `self` first. A suite reporting to a different address and a suite that
never started are indistinguishable from every other question, and both look
like a quiet run. An empty announcement list for a listed test is a wiring or
application signal — it is not permission to reconstruct a trace from source.

None of this is written down. Stop the watcher and the run is gone; the suite
must extend `varianceFixtures` from `@variance-authority/playwright-test` for any
of it to arrive.

## When there is an MCP connection

The same questions arrive as `variance_*` tools — the report ones, and the live
ones from `variance-authority-mcp --watch`. The routing above is unchanged.

Two binaries serve the same protocol over stdio, and they take no flags beyond
one argument:

```bash
npx variance serve                                # from @variance-authority/cli; reads the config's report
npx variance-authority-mcp <run-report.json>      # from @variance-authority/mcp; the report is the argument
npx variance-authority-mcp --watch                # the live subject; prints its address to stderr
```

`variance-authority-mcp` is `bin` of **`@variance-authority/mcp`**. It is a
transitive dependency of the CLI, so its binary is only on `npx`'s path when that
package is a direct devDependency — `npm install --save-dev
@variance-authority/mcp`. Where it is not, `variance serve` is the same server
over the same functions and needs no extra install. In an MCP client's `command`
field, write the resolved path or the package script; `npx` there costs a
registry check on every client start.

A connection additionally serves subjects the CLI does not read:

- Test distillation: `variance_distill`, then `variance_test_attention` for the
  chronology or `variance_source_tests` for an exact source point. Read React
  update initiators before execution-only opportunities.
- `variance_observability` first when several domains are connected at once, to
  see which are actually present.

Treat an unavailable domain as unknown, not as an empty reading. Do not
reconstruct runtime evidence from repository files.

## When evidence is unavailable

Connect the producer that owns the missing fact; MCP reads evidence and creates
none of it:

- **Eyes attention:** with Playwright, compose `eyesFixtures` from
  `@variance-authority/eyes/playwright` into the suite's existing extension and
  add `@variance-authority/eyes/reporter` with an `archive` path to the config's
  reporters; it folds every worker's journals into that archive. With RTL, start `watchTest`
  from `@variance-authority/eyes/rtl` in per-test setup, publish its closed
  journal with `recordEyesTest` from `@variance-authority/eyes/collect`, and fold
  the run directory once in global teardown with `gatherEyesArchive` +
  `writeEyesArchive` from the same entrypoint — that pair is what writes the
  `eyes.json` the next section reads. In either host, declare
  `arrange`, `act`, and `assert` with the adapter log's `phase(...)`; do not
  infer them from query or click names. The Playwright fixture installs the React commit tap
  before navigation. RTL needs the tap installed before `react-dom` loads. Read
  `@variance-authority/eyes`'s README before wiring either adapter.
- **Runtime journey:** `variance covering`, `variance_source_tests`,
  `variance_changed_tests` and
  `variance_distill` require an `ExecutionIndex` with stable per-test ids. Under
  Vitest, every run wrapped in `withTestSelection(config)` from
  `@variance-authority/sense/vitest` writes one beside its snapshot, except a
  run whose files run in a page; the test-selection snapshot is per test *file*
  and cannot substitute. Any runner,
  debugger, editor integration or other collector that owns per-test crossings
  can supply the index instead.
- **Live journey/events:** compose `varianceFixtures` from
  `@variance-authority/playwright-test`, start `npx variance watch` or
  `npx variance-authority-mcp --watch` first, then start the suite with the exact
  `VARIANCE_AUTHORITY_VANTAGE` assignment it prints. The address belongs to that
  watcher and that run.
- **Visual report:** run `npx variance run`. It writes the `RunReport` to the
  `report` path in `variance.config.json`, which defaults to
  `.variance/report.json` and resolves relative to the config file's own
  directory. Supply that file, not the configuration and not a reconstructed
  comparison. The config itself is a JSON file named `variance.config.json` in
  the directory you invoke from (or `--config <path>`); its required keys are
  `project`, `profile`, `viewport`, `retention` and `subjects`, and its schema
  ships at `@variance-authority/cli/schema`.
- **Presentation reading:** call `sensePresentation` from
  `@variance-authority/presentation/playwright` on a live subject and supply the
  returned `PresentationReport`. A durable presentation signal embedded in a
  run report is a different, smaller reading.
- **Scenario AAA:** use `@variance-authority/scenario` to record authored
  Arrange state and Act transitions from host-produced semantic snapshots; use
  its archive entrypoint when those executions must outlive the process.

The public integration guides are under
`https://variance-authority.dev/reference/packages/`; the cross-entrance routing
is at `https://variance-authority.dev/agents/questions`.

## Which tests entered this line

`variance covering` is the question to ask before changing a line, and the one
to ask about a test that may no longer earn its place. It reads the per-case
execution index and names the tests that went through a file, a line or a
function, nearest first.

```bash
npx variance covering --file src/checkout/total.ts --line 48
npx variance covering --file src/checkout/total.ts --function applyDiscount --format json
npx variance covering --file src/checkout/total.ts        # per recorded range
npx variance covering --file src/checkout/total.ts --format refs  # each case once, ranges by number
```

Read with `--format refs`: it numbers each case once in a table at the end and
names every range's cases by those numbers, so a module whose eleven cases all
walk it costs one table, not eleven names per range.

The index is read from where a recorded run writes it, so `--file` is usually
the whole command; `--execution <path>` names one recorded elsewhere and
`--root <path>` the project root it was recorded against. None of it is a
verdict — execution says where a test went, never why the trip was worth
taking. A missing index is refused rather than answered empty, because an empty
list reads as *no test covers this line*.

Two flags narrow the same answer to the tests that sit nearby, which is what
you want when the list is long for structural reasons:

```bash
npx variance covering --file src/checkout/total.ts --line 48 --at-distance 0-3
npx variance covering --file src/checkout/total.ts --line 48 --in-package
```

`--at-distance` counts import hops from the file to the test's own file, walked
over the file graph, and takes the range spelling a distance loop takes: `0-3`,
`2`, or `3-` for three and beyond. `--in-package` keeps the tests written under
the same `package.json` as the file you asked about. Both print how many of the
witnesses survived the narrowing, because a filtered list and a genuinely short
list read the same and lead to opposite decisions, and a test the walk could
not place is left out and counted rather than carried in. Both measure from one
origin, so neither composes with `--since`.

Every range, and the answer about one line, carries a `state`: `walked` (two
or more cases called in), `alone` (one case did, and every case that could have
reached it finished, so that case is the only one that fails for it),
`loaded` (it ran only while its module evaluated), `hole` (nobody entered it,
and a case that could have reached it stopped first, so the record cannot say
whether it would have), or `unwalked` (nobody entered it, and every such case
finished). Read `hole` as unknown, never as untested. A range with no state is
one the record cannot rank.

When the file you are asking about differs from the text the suite ran over,
which it does the moment you edit it, hand the text you hold to the question:

```bash
npx variance covering --file src/checkout/total.ts --text - --format json < edited.ts
npx variance covering --file src/checkout/total.ts --text edited.ts --line 52
```

The answer's `frame` says where its numbers stand. `recorded`: they are the
recording's, and the text matches it. `mapped`: every range was carried into
your text, and ones an edit touched carry `moved`. `stale`: the recorded text
could not be found, so no ranges are given; run the suite. A `--line` your edit
wrote is refused, because no case has run it; do not read that as a gap.

No call-stack depth is printed beside a test. Our recorder writes zero into
every crossing, so the column was a constant dressed as a measurement; *how far
away is this test* is an import count, and it is the two flags above.

At review time ask it about the whole change instead:

```bash
npx variance covering --since main
```

That reports every region the diff changed with the cases that entered it, and
counts the two findings a percentage cannot state: regions **no case entered**,
and regions one case alone entered. A changed test file is answered with the
named cases it declares — it has no module row — and a changed path the index
holds nothing for says so, since *no row* and *no test* are opposite facts. The
diff is measured from the commit the record was written at, so record before
you read. `variance_changed_tests` is the same answer over MCP, taking the
unified diff as an argument.

A review agent reads the same answer with `--format refs`, and adds the base
branch's case index to see what the change moved in files the diff does not
name:

```bash
npx variance covering --since origin/main --against base/coverage.bin.cases.bin --format refs
```

Report a **lost** region as a regression: cases walked it at the base, none do
now, and every case that could have reached it finished. Report a **hidden**
region as unknown, naming the stopped case, never as lost. A **thinned** region
is one case away from unwalked. Regions the base's branch changed after the
base was recorded are left out and named; do not charge them to the change.

## Distill, then verify

`variance distill` reads no config and no report — the two paths are its whole
input, so it answers in a checkout that has never configured this tool. At least
one of `--eyes` and `--execution` is required; `--format json` returns the same
reading as data.

```bash
npx variance distill --test checkout-submits --eyes eyes.json --execution execution.json
```

**`eyes.json`** is what `writeEyesArchive` wrote (previous section). Version `1`,
one entry per test, `complete` a boolean the producer set, `attention` a sequence
of `eyes-phase`, `react-commit`, `react-tap-refused` and `document-event`
entries:

```json
{
  "eyesVersion": 1,
  "tests": [
    {
      "id": "checkout-submits",
      "title": "checkout submits",
      "file": "src/checkout.test.tsx",
      "complete": true,
      "attention": [{ "kind": "eyes-phase", "phase": "act", "sequence": 1 }]
    }
  ]
}
```

`complete` is that field and nothing else: it is the producer's own statement
that the journal closed cleanly, and `complete: false` requires a `because`
string saying why it did not. It is **not** a judgement about whether the
`attention` array has anything in it.

**`execution.json`** is an `ExecutionIndex`: a `tests` array the crossings index
into by position, and a `modules` array of files with lexical blocks. Every block
needs `kind`, `name` (empty for a module root), `path`, `startLine`, `endLine`,
`source`, and `crossings` of `{test, distance}`:

```json
{
  "tests": [{ "id": "checkout-submits", "file": "src/checkout.test.tsx", "name": "checkout submits" }],
  "modules": [
    {
      "file": "src/checkout.ts",
      "blocks": [
        {
          "kind": "function", "name": "submitOrder", "path": "submitOrder",
          "startLine": 10, "endLine": 24, "source": true,
          "crossings": [{ "test": 0, "distance": 0 }]
        }
      ]
    }
  ]
}
```

**Nothing in this repository produces `execution.json`.** See the *Runtime
journey* bullet above: the query contract ships and the per-test producer does
not. You supply it from a runner, debugger, editor integration or collector that
already owns per-test crossings, or you run `distill` with `--eyes` alone.

The two files above, run through the command above, answer:

```
checkout submits — src/checkout.test.tsx [checkout-submits]
Eyes journal: complete.
0 target snapshot(s); 0 had no live React Fiber.

act:
  components: none attributed by Eyes
  source: none attributed by Eyes

React update initiators: unavailable; no commit evidence was recorded.

Runtime phase attribution: unavailable; ExecutionIndex retains test crossings, not AAA intervals.
Runtime journey: 1 source file(s) entered by exact test id.
  depth 0 — src/checkout.ts
Covered with no addressed target attributed to the same file: 1.
  distillation opportunity at depth 0 — src/checkout.ts

Loaded but not entered: 0 module(s).
  measured empty
```

The CLI and `variance_distill` MCP tool return the same deterministic reading.
For each distillation opportunity:

1. Preserve the original output as the witness.
2. Identify the narrowest reversible substitution at one dependency boundary.
3. Change only that boundary and rerun the exact test — with the project's own
   runner, from your shell. This is the one place the loop leaves the evidence
   and edits the tree; the read-only rule at the top of this file governs how
   questions are answered, not whether you may run a test.
4. Collect the same evidence and distill it again.
5. Keep the edit only when the assertion's causal path and addressed targets
   remain, and no outside update initiator newly reaches the retained surface.

All three conditions in step 5 are read off the second distillation, from three
named lines — compare them against the witness reading, line for line:

- **Addressed targets** — the per-phase `components:` and `source:` lines under
  `assert:`. They must still name what they named before. `Addressed surface:
  measured empty` on the second run and not the first is a loss, not a pass.
- **The assertion's causal path** — the `assert:` phase's `source:` list, which
  is the set of files Eyes attributed to the assertion's targets.
- **No outside initiator newly reaching it** — `React update initiators:` prints
  `inside addressed component paths:` and `outside addressed component paths:`
  per phase. A path that appears under `outside` on the second reading and not
  the first is the condition failing.

`React update initiators: unavailable; no commit evidence was recorded` means
none of the three is decidable. Discard the edit rather than keeping it on an
unavailable reading.

Never batch opportunities into one experiment: a passing test would not say
which substitution was justified. An entered file without addressed attribution
is a queue for counterfactual checks, not permission to mock it.

A plain test or fake component is valid input. With execution evidence and no
Eyes archive, report entered source but call the opportunity comparison and
attention unavailable. An Eyes journal whose test carries `complete: true` and an
empty `attention` array licenses the comparison — the producer closed cleanly and
measured nothing, which is a reading. `complete: false` does not, whatever
`attention` holds. Do not invent a Fiber denominator.

## Read the evidence literally

- `PerformedWork` component names say which render bodies ran. `memoizedUpdaters`
  paths say which live component instances initiated an update. Neither proves
  which source statement scheduled it.
- A missing updater field means the renderer did not expose it. An empty updater
  list means the set was measured and empty.
- Updater paths retain name, key, and props digest. Eyes owner paths retain name
  and props digest, so their overlap uses those shared structural frames. A name
  match alone does not place an updater inside an addressed target.
- Entered source without an addressed target is a distillation opportunity. It is not
  proof that the code is unrelated, mockable, or removable.
- Join evidence only on producer identities the tool accepts. Do not fall back
  from a stable test id to a title or file path.

## Fiber and live-run boundaries

`@variance-authority/react` exposes read-only bounded subtree and parent-chain
helpers for callers that already hold a Fiber. Their truncation flag is evidence;
do not silently continue with a partial path. Structural ancestry follows
`return`, not `_debugOwner`.

Observer failure must not fail the test subject: a watcher that was not there
changes nothing about what the suite did. Once the process is gone the question
belongs to a retained artifact, not to a reconstruction.

Do not add active page callbacks, event replay, or browser ownership to answer
an inspection question. Those are different capabilities and require an
explicit product decision. Vantage's environment value is both opt-in and the
collision-free address of the current watcher; a constant port does not remove
the need for the opt-in boundary.
