<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/cli

> Run the Variance Authority workflow from a project config: collect subjects, compare, render what changed, report, accept.

Part of [Variance Authority](https://variance-authority.dev).

`variance` is the executable. It captures every **subject** your project
declares — one named UI state you asked for and can ask for again: one story,
one route at one viewport, one component mounted in a test, under an id you
choose such as `cart/empty` — compares each against the baseline you approved,
writes one report, and returns the exit code CI gates on. When pixels moved, the
report names the component that drew them and the `file:line` it was written at.

Use this package when a command reading a config file in your repository is the
integration you want. If navigation and readiness already live in Playwright
tests, use
[`@variance-authority/playwright-test`](https://variance-authority.dev/reference/packages/playwright-test)
instead — it runs the same comparison from inside a test rather than from a
separate command.

## Install

The CLI never mounts your application. A **collector** — the module that mounts
a subject and reports when it is ready to be captured — owns that boundary, so
you install one beside the executable. For a Storybook:

```bash
npm install --save-dev @variance-authority/cli @variance-authority/storybook-collector
npx playwright install chromium
```

Playwright's browser binaries do not arrive with an `npm install`, which is what
the second command is for.
[`@variance-authority/route-collector`](https://variance-authority.dev/reference/packages/route-collector)
is the other shipped adapter, for served routes, a sitemap or a static build.
Anything else is a module you write, and step 1 has its shape.

## Integrate the CLI

### 1. Write the collector module

`subjects.collector` in the config names a module in your project that
default-exports a collector factory. With a shipped adapter, that module is the
adapter's factory plus your project-specific facts — this is the complete file:

```js
// variance/collector.mjs
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  // Only for a story that keeps mounting after Storybook says it rendered.
  ready: { 'checkout--deferred': '[data-testid="checkout-ready"]' },
  // Where components are declared, which is what resolves a component name to
  // `file:line` in the report.
  source: { dirs: ['src'] },
});
```

`@variance-authority/route-collector` is configured the same way from its own
options. A collector you write yourself is a factory the CLI calls once per run,
returning `plan`, `collect` and `close`;
[run visual review from the command line](https://variance-authority.dev/docs/start-cli)
spells out the full shape, and `Collector`, `CollectorContext`, `Plan`,
`PlannedSubject`, `Collected` and `SubjectSource` are type-only exports of this
package. A module whose default export is not a function is refused by path
before anything is collected.

The CLI has no URL for your application. Nothing in the config names an origin,
a port or a server, so start whatever the collector talks to before you run, and
let the collector own the address.

### 2. Add `variance.config.json`

The config declares the observation **profile** (`jsdom` for structure only, or
`chromium` for a full render), viewport, subject source, **retention**
(`durable`, which compares against a saved baseline image, or `ephemeral`,
which compares two images produced within the same run and keeps neither),
baseline backend, renderer identity inputs, and report location. The
[configuration example](#configuration) below is a complete file. The path
passed to `--config` defaults to `variance.config.json`, and relative paths
inside the file resolve against the file's own directory rather than the
working directory.

`profile` and `browser` are two different choices and the synopsis below shows
only one of them. `profile` sets how much of the page is observed: `chromium`
for a full render, `jsdom` for structure with no layout engine and no animation
clock. `browser` names the engine that paints — `chromium` (the default),
`firefox` or `webkit`. `run --profile jsdom|chromium` overrides the config's
profile for one run; the engine has no flag, because it is part of the identity
a baseline is stored under.

Unknown keys are refused, so a misspelled option cannot run silently against a
different config than the one the operator is reading.

### 3. Diagnose the environment

```bash
variance doctor --config variance.config.json
```

Run this in the same machine or CI image that will execute `variance run`.
Doctor reports what can be checked locally and labels remote renderer checks as
not performed, instead of pretending a network endpoint is healthy.

### 4. Run, review, accept, rerun

```bash
variance run --config variance.config.json
variance report --config variance.config.json --format html > out/report.html
variance accept --config variance.config.json story:checkout--empty
variance run --config variance.config.json
```

The first successful durable run reports its subjects `new` and exits `0`:
nothing moved, and nothing is approved either. Review the generated candidates, accept the intended subject ids explicitly,
then rerun. An unchanged run exits `0`; a configuration, browser, collector, or
store failure exits `2`.

`run` prints what it found, in the order it decided it:

```
$ variance run --config variance.config.json
42 subject(s) observed, durable run at 2026-08-21T10:14:02.000Z
rendered by playwright-chromium (chromium@131.0.6778.33, darwin/arm64, 1x)
42 unchanged

coverage: every planned subject was observed.

nothing to review
```

Unchanged subjects are counted, not listed; a subject that needs a decision gets
a line of its own with its component. `nothing to review` is printed only from a
run that accounted for every subject it planned — a subject the run meant to see
and could not is named under `coverage:` and takes the exit code to `1`.

Keep `accept --all` out of unattended workflows. It cannot
distinguish a never-reviewed baseline from a changed one, so explicit subject
ids are the safe default after initial setup.

## Commands

```bash
variance run     [--config <path>] [--profile jsdom|chromium] [--subjects <glob>] [--shard <k>/<n>] [--intent <text>] [--run <id> --commit <sha>] [--since <ref>] [--against <ref>] [--suite <name>] [--flakes] [--exit-zero-on-changes]
variance index   [--no-git] [--wait | --follow-ups]
variance select  [--since <ref>] [--execution <journey-file> [--diff <patch>|-] | --suite <name>] [--at-distance <hops>] [--format plain|json|vitest|jest] [--no-git]
variance reach   --since <ref> [--format plain|json] [--whole-files] [--no-git]
variance covering --file <path> [--line <n>] [--function <name>] [--at-distance <hops>] [--in-package] [--hops] [--text <path>|-] | --since <ref> [--against <record>] [--cases last|<test file>] [--where <name>[=<value>]]... [--execution <path> | --suite <name>] [--root <path>] [--format text|refs|json]
variance coverage [--suite <name> [--against <record>]] [--from <dir> | --packages] [--root <path>] [--format text|markdown|json]
variance layers  [--against <index>] [--root <path>] [--format text|markdown|json]
variance restrictions [--root <path>] [--format text|json]
variance review  [--since <ref>] [--against <record>] [--suite <name>] [--coverage] [--out <dir>] | --from-run <run id or URL> [--artifact <name>] [--root <path>] [--format text|markdown|json]
variance report  [--config <path>] [--format text|json|html [--embed-images]] [--subject <id>] [--exit-zero-on-changes] [<report>...]
variance ask     [--config <path>] [<question>] [--subject <id>] [--subjects <id>[,...]] [--component <name>] [--rule <id>] [--shape <digest>] [--claims <path>] [--test <id>] [--state <state>] [--file <text>] [--files <path>[,...]] [--area <id>] [--name <name>] [--package <name>] [--subpath <subpath>] [--query <words>] [--under|--above|--inside|--beside|--left-of|--right-of <words>] [--on <words>] [--from <path>] [--to <path>] [--changed-file <path>] [--taint-file <path>] [--just-answer] [--limit <n>] [--offset <n>] [--at <address>] [--format text|json] [<report>...]
variance distill [--test <name>] [--file <path> | --from <dir>] [--execution <path> | --suite <name>] [--root <path>] [--format text|json]
variance story   [--file <text>] [--name <text>] [--label <label>] [--in <package or file> | --around <step> | --whole | --compare last|outcome|<a>,<b>] [--root <path>] [--format text|json]
variance watch
variance adjudicate [--config <path>] --claims <path> [--exit-zero-on-changes] [<report>...]
variance accept  [--config <path>] <subject>... | --all | --shape <fingerprint>[,...] [--message-file <path> [--message <text>]]
variance changelog [--config <path>] [--component <text>] [--subject <id>] [--limit <n>] [--since <rev>]
variance journeys [--config <path> | --suite <name>] [--all] [--file <text>] [--limit <n>] [<shard.bin>... [--into <path>]] | finalize <journey-file> | stitch <shard.bin>... --into <journey-file>
variance push    [--config <path>] [--run <id>] [--commit <sha>] [--branch <name>] [<report>...]
variance serve   [--config <path>] [--just-answer] # MCP over stdio
variance doctor  [--config <path>]
variance prune
variance share   [--config <path>] [--mainline <branch>] [--publish] [<report>...] | --suite <name> [--publish [--collected <file>]]
variance carry   restore | save [--config <path>] [--format text|github]
variance comment [--config <path>] [--body-file <path>] [--run-url <url>] [--to-accept <text>] [--image-root <url>] [<report>...] | --marker
```

| command | what it does |
|---|---|
| `run` | produces the **verdict** — the per-subject outcome (`unchanged`, `changed`, `new`, `incomparable` or `ignored`) that decides the exit code |
| `index` | publishes the file graph that `select`, `reach`, `covering` and `run --since` read |
| `select` | names the test files a foreign runner may skip for this diff, for `vitest`, `jest` or a shell |
| `reach` | names every file a diff reaches, in any language it reads, for whatever you pipe it into |
| `covering` | names the tests that covered one source file, line or function, nearest first |
| `review` | prints what a change did, after the suite ran it: the edits, the changed code no case covered, the cases added, and what changed outside any import |
| `report` | re-reads what `run` wrote |
| `adjudicate` | re-reads it against what you said you were doing |
| `accept` | promotes a candidate image to baseline, by subject, by `--all`, or by `--shape` |
| `changelog` | reads back why the baselines are what they are |
| `journeys` | finalizes one runner's journey artifact, stitches artifacts from CI shards, or reads back which regions this run's subjects covered differently |
| `push` | sends a finished run to a review surface for somebody to decide |
| `doctor` | prints what this machine can observe, before a run, not after one |
| `prune` | removes the cache entries whose checkout, worktree, process or commit is gone, now |
| `share` | prints what the share holds for your mainline, or publishes this run, or every shard of one build, to its line; `--suite <name>` does either for one suite's record alone |
| `carry` | prints the paths and cache keys a CI job restores before a run and saves after it, from the config |
| `watch` | listens to a suite that is still running, so `ask` has something live to ask |
| `distill` | combines one test's portable Eyes attention and Sense execution evidence into reduction opportunities |
| `story` | draws the route one case took through the code: the files and declarations it went through, with the steps it reached each, then the part of the route you ask for, each loop drawn once; with `--compare`, lists what every recorded run on one side did and no run on the other did |
| `serve` | exposes the last run's report, and the source questions `ask` answers, to an MCP client over stdio |
| `ask` | the same questions `serve` answers, without an MCP client |

`--shape` accepts a difference **shape**: a fingerprint computed from the diff
itself, which identifies a category of visual difference so it can be matched
across subjects. It promotes a subject wherever that shape accounts for the
whole change, and refuses by name any subject where something else changed too.

`serve` and `ask` share their questions with `@variance-authority/mcp` and
`@variance-authority/help`, so an agent can ask what changed, in which
component and which file, and what that file's package publishes, without
re-running anything and without a second server.

For source questions, `justAnswer` and its `--just-answer` spelling read the
last published workspace generation regardless of age. They perform no Git
status or refresh, refuse when no generation exists, and print when the value
was produced. Without the flag a generation is reused for one hour before the
next source question refreshes it. `search` is the exception: it always reads
the published generation, whatever its age, and never scans. It refuses when
nothing is published. `--changed-file` and `--taint-file` still ask it for a new
generation by name.

A library host that injects `AskRequest.source` receives `SourceReadOptions`.
Its `tree` field is true only when the selected source tool names a `from` or
`to` path, so the injected reader can avoid loading the graph for every other
question and return it through `Sourced.tree` only then.

`--changed-file` takes a newline-delimited file of scan-root-relative paths an
editor, watcher, or CI step already detected as changed. It is producer input:
an empty file states that nothing changed, it replaces Git status discovery, and
it cannot be combined with `--just-answer`.

`--format json` prints `search` as data: the query, the area, and the
`published`, `exported` and `loose` sections, each with its `total` and the
rows `shown`. The generation is the `generatedAt` field rather than a footer
line. Every other question answers in text and refuses the flag by name.

### Ask: the agent answers, without an agent protocol

```bash
variance ask                          # the questions, and what each answers
variance ask summary
variance ask changes --component Toggle
variance ask describe --subject story:card
variance ask search --query viewport    # the code, not the run: no report and no config needed
variance ask costs --from src           # where the suite's time goes under src, from the mainline's published times
```

`ask` calls the tools `serve` serves and prints what they return. The same
function, so the two cannot describe the same run differently — and a shell is
all it takes, which matters because an MCP server is a process the *client*
launches from a config file that belongs to the client. A CI job, a sandboxed
agent, a container with no editor in it, somebody else's harness: all of them
have a shell, and many of them cannot add a server. The skill this package ships
at `skills/variance-authority/SKILL.md` routes an agent through these questions in order.
Link it into your agent's skills directory rather than copying it; `variance
doctor` prints whether an agent can find it and prints the link when it cannot.

Every answer exits `0`, including one that describes changes. `ask` reads; it
does not decide. The verdict stays with `run`, `report` and `adjudicate`, which
exit `1` when something needs review — one command per gate, so a workflow
cannot lose its exit code to a question.

`ask diff` reports what changed since the previous question was answered. An MCP
connection keeps that state in memory for as long as it lasts; a command line
cannot, so the report each answer was read from is recorded beside that report
as `asked.json`. Deleting it costs the next `ask diff` its comparison and
nothing else.

#### A checkout with no run of its own

When the configured report is not on disk, `ask` and `serve` answer from the
report CI published to the [share](https://variance-authority.dev/docs/sharing): the line for your
branch first, then your mainline's. A pull request from a fork reads the
mainline only, because a branch line of the same name belongs to a branch of
the base repository. CI publishes the report when its config sets
`report.carry` to `share`. Each answer opens with the line it read, the commit
that run was evaluated at, and where that commit is relative to your `HEAD`:

```text
report: read from branch feat/cart, evaluated at 51ab09e… for pull request head 9c4e1d2…, 2 commit(s) before HEAD; kept at <cache>/report/<digest>/.variance/report.json.
```

- **A branch record your `HEAD` does not contain is not yours.** After a
  rebase, or before you pull, the answer labels it *another run of* the
  branch, and it still answers.
- **The configured `report` path is never written.** The record is kept in
  [the cache](https://variance-authority.dev/docs/cache) under its digest, at the same path relative
  to the repository as your configured report, or as `run.json` when that
  report is outside the repository. A second question about the same record
  reads the kept copy. The next `variance run` writes your own report where it
  always does, and `ask` and `serve` read that one from then on; the first
  `variance_diff` after `serve` changes to it names the line and commit it
  compares with. `report`, `adjudicate`, `comment` and `push` do not read the
  share: they gate a run, and this checkout made none.
- **`ask` fetches images by digest, for the subjects a question names.** `ask
  describe --subject story:card` fetches that subject's images to the paths the
  report names them by, relative to the kept report, so the paths the answer
  prints open. A path that would land outside the record's digest directory is
  not fetched, and the answer prints that.
- **A share with no record for you is a refusal that lists what it queried.**
  Each line gets its own line in the message, with what it answered: nothing
  published, a credential refused, a store that did not answer, a format this
  version does not read. A mainline answer names the branch line queried before
  it the same way, with what that line answered.

### Distill: find a smaller test boundary

`distill` reads the record your test run writes, which does not come from
`variance run`. The record holds two readings of each case:

- **which files and regions the case covered** — install
  [`@variance-authority/sense`](https://variance-authority.dev/reference/packages/sense)
  and wrap the runner config in `withTestSelection`;
- **what the case queried, operated and read** — in a Playwright suite recorded
  that way, extend `test` with the fixtures from
  [`@variance-authority/eyes/playwright`](https://variance-authority.dev/reference/packages/eyes),
  and each attempt's journal lands in the record under its case.

A record without journals still lists covered source, but produces no
opportunities, because missing attention is not an empty addressed surface.

Name the case by the file that declares it and its title:

```bash
variance distill --file test/checkout.spec.ts --test submits
```

`--file` takes any part of the test file's path. `--test` takes the case's
`id`, its exact title, or a part of the title, compared without case. Either
flag may be given alone. When more than one case fits, the command prints up to
five of their ids and stops; pass one of them to `--test`. A case Playwright
retried prints every attempt's journal, numbered from 1.

`--file` alone reads the whole file: the modules it loaded that no case
entered, and those only some of its cases entered, with their length in lines.
The file pays for each once, when it loads, whichever cases use it. Each module
no case entered is listed under the import that made the file load it, read
from the checkout's file graph: the topmost import every path to it runs
through, in the test file or in a module it used.

Name neither flag, and `distill` reads every test file that way, or with
`--from <dir>` every one under a folder or a package, and ranks the imports
they load for nothing by their lines summed over the test files each reaches.
With no `--suite`, it reads every declared suite.

`distill` reads the record `covering` reads; `--suite <name>` picks one declared
suite's, and `--execution <path>` reads any other record, or JSON from a tool
that already records per-test crossings. From the root `variance.config.json` it
reads only the declared suites. It reports addressed targets by authored Arrange/Act/Assert
phase, React update initiators inside and outside those target paths, and files
covered by the exact test id without addressed source attribution:

```text
act:
  components: CheckoutForm
  source: src/checkout/form.tsx

React update initiators:
  act: 2 commit(s)
    inside addressed component paths: CheckoutForm
    outside addressed component paths: Clock

Runtime journey: 4 source file(s) covered by exact test id.
Covered with no addressed target attributed to the same file: 2.
  distillation opportunity at depth 0 — src/analytics.ts
  distillation opportunity at depth 0 — src/top-nav.tsx
```

The command options are `test`, `execution`, `root`, and `format`; their flag
forms are shown in the synopsis above.

`--format json` returns the same ordered analysis as data. The command always
reads: a distillation opportunity is not a verdict that a file is safe to mock.
The verification workflow is in [distill a test](https://variance-authority.dev/docs/distill).

### Covering: which tests covered this line

`covering` reads the same execution index `distill` does, to answer the
question a reader has while looking at code rather than at a test: which named
tests went through here.

```bash
variance covering --file src/checkout/total.ts
variance covering --file src/checkout/total.ts --line 48
variance covering --file src/checkout/total.ts --function applyDiscount --format json
```

```text
3 named tests covered line 48 of src/checkout/total.ts:
  src/checkout/total.test.ts
    applies a percentage discount
  src/checkout/Cart.test.tsx
    renders a cart with a coupon
  src/checkout/flow.test.tsx
    checks out
```

Each test file is named once, with its cases under it. Over a whole file, a
range walked by the same cases as the one before is folded into one line.

When the root `variance.config.json` declares
[suites](https://variance-authority.dev/docs/execution-record#one-record-for-each-suite),
`covering` reads every suite's record and answers under each suite's name and
kind, because each suite proves something different:

```text
checkout (e2e): nothing is recorded in /repo: no run left a per-case index at …
stories (visual): `src/checkout/total.ts` is not in the index at …
unit (unit):
  2 named tests covered line 48 of src/checkout/total.ts:
  …
```

In JSON the answer is a `suites` list. Each entry is that suite's own answer
with its `suite` and `kind`, or its `reason` with `refused` set to `unrecorded`
or to `unloaded`, for a file the suite never loaded. `--suite <name>` reads one
record alone, and answers in the shape a repository with one record does.

`--format refs` is the same answer for an agent, which pays for every repeated
name. Each case is numbered once, in a table at the end, and every range names
its cases by number, with runs collapsed:

```bash
variance covering --file src/checkout/total.ts --format refs
```

```text
src/checkout/total.ts — 3 recorded ranges
1-8 walked: 1-3
12-20 walked: 1-3
48 walked: 1-3

cases
src/checkout/Cart.test.tsx
  1 renders a cart with a coupon
src/checkout/flow.test.tsx
  2 checks out
src/checkout/total.test.ts
  3 applies a percentage discount
```

`3*` marks a case that was inside the range only while the module evaluated.

This is not a verdict. Execution records where a test went, never why it was
worth running, so three tests on one line is the beginning of the question *why
do all three need this code* and not the answer to it.

#### Narrowing the answer to what is nearby

On real code the list is long, and it is long for two reasons that are
structural rather than interesting: a test many packages away that arrived
through a chain nobody would call a dependency, and a test in another package
that arrived because everything arrives at a base module. Two flags cut the
list down by where the *test* sits:

```bash
variance covering --file src/checkout/total.ts --line 48 --at-distance 0-3
variance covering --file src/checkout/total.ts --line 48 --in-package
```

```text
2 named tests covered line 48 of src/checkout/total.ts:
  applies a percentage discount — src/checkout/total.test.ts [total.test.ts::applies a percentage discount]
  renders a cart with a coupon — src/checkout/Cart.test.tsx [Cart.test.tsx::renders a cart with a coupon]
2 of 3 named tests kept.
```

`--at-distance` counts **import hops** from the file to the test's own file,
walked over the file graph — the same quantity `variance reach` walks, spelled
the way a distance loop spells a range: `0-3`, `2`, or `3-` for three and
beyond. It reads the graph and the coverage snapshot, so it costs a scan the
plain question does not; that is why it is a flag.

`--in-package` keeps the tests whose file is under the same `package.json` as
the file you asked about.

A line or function answer names each test file once, with how many of its cases
went through the line out of how many it declares: `total.test.ts — 2/3`.
`--hops` adds each file's import hops and orders the files nearest first, a file
the walk could not place last. It narrows nothing, and it costs the same scan
`--at-distance` does, which is why an editor requests it on a click and not on
every keystroke.

The counts are printed whichever way the answer went, because a filtered list
and a short list read identically and lead to opposite decisions. A test the
walk could not place is left out of the band rather than carried into it, and
counted in a note: an unmeasured distance is not a short one.

Both flags need one origin to measure from, so neither composes with `--since`
— a diff is many origins, and a test has a distance to each changed file and no
single one to the change.

No call-stack depth is printed. `ExecutionCrossing.distance` exists for a
foreign producer that measures one; the recorder in `@variance-authority/sense`
does not, and writes zero into every crossing, so a depth column here was a
constant dressed as a measurement. *How far away is this test* is an import
count, and it is the two flags above.

Given `--file` alone the answer is per range rather than per test: the recorded
regions of the file, each with the tests shared by every line in it, which is
where an unclaimed region shows up as one.

Each range, and the answer about one line, also carries the one word an editor
paints it with:

- `walked`: two or more cases called into it.
- `alone`: exactly one case did, and every case that could have reached it
  finished. That case is the only one that fails if this code breaks.
- `loaded`: it ran only while its module evaluated.
- `hole`: nobody entered it, and a case that could have reached it stopped
  first. A failed case, or a flake your CI suppressed, never finished its trip,
  so the record does not show whether it would have come here.
- `unwalked`: nobody entered it, and every case that could have reached it
  finished.

A range with no word is one the record cannot rank, because a case's stop was
never recorded.

#### Reading the test you are writing

The answer about a file is the whole suite's. While you write a test, that
hides what you want to see: forty cases walk the function, so the lines your
test misses still read as walked. `--cases` answers from the cases you choose
and nothing else:

```bash
variance covering --file src/checkout/total.ts --cases last
variance covering --file src/checkout/total.ts --cases src/checkout/total.test.ts
```

```text
Read from the 3 cases of the last run at 8a72c74b1e03, not the whole suite.
src/checkout/total.ts — 4 recorded ranges, 3 named tests
```

`last` is the run that wrote the index last, which is the run you just made. A
test file is every case the index holds for it. The five words mean the same
thing measured against those cases: `unwalked` is *no case you chose entered
it*, not *no test does*. The answer starts by saying which cases it was read
from, and `--format json` names each one under `scope`.

A run of one file does not change the suite's answer: the index keeps every
case the run did not replace.

With `last`, the answer also prints what your edit changed. The run keeps the
cases it replaced, so each region those cases entered before and do not enter
now is listed, and so is each region they entered for the first time:

```text
Against the run before it at 8c41d2e90b17: 1 lost.
  lost     src/checkout/total.ts 62-66 branch applyDiscount — was total.test.ts > applies a cap
src/checkout/total.test.ts no longer enters applyDiscount in src/checkout/total.ts (1 region).
```

The words are the ones `--against` uses below, and so is the pairing: the
replaced cases are read through git's diff from the commit they were recorded
at. A second run at the same commit that runs a test file again mixes that
commit's cases into the ones it replaced, so the comparison is refused with exit
2 until you commit; the first run after a commit compares with the last run at
the commit before.

#### Reading the state each covering test ran under

Coverage records which cases ran the code you asked about. A case that
records the state it ran under with
[`variancePrecondition`](../sense#record-the-state-each-test-ran-under) has it
on its row, and every case `covering` lists prints each value with the call
that recorded it. `--where` keeps the covering cases that ran under a
precondition, in every form of the question:

```bash
variance covering --file src/checkout/total.ts --function total --where prices=discounted
```

```text
Kept the 2 of 4 cases that covered function total of src/checkout/total.ts and recorded prices=discounted.
2 named tests covered function total of src/checkout/total.ts:
  test/total.test.ts — 2/4
    sale prices > applies the discount — discount=on (test/flags.ts:6), prices=discounted (test/prices.ts:12)
    sale prices > charges the sale price — discount=off (test/flags.ts:6), prices=discounted (test/prices.ts:12)
```

The count is out of the cases that covered what you asked about, before
`--where` narrowed them. `--where prices` keeps every value of `prices`, and
every repeated `--where` must hold. Two values recorded at one level print as a
contradiction, and match a `--where` naming either. A record made before cases
recorded preconditions answers `unmeasured` rather than an empty list, and a
case from a runner that does not record preconditions is counted apart from the
cases that recorded nothing. When `--where` keeps none of the cases that covered
a line or function, the answer prints that the filter left none of them and how
many there were, rather than that no test covered it. The state of a line,
function, range or changed region, and the cases that stopped before it, are
read over the same cases before `--where`: a line three cases ran stays `walked`
when `--where` keeps one of them, and a hole stays a hole when it leaves out the
case that stopped.

When `names.axes` in `variance.config.json` declares a name, its first value is
the base. `covering` reads a case that recorded nothing for that name at the
base, so with `discount` declared as `["off", "on"]`, `--where discount=off`
keeps it. That reading comes from your configuration, not from the run. A value
the axis does not list is printed by name with its site, and kept.

Beside each case recorded away from the base, with or without `--where`, is its
twin: the case in the same test file that covered the same code with the axis
nearer its base and every other precondition the same; on a two-value axis,
that is the base. A case recorded with
`discount=on` prints the case in its file that ran the same code with
`discount=off` and the same `prices`:

```text
    applies the discount — discount=on (test/flags.ts:6), prices=full (test/prices.ts:12)
      twin at discount=off: charges the regular price
```

With several axes declared, the twin differs on one axis only: the last declared
axis on which the case is away from the base. On it, the twin is at the nearest
lower value a case in the file covered the code at: on `["off", "half", "on"]`,
a case at `on` is twinned with `half` when one exists, and with `off` otherwise.
Twins are looked for among the cases that covered what you asked, before
`--where` narrowed them. Several twins print as their count and the first three
names. When no case in the file matches, the line under the case is `no twin
recorded at discount=off`.

#### Asking about the text you hold

The recorded line numbers are the ones the suite ran over. Edit the file and
they point at whatever code sits there now. So the answer about a file checks
the text against the recording first, and names the `frame` its numbers
stand in:

- `recorded`: the file is the text the suite ran over.
- `mapped`: the text changed, and every range was carried to where its lines
  stand now. A range an edit touched is marked `moved`.
- `stale`: the text changed, and the text the suite ran over could not be found.
  No ranges are printed, because ranges at the wrong numbers would be read as
  real.

```bash
variance covering --file src/checkout/total.ts --text - --format json < buffer.ts
```

`--text <path>` reads the held text from a file, and `--text -` reads it from
standard input, which is how an editor queries a buffer you have not saved.
`--line` then names a line in that text. A line the edit wrote is refused
rather than answered, because no case has run it yet.

The index comes from any run wrapped in `withTestSelection(config)` and is read
from where that run writes it, so an agent with a line number
needs no flag but `--file`. `--execution <path>` names an index recorded
somewhere else, and `--root <path>` names the project root the run recorded
against. A missing index is refused rather than answered empty, because an empty
list here reads as *no test covers this line* — the sentence that gets a test
deleted.

When no run has recorded the project at all, `--format json` also prints
`{"refused":"unrecorded"}` on standard output. A program asking on every edit
can then stop asking without reading the sentence, which still goes to standard
error for a person.

### Covering a change: what a review needs before reading the diff

`--since <ref>` asks the same question of everything a diff touched, which is
the shape a review has:

```bash
variance covering --since main
```

```text
2 changed files since main, 5 changed regions: 1 nothing covered, 2 covered by one case.
Read from <cache>/test-selection/<digest>/coverage.bin, recorded at 8a72c74.

src/checkout/total.ts
  41-60 function applyDiscount — 3 cases
    applies a percentage discount — src/checkout/total.test.ts [total.test.ts::applies a percentage discount]
    ...
  62-66 branch applyDiscount — no case covered this region

src/checkout/total.test.ts
  a test file — 4 named cases declared here, which is what changed rather than what was reached:
    applies a percentage discount [total.test.ts::applies a percentage discount]
    ...
```

Two of those lines are findings and neither is a percentage. A changed region
**no case covered** is a hole in the evidence; a changed region one case alone
covered is evidence standing on a single point, and a line count cannot tell
the two apart from a region twenty tests cross. A case that was inside a region
only while its module was evaluating is counted apart, because it was present
rather than exercising anything.

A changed **test file** has no module row — the run instruments what the tests
import, not the tests themselves — so it is answered with the named cases it
declares rather than reported as unmeasured. A changed path the index holds
nothing for is printed as `no row`, because *no row* and *no test* are
opposite facts.

The diff is measured from the commit the record was written at rather than from
the merge base with `<ref>`, since the index's line ranges are in that commit's
coordinates and nothing else's. Record before you read: an index behind the tree
answers fluently about regions that have moved.

#### What a change moved

A change to a test does its work on lines the diff does not show. The test that
stops calling a function takes that function's coverage with it, and the
function's file is not in the diff. `--against` reads a second record, the
base, and compares the two region by region:

```bash
variance covering --since origin/main --against base/coverage.bin
```

```text
Against base/coverage.bin at 3f9e21c07a44: 1 lost, 1 hidden, 2 gained.
  lost     src/checkout/total.ts 62-66 branch applyDiscount — was total.test.ts > applies a cap
  hidden   src/checkout/tax.ts 12-30 function taxFor — was tax.test.ts > rounds; stopped: tax.test.ts > rounds
  ...
src/checkout/total.test.ts now enters formatTotal in src/checkout/format.ts (2 regions), and no longer enters applyDiscount in src/checkout/total.ts (1 region).
```

A region is matched across the two through git's diff from the base's commit to
your working tree: the diff carries each region at the base to the lines it
stands on now, so a function your change moved down the file is still the same
function. Siblings of one name, such as three `.filter` callbacks in one
function, are told apart by their lines too, so deleting one of them does not
read as the others losing and gaining theirs; the answer counts those as
renumbered. A region the diff carried onto lines where only a region of
another path stands, with no edit in its function before it to explain the new
path, is not compared: the answer lists it as not compared, with where it
landed. Each region whose cases moved is one of four:

- **lost**: cases walked it at the base, none do now, and every case that could
  have reached it finished. This is a regression.
- **hidden**: the same, except a case that could have reached it stopped. The
  case is named, and the region is not called a regression.
- **thinned**: several cases walked it at the base, one does now.
- **gained**: no case walked it at the base, one or more do now.

A region that stayed walked is not listed. When nothing moved, the answer prints
*no region moved*, because an empty list and a comparison that was not made
are different answers.

The base is the record your base branch made, restored in CI into a directory
of its own before this run writes. It names the commit it was made at, and your
clone needs that commit: a base that names none, or names one your clone does
not have, is not compared, and `covering` exits 2 and prints which. Fetch the
commit with `git fetch origin <sha>`, or check out every commit in CI with
`fetch-depth: 0` on `actions/checkout`. When that commit is behind the merge
base, the files the base branch changed in
between are left out and named, because what moved in them is that branch's
doing, not yours. `--against` answers in `text`, `refs` and `json`; `refs`
names the moved regions' cases by the numbers of its case table.

### Review: what a change did, for the person merging it

`covering --since` lists every changed region. The person deciding whether to
merge needs the counts first: which edits change nothing that runs, which new
code no case covered, which code only a distant test covered, and what changed
where no import shows it. `review` reads the recording the suite just wrote and
answers that:

```bash
yarn test
variance review --since origin/main
```

```text
Changes since 3f9e21c07a44.

2 changed regions in 1 file, 1 of them new.
- 1 no case covered, 1 of them new.
- 0 covered only by tests further than one import away.

Edits:
      1  top-level values
      1  not a module

Changed regions (new in brackets):
      1 (0)  covered by a test that imports the file, or is the file
      1 (1)  no case covered it

Cases: 1 added, 0 removed, in 1 test file.
- src/checkout/total.test.ts: + rounds

Before any import: 1 changed file the tests declare as a precondition.
- config.json: 1 of 1 test files

Regions not covered by a test one import away:
  src/checkout/total.ts:5-7 function round — no case covered it (new)
```

Each part comes from the party that owns the answer:

- **Edits** reads each changed module from both of its texts: comments, types
  and formatting change nothing that runs; otherwise the change is to function
  bodies only, to top-level values, or to what the module loads. A changed
  file that is not source, such as `config.json`, is counted as not a module.
- **Changed regions** counts each changed function or branch by the tests that
  covered it. When the only tests that ran a region are further than one import
  from its file, a failure there points at code the test never names. A branch
  inside an uncovered function is counted once, with the function;
  `--format json` keeps every region.
- **Cases** added and removed are read from the case index, per test file.
- **Before any import** names changed files the test runner loads before any
  test, such as its config, or declares in `preconditions`, and how many test
  files depend on each. No import graph shows them.
- Installed packages the lockfile changed come last, because nothing in your
  own source shows them either. Each one your code depends on is followed to
  your files: the chain of packages from the one that changed to the one you
  import, the files that import it, and how many test files run them. A bump
  you never import directly reads `picomatch` → `micromatch` →
  `src/glob.ts`. Packages nothing of yours depends on are named on one line.
  Workspace manifests whose entry points changed follow.

The diff starts at the merge base with `<ref>`. Without `--since`, it starts at
the commit the recording stood at before the first run at this commit. Every
run writes that commit, with the test files it ran, to `coverage.runs.json`
beside the recording, so after a `yarn test` on a branch, `variance review`
alone answers for everything since the previous run. When the recording
already stood at the commit you ran at, as a worktree's first run at its base
does, the start is that commit and the change is your working tree. When the
runs record beside it names another commit, as it does after a landing that
stopped between the recording and the record, the start is the commit the
record names. A retry or a second shard at the same commit keeps the same
starting commit and adds its test files to the list. Shards landed with
`variance journeys <shard>...` count as one run at the shards' commit.

That commit is a start only when the one you ran at descends from it, and the
review reads that from git. A run after checking out an older commit, or
mainline shards landed over your branch's runs, has no previous commit to start
from, and is read like the run below. When git cannot tell, because your clone
does not hold that commit or is shallow and cut between the two, the review is
refused and names the commit to fetch.

A run in a checkout that had no recording before it, such as a fresh clone,
has no previous commit to start from. When the root config gives that suite to
the [share](https://variance-authority.dev/docs/sharing) with `"carry": "share"`, the review starts at
the commit your mainline published its record at, compares cases with that
record's, and prints that in its first line:

```text
Changes since 51ab09e7c2d4, where mainline main published its record of "unit", 3 commit(s) behind the merge base with this checkout. 1 run at 9c4e1d2a07b8 recorded 4 test files.
```

A record published past your merge base with the mainline is at a commit your
branch does not contain. The review starts at the merge base instead, names
both commits, and does not compare cases with the record's, because they were
recorded over commits your branch does not have:

```text
Changes since 2f07c1a9be3d, the merge base with 51ab09e7c2d4, where mainline main published its record of "unit", 2 commit(s) past the merge base with this checkout. 1 run at 9c4e1d2a07b8 recorded 4 test files.
```

The record a branch published to the share, on its `branch/<name>` line, is
never the start: the review would measure the change against itself. `--since`
still names the start. When the mainline's record cannot be read either, the
review stops, and the message names what the share answered.

The review also lists the regions whose cases changed. It compares them with
the cases the runs at this commit replaced, which the suite keeps beside its
case index with the commit they were recorded at. What the base's branch changed
after that commit is left out and named, as in
[What a change moved](#what-a-change-moved). Only the test files that a run at
this commit wrote to the case index are compared, as are the cases each test
file added and removed. A run that writes no case index, such as one whose only
file a browser gate skips, replaced no case: the review names its files and
compares nothing for them.
`--against <record>` compares with a case index you hold instead. `--out <dir>` writes `review.json` and `review.md` beside what is
printed. The markdown starts with a hidden marker line, so a pipeline finds its
own pull request comment and edits it instead of posting another.

`--coverage` includes coverage for every declared suite in the same review.
The comment leads with the changed-code finding, which test files ran at this
commit, and the execution changes per suite. Percentages and source inventories
are folded under **Coverage by suite**. Each suite keeps its own denominator
and baseline; a missing record or baseline is named rather than counted as zero.
The coverage readings travel in `review.json`, so `--from-run` prints the same
evidence without reading the laptop’s recordings.

In CI, restore the recording directory your base branch saved to the runner
cache (the directory [the cache](https://variance-authority.dev/docs/cache) describes), run the
suite, and review after it:

```yaml
- run: yarn test
- if: ${{ !cancelled() }}
  run: |
    npx variance index
    npx variance review --since "$BASE" --out review --format markdown >> "$GITHUB_STEP_SUMMARY"
```

In the markdown, the test files whose reach moved are also drawn as a Mermaid
diagram: a test file on the left, a directory of the code it runs on the right,
and each edge counts the functions it now enters or no longer enters. The same
lines as the text follow it, folded. The markdown lists the first 40 moved
regions, test files whose reach moved, and files not compared, and counts the rest.
GitHub rejects a comment longer than 65,536 characters, so a longer markdown
review is cut at a line break before that length, and its last line gives the
number of characters not shown.

Under each changed function a case ran, the markdown lists those cases by test
file and title, each with the preconditions it recorded, the way `covering`
prints them: `applies the discount — discount=on (test/flags.ts:6)`. When the
cases recorded more than one value of a name, the function's line names every
value — `ran under discount=off, discount=on` — so you see which states ran the
change without asking `covering --where`. For a record made before cases
recorded preconditions, the state they ran under is printed as unmeasured, and
cases from a runner that does not record preconditions are counted apart from
the cases that recorded nothing.

A comment shows part of the answer, and `review.json` holds all of it. Upload
the `--out` directory as an artifact, and anyone with the GitHub CLI can print
the whole review in their own terminal:

```bash
variance review --from-run https://github.com/acme/shop/actions/runs/36531792356
```

`--from-run` takes a run id or the URL of a run or one of its jobs. It runs
`gh run download` for the artifact `variance-review`, or the one `--artifact`
names, and prints the `review.json` inside in the format asked for. The review
is the one the run made, so `--since`, `--against`, `--suite` and `--out` are
refused beside it. When `gh` is not installed, or the artifact has expired, the
message names which.

A suite split over several invocations at one commit keeps the base's cases for
every file any of them ran. Once an invocation runs a file a second time, that
file's replaced cases are this commit's own, and the review no longer names a
commit for them.

`variance index` comes first because the review reads from the file graph which
tests import each changed file, and under CI the graph is read from what `index`
published, never built on demand. A region covered only by a test the published
graph does not list, such as one added after `index` ran, is counted on its own
line, because its distance was never measured; it is not counted as further than
one import away.

### Coverage: how much each kind of suite runs, and what changed it

`coverage` counts the regions each suite ran, over every region any suite
loaded, and prints how many regions more than one kind of suite runs and how
many only one kind runs. It reads the case index each suite already wrote, so
there is no second instrument and no second run:

```bash
variance coverage
```

```text
coverage at 7556a03a — 4,812 regions in 311 files the suites loaded
  any suite           4,356  90.5%
    checkout  e2e     3,900  81.0%  recorded at 7556a03a
    stories   visual    718  14.9%  recorded at 63e1d779
    unit      unit    3,352  69.7%  recorded at 7556a03a
  more than one kind  2,910
  one kind alone      1,446  unit 380 · e2e 986 · visual 80
  nothing ran           339
  ran only at load      117
```

Each number is a count of regions, the functions and branches the recording
cuts a module into. A region counts as run when a case called into it. A
region that ran only while its module loaded is counted on its own line,
because loading a module runs its top level for whichever test imported it
first, so the count is lower than a line coverage tool reports for the same
run. Every suite's share is taken over the same total, so `visual 14.9%` is
14.9% of the code any suite loaded, not of the code the visual suite loaded. A
suite the root config declares and that has not recorded is printed as
`unrecorded`, never as `0%`. When two suites cut one module into different
regions, the regions one cut has and the other does not are counted as not
joined.

With a base, each count is printed at the base and now, beside the parts that
add up to the change:

```text
coverage at 7556a03a against each suite's base — 4,812 regions (4,790 at the base) in 311 files the suites loaded
  any suite           4,310 → 4,356  90.0% → 90.5%
    checkout  e2e     3,832 → 3,900  80.0% → 81.0%  gained 51 · lost 2 · written 22, 19 run
    stories   visual  1,437 →   718  30.0% → 14.9%  lost 716 · hidden 3
    unit      unit    3,353 → 3,352  70.0% → 69.7%  gained 4 · lost 9 · written 22, 4 run
  stories: src/checkout.stories.tsx no longer runs 716 regions it ran at the base
```

`gained`, `lost` and `hidden` are the regions whose cases changed, the words
[What a change moved](#what-a-change-moved) uses. `written` and `deleted` are
regions only one of the two records has, in a file both have, and `now loads`
and `no longer loads` count the files only one of them has. The parts always
add up to the change in the count. The test files whose regions changed most
are named under the table.

Each suite's base is the record its mainline published to the
[share](https://variance-authority.dev/docs/sharing), for a suite the root config gives to it with
`"carry": "share"`. For one suite, `--suite <name> --against <record>` names a
case index instead. The comparison is printed only when every recorded suite has
a base, because every share is taken over the regions all the suites loaded,
and a suite missing from the base changes that total for all of them. Each
suite with no base is named with the reason.

A base's regions are paired with the current ones through git's diff from the
commit the base was recorded at, as `covering --against` pairs them. A base that
names no commit, or one your clone does not have, is not compared: `coverage`
and `review --coverage` exit 2, name the commit, and print how to fetch it. In
CI, check out every commit with `fetch-depth: 0` on `actions/checkout`.

A record holds only the modules some suite loaded, so a file that no suite
loaded is in no record. `coverage` reads the rest from the
[source index](https://variance-authority.dev/docs/cache), which stores the size of every JavaScript
and TypeScript file it parsed: its bytes, the lines that hold code, the regions the recording would
cut it into, and how many names it exports. The files no suite recorded are
listed by directory, and the share is printed again over every region in the
source:

```text
source: 338 files reached from the entry points of packages/apps/main
  before reach                     4 files   212 lines    61 regions
  recorded by no suite             27 files  1,203 lines  388 regions
    packages/apps/main/src/legacy  12 files  610 lines    201 regions
    packages/apps/main/src/admin   9 files   402 lines    131 regions
    libs/ui/charts                 6 files   191 lines    56 regions
  total coverage for 4,417 of the 5,261 regions: 84.0%, 1.4% before reach
```

Tests, `*.config.*` files and declaration files are not source here, because no
recording instruments them.

*Before reach* is what the test harness loads: the files the runner's config
reaches through its imports, as the recording names it
([changes before and beyond reach](https://variance-authority.dev/docs/changes-before-and-beyond)).
Only the part of it the scope's entry points reach is counted, so the config
itself is in no scope. Those files ran under every test and no record holds a
region of them, so the second share counts them as run and prints how much of
the run they are: code every test runs and no test is aimed at.
`--format json` names every file.

Without `--from`, the source is what every declared directory's entry points
reach, and a table under the share gives each directory a row; a file none of
them reaches is not counted. With no entry points declared, the source is every
file the index holds. `--from <dir>` counts one part of a repository on its own. The
source is then what the directory's entry points import, followed through every
import, so a shared package the application imports is counted with it and a
sibling application is not. Every count above the source lines is narrowed to
the same files. The root `variance.config.json` declares the entry points, as
paths relative to each directory, where `*` matches within one path segment and
`**` matches any number of segments:

```json
{
  "entrypoints": {
    "packages/apps/main": ["src/main.tsx"],
    "packages/apps/next": ["app/**"]
  }
}
```

A directory with no entry points declared starts from every file under it, and
the first line prints that. A pattern that matches no file is named.

To leave a part of the repository out of the count — a marketing site nothing
measures, say — declare the repository root as the directory (`"."`), with a
pattern for each top-level directory you do count. What the patterns do not
name, and nothing they name imports, is not in the source.

`--packages` gives every workspace the root `package.json` names a row of that
table:

```text
                  own     before reach  with imports  before reach
  packages/cli    81.9%   0.0%          85.7%         1.1%
  packages/sense  59.5%   3.3%          65.3%         3.2%
```

*Own* counts the package's own files. *With imports* counts everything its
files reach, including the other workspaces they import. Each is followed by
how much of what ran is before reach.

`--format markdown` prints a table for a job summary, and `--format json` prints
every count. `coverage` exits `0` whenever it could read the records, whatever
the numbers are: a threshold is a line in your own workflow.

### Watch: ask about a suite that has not finished

A finished run leaves a file, so any number of processes can open it whenever
they like. A run in flight leaves nothing, and the only copy of what it reported
is in the memory of whatever was listening at the time. So somebody has to be
listening *before* the suite starts:

```bash
variance watch
```

It prints the one line the suite has to be started with, and stays up:

```
VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321
```

That variable goes wherever `VARIANCE_AUTHORITY_EVENTS` goes, and **none of it
is about visual regression** — a test that takes no screenshot reports exactly
what one that does reports. Start the suite in one shell and ask from another:

```bash
variance ask self --at http://127.0.0.1:54321
variance ask run-signals --at http://127.0.0.1:54321
variance ask test-signals --test 'checkout settles' --at http://127.0.0.1:54321
```

`--at` defaults to `VARIANCE_AUTHORITY_VANTAGE`, so a shell that already exports
it for the suite asks with nothing extra typed. Ask `self` first: it prints
where the watcher is listening and what it has heard, which is what separates a
run that reported somewhere else from one that has not started. `run-signals`
marks the test still going with `▸`; `test-signals` gives everything one test
announced, in order, with the realm that announced each and the work that
started without finishing — the answer a timeout cannot give, because a runner
reports only the condition a test was waiting for.

`ask diff --at` works here too, against the reading the watcher handed out last.
The watcher keeps that state, not a file, because this process exits
between questions and there is nothing to write down: the run lives in memory
that ends with the watcher. Stop it and the run is gone.

The same questions are served over stdio by `variance-authority-mcp --watch`,
from [`@variance-authority/mcp`](https://variance-authority.dev/reference/packages/mcp), for a client that speaks it.
Same functions, same text.

### Push: put a build in front of a reviewer

A [`tribunal`](https://variance-authority.dev/reference/packages/tribunal) deployment stores builds, a **docket** — one
entry per root cause, grouping every subject that cause reached — and recorded
decisions. `push` is what gets a run there — the report the run already
wrote, with the images beside it.

The `review` section sets where `push` sends it — an `endpoint` and
the token to present:

```jsonc
// variance.config.json
{
  "project": "snkr-shop",
  "profile": "chromium",
  "retention": "durable",
  "viewport": { "width": 1280, "height": 800 },
  "subjects": { "kind": "collector", "collector": "variance/collector.mjs" },
  "baselines": { "kind": "directory", "root": "baselines" },
  "report": "out/report.json",
  "review": {
    "endpoint": "https://variance.example.com/api",
    "token": { "env": "VARIANCE_INGEST_TOKEN" }
  }
}
```

```bash
variance run
variance push --branch "$GITHUB_REF_NAME"
```

The token is the deployment's **ingest** token, never its review one: review
promotes a baseline every later run is compared against, and a value that can do
that has no business in a config a run reads. A build is filed under three
things — its `build` id, the `commit` it was rendered from, and the `branch`
somebody is deciding about — and the first two come from `--run` and `--commit` or
from the CI environment, on exactly the terms `run` reads them. Neither is
invented: a build filed under an id nobody chose cannot be found again.

It is separate from `run` on purpose. A sharded suite produces N reports and one build,
so `push` takes the same report arguments `report` and `comment` take and pushes
the merge; a service that was down does not turn a correct run red; and a build
that failed to post can be posted again from the artifact, on a machine that
never opened a browser.

A candidate whose sidecar cannot be read is **withheld and named**, not sent.
Approval promotes an image keyed by its document digest, so bytes under an
invented key would be an approval that could never settle a later run. The
subject still goes up with its verdict, its regions and its `before`; what it
loses is the button.

Both ends report their version. `push` requests the deployment's API version
before it reads a byte off disk and prints the pair on the line it reports. When
the deployment is older, it names each thing the deployment lacks that the push
uses: before API 2, a push uploads every image it has rather than naming the
ones already there, and that looks like a slow network until the version check
shows otherwise. When the deployment is newer, it prints that this CLI is the
older half. When the project's `share` is an `http` share under the deployment's
endpoint, `push` also names a deployment older than API 3, because such a
deployment answers 404 under `/share/`. `variance --version` prints this tool
alone.

While it works, `push` writes its phase to stderr: one line rewritten in place
on a terminal, one line per phase in a log, and a clock on both, so the wait
between the last file read and the first byte acknowledged is legible rather
than silent. Calling `push` from your own code, the same events arrive through
`onProgress`, and `formatPush` renders the result the command prints.

### Changelog: explain a baseline update

A baseline update's report records what the new baseline is, not what the change
was. `accept` can write that explanation into the thing that survives — a
commit:

```bash
variance accept --all --message-file .variance/commit-message.txt
git add -- .variance/baselines
git commit -F .variance/commit-message.txt
```

`--message-file` writes a commit message: prose a reviewer reads in `git log`,
and opaque versioned trailers a parser reads back. `--message` sets the subject
line and defaults to `chore(variance): regenerate baselines`. Nothing is
committed here — committing, to which branch and as whom, is left to the
calling workflow; `accept` only ever promotes images the run itself produced.

Reading it back:

```bash
variance changelog --component Card --limit 50
```

```
a1b2c3d4e5f6  2026-08-21T10:14:02+10:00  run 4242 @ 9f8e7d6c5b4a --shape
  tighten the card
  v1:2c4f9a1e0b7d3856a91c4e2f8b06d735 Card src/Card.tsx 11/14
```

A change line leads with the fingerprint because that string is what
`accept --shape` takes; `11/14` is promoted-of-reached, and a bare number means
the shape reached exactly those. `Card src/Card.tsx` is where the shape was
attributed, and reads `unattributed` when the run could not name a component —
the promotion is no less real; it just cannot be pinned to one source. The line
under the commit is that run's `--intent`, which is why a run started without
one prints no such line.

`--subject` narrows to one subject id, `--since <rev>` reads forward from a tag
or a SHA, `--limit` caps how many commits are read.

Three failure modes are handled explicitly:

- **git missing, no repository, or an unresolvable revision** each exit `2`
  with a message, instead of printing an empty history that looks the same as
  "nothing has changed since the last baseline."
- **A shallow clone bounds what can be read.** CI checkouts at depth 1 see one
  commit; the output prints a `note:` saying what it could not see.
- **Stores whose baselines are not commits are refused by name.** Under
  `ephemeral` retention there is no baseline to explain; behind a `remote`
  store the explanation lives in that service's record instead, and this
  command reads only the log of a checkout.

### Journeys: which part of a module two subjects took differently

Every other reading here answers *which subject*. A recurrence count names a
subject that keeps changing, a second reading names a subject that disagrees
with itself, and none of them can show **where in the source** the two readings
parted, because none of them was inside the module while it ran.

A build instrumented with `testSelectionProbes()` from
`@variance-authority/sense/journal` was. It records which regions of which
modules each subject crossed while it was painted, and two subjects that render
one module and cover different regions of it have parted:

```bash
variance journeys --file CartCard
```

```
app/src/components/CartCard.tsx  3 observers
  parted     function CartCard/onClick  51-58
    entered  story:cart-card--removing
    missed   story:cart-card--item, story:cart-card--verbose
  unentered  branch CartCard/empty  62-64

pool: 3 observations the journal recorded whole, out of 3 subjects the report names

note: recorded at 4f2a1c9d0b73
```

`parted` is the finding; `unentered` is its weaker sibling — a region with source
of its own that nobody in the pool covered at all. `--file` narrows to modules
whose path contains a string, `--limit` caps how many modules are named, and
what a cap left out is counted, not dropped.

It exits `0` whatever it finds. Every suite with two stories per component has
partings, so gating on one would fail every suite; this is where to look once
something else has reported a change.

**The pool is printed whether or not anything was found**, for `changelog`'s
reason: an empty answer from a pool of one and an empty answer from a pool of
forty are opposite facts. The journal accumulates across runs, so the default
pool is the subjects the configured report names — this run's question, about
this run's subjects. `--all` reads the accumulated record on purpose, and a
checkout with no report to read gets that record *with a sentence saying so*,
because a pool nobody chose must not print as one somebody did.

Three more ways the pool is not what it looks like. Each is named rather than
left to be inferred:

- An observation recorded incomplete is dropped from the pool and noted, rather
  than counted as a subject that agreed.
- A named subject the journal never recorded is listed by name, because this
  run observed nothing that would settle it either way.
- A pool of fewer than two observations is printed as such. A parting is a
  disagreement between two observers, and a single observer has not found
  nothing — it has not been able to look.

With no journal at all the answer is *nothing*, not *nothing found*: the command
names the file it looked for and what writes one.

### HTML report

```bash
variance report --format html > out/report.html
```

Write the HTML beside `report.json` and include both files and the accompanying
image directory in the CI artifact. This portable report directory needs no
report server or account.

It renders the same docket the pull-request body does: one entry per root
cause, grouping every subject that cause reached, instead of one entry per
subject. Causes come first, with `file:line`, and their collateral is counted
and not listed. Each card shows the subject id in its heading, the changed
region with its component and `file:line`, and the commands for that id already
filled in, to copy out:

```
variance accept checkout/empty
variance report --subject checkout/empty
```

A pixel-diff **region** — a bounding box of changed pixels — that the semantic
tier could not attribute to a component is marked *largest region, not a named
cause*, so it is never read as an explanation. Coverage failures, meaning
subjects the run could not observe at all, sit above the **findings**, so the
page cannot look complete when it is not.

**Image paths are relative to the JSON report.** Keep the HTML beside it and
preserve the image directory layout when copying or uploading the artifact.
Scripts and styles are inline, fonts use local system fallbacks, and images
remain separate files.
`--subject` is refused for HTML so the page retains the whole run's coverage
accounting.

When the page will be opened somewhere its images are not, add
`--embed-images` and it carries every picture inside it:

```bash
variance report --format html --embed-images > variance-report.html
```

One file then opens anywhere, including a phone. On GitHub Actions, upload it
with `actions/upload-artifact@v7` and `archive: false`, and the artifact link
opens the page in the browser instead of downloading a zip. The file grows
with the images: a subject with a baseline and a change carries three
pictures.

### Detect instability with `run --flakes`

Every run reads a *changed* subject a second time before believing its verdict.
`--flakes` reads **every** subject twice, whatever the verdict, which is a
different question: not *is this change real* but *which of these subjects would
flake tomorrow*.

```bash
variance run --flakes
```

A subject that agrees with its baseline and disagrees with itself is a flake one
run before anybody has to look at a red build, and no verdict shows it — a green
suite settles on its digests and never builds a comparison at all. The answer
names the component, the file and the **band** — one of five categories (`a11y`,
`geometry`, `token`, `content`, `texture`) a change is classified into by what
kind of thing changed:

```
[unstable] story:case-surface--ticking: … Clock src/ds.jsx:118 read differently
  (geometry, token, content)
```

It costs one collection per subject and never a render, so a sweep of 300
subjects is 300 cheap collections — the shape that pays for itself nightly rather
than on every pull request. The `alone.limit` budget does not apply: an operator
who asked about the suite must not be handed the first twenty subjects under a
whole-suite heading. `alone.limit: 0` still turns it off, because one number
cannot mean *do not re-collect anything* on Tuesday and something else on
Wednesday.

Unstable subjects exit **1** even when every verdict is green — a sweep that
found six and exited 0 would have given CI nothing it could act on.

Stability is demanded only inside the boundary a subject declares. A
**sensitivity level** names the set of bands a subject is actually asserted on —
`strict` (every band, the default), `layout` (`a11y` and `geometry` only), or
`content` (`a11y` and `content` only). A route with `sensitivity.level: layout`
declares that it does not assert on what the page is painted with, so a clock
ticking inside it is listed under *not asserted on*, does not gate, and is not
refused by `accept`. `strict` absorbs nothing.

### Reporting without gating

`--exit-zero-on-changes` turns exit 1 into exit 0 on `run` and `report`, for a
job that reports instead of blocking the merge — which is how most of this
category is actually run.

The reason it is a flag and not a line of shell: `|| true` swallows exit **2** as
well. A job whose browser never launched observed nothing and therefore found
nothing, and `|| true` posts a green tick over it. This suppresses exit 1 only,
leaves operator errors at 2, and writes one line to stderr saying the code was
suppressed — a run whose exit was quietly rewritten is otherwise indistinguishable
in a log from a run that found nothing.

### Exit 2 from your own collector

Exit `2` means the run did not happen as configured; anything else that escapes
is reported as a defect in this tool, with a stack trace, because telling
somebody to go and edit a config that was never wrong costs them an afternoon.

A collector is loaded from your `node_modules`, not this package's, so it cannot
be recognised by its error's class — two installed copies of the same class are
not the same class. It is recognised by a property instead:

```js
throw Object.assign(new Error('this collector needs `subjects.kind: "list"`'), {
  varianceOperatorError: true,
});
```

That is the entire integration, and it is worth doing: without it the adopter
sees a mistyped path in your own collector as a stack trace claiming this tool
is broken. Leave the marker off anything they cannot act on — a bug in the
collector should still read as a bug.

### Finalize and stitch journey coverage

A Jest run configured with `withJourneyCoverage` leaves its journals beside the
artifact path. Finalize them after Jest exits, so Jest reports the test result
before the native fold uses CPU and memory:

```bash
variance journeys finalize .variance-authority/journeys.bin
```

The command needs no `variance.config.json`. It removes the `.pending`
directory only after the artifact has been written, so a failed finalization can
be retried.

Give each CI shard a different output path and upload each finalized file. After
downloading them, stitch the shard artifacts without expanding their crossing
relations in JavaScript:

```bash
variance journeys stitch \
  shard-0.bin shard-1.bin shard-2.bin \
  --into journeys.bin
```

### Sharding: `journeys` takes more than one file too

The execution journal shards the same way the report does. A suite split
across CI jobs records one snapshot per job — each runner's seam takes a
`coverageFile`, and the job uploads it as an artifact — and every question
anybody asks is about the suite. Name them all and `journeys` folds them into
one snapshot, lands it, and reads it:

```bash
variance journeys shard-1/coverage.bin shard-2/coverage.bin shard-3/coverage.bin
```

```
folded 3 snapshots into <cache>/test-selection/1f3a…/coverage.bin
  342 observations over 1204 modules, recorded at 4f2a1c9d0b73
  cases of 3 snapshots laid over <cache>/test-selection/1f3a…/coverage.bin

app/src/components/CartCard.tsx  3 observers
  …
```

The fold refuses shards that were not one run, naming both files: recorded under
different probe recipes, or at different commits — and a shard recorded outside
a checkout names no commit, which is a disagreement rather than a blank. A test
file two shards both recorded means the split overlapped, which only the
operator can resolve. A module one shard could not instrument is answered by the
shards that did: that row records that one build could not read the module, and
is no evidence about the tests another build watched run it.

Where it lands is this checkout's own cache, the file every run on this
machine layers over — the record of the suite `--suite` names, when the root
config declares suites — unless `--into <path>` names somewhere else — a job that
folds and uploads names the artifact it uploads. Landing is a layer, not a
replacement: what was already there is merged under the fold, so the result
stands at the fold's commit, retires every observation the fold re-recorded
whole, and keeps the ones it did not.

The case index lands with the snapshot, because it is part of it: a seam that
records cases writes them into the record, so each shard's one file carries
them. `journeys` lays each shard's cases over the landed record's, replacing the
cases of every test file that shard ran to the end, in the same write as the
coverage, and `covering`, `coverage` and `review` answer from the result. If you
land a shard that ran a test file to the end and kept no cases, the landing
drops the index, because no index can hold which of that file's cases run a
line. Those commands then print that nothing is recorded until a run writes one.
A shard keeps no cases when its seam recorded none. If another run is writing
the record when you land, nothing is written and `journeys` exits non-zero; land
again once that run ends.

That is the whole of the recipe for a laptop:

```bash
base=$(git merge-base origin/main HEAD)
# fetch the snapshot your CI folded and uploaded for $base, however it stores artifacts
variance journeys ./coverage-$base.bin
```

The full suite on the default branch records the floor; each local run layers
its own evidence on top; and a selection made against the result is measured
from the commit the fold named, which is what `variance run --since` and the
journal both read.

### `index`: publish the file graph once

`select`, `reach`, `covering --since` and `run --since` all answer from the
import graph of your checkout. None of them scans for it. They read the
[source index](https://variance-authority.dev/docs/source-index), and `variance index` is the one
command that writes it:

```bash
variance index
variance select --format vitest
```

```
source index updated: 2215 files, 0 read again, at <cache>/test-selection/<digest>/source-index.bin
code map: 71 packages in 16 areas, 2 deep, over 8 dependency layers
journeys, suite unit: 5718 cases walked; a caller is found for 216327 of the 253543 functions they ran (85%); 8895 calls, 204 package flows; 2 imports the index did not resolve were resolved by the walk
dependency lexicon: 213 workspace-dependency pairs, 309 public entrypoints, 213 reused, 167 unavailable, at <cache>/test-selection/<digest>/dependency-lexicon.json
questions: published at <cache>/test-selection/<digest>/source-index.bin.help.json
```

It scans the whole checkout, rebuilds only the records of files whose bytes
changed, and appends them as a new layer, so one run costs the size of your diff
and not the size of your repository. The readers answer from what it last
published, so run it after the checkout changes and before them. The second
line describes the code map it writes beside the index, which
`variance ask orient` prints a page at a time. An unchanged index and unchanged
manifests keep the map that is there. A checkout with no packages to put on it
prints `code map: none, because …` with the reason, and a map that could not be
written prints `code map: not prepared: …`; in both cases the index is
published. Each line after those two describes one suite's journeys, which it walks from that suite's latest
recording and writes beside the index, and which `variance ask orient --files`
reads for the calls into and out of a file and the
[package flows](https://variance-authority.dev/docs/orientation#choose-the-entrance-from-what-you-have)
its tests take. A checkout with no declared suites prints one `journeys:` line.
A suite with no recording prints `not prepared: nothing is recorded at …`. The
last two lines are what `variance ask` answers from, and each prints why when it
could not be written. An index the file system refuses
to write prints `source index not written: <reason>, at <path>` and exits `2`.

On your machine the command returns once the index is written. The code map,
the journeys and the last two lines are made by a process it starts for them,
and a `follow-ups:` line names that process and the file its lines go to. The
next `variance` command that reads any of them waits for it, and prints that on
stderr, so no answer comes from a map older than the index. `variance select`
reads none of them, and waits only while the process brings the index up to
date and folds its working layer into its base, which it does before the four. A process that ended before it
finished is not waited on: the next command that reads them makes them itself
and prints their lines. `--wait` makes them before `index` returns, which is what it
always does in CI. `--follow-ups` is what the started process runs.

In CI, run it as its own step after you restore the cache. A reader that finds
nothing published there exits `2` and names the missing step, because an index
built quietly by the reader would hide a cache that never arrived. On your own
machine a reader that finds nothing builds the index once and prints that on
stderr.

`--no-git` reads every file's contents from the working tree rather than from
Git's object store. Git still lists the files and names each blob, so the index
is the same one either way. Use it for a partial clone or an object store on a
network filesystem. `select` and `reach` take the flag for the build they make
on your machine when nothing is published.

No `variance.config.json` is read.

### `select`: what your own runner may skip

`variance run --since` narrows the subjects this tool renders. `variance select`
answers the same journal for a suite this tool does not run — `vitest`, `jest`,
or any runner a shell script hands paths to — by naming the test files that diff
cannot reach:

```bash
vitest run $(variance select --format vitest)
jest $(variance select --format jest)
```

The journal is what [`@variance-authority/sense`](../sense/README.md) wrote the
last time that suite ran: its seams record Vitest, Jest and Rstest, and
[`@variance-authority/sense/runner`](../sense/README.md#record-a-runner-this-package-has-no-seam-for)
records any other runner.

When the root `variance.config.json` declares
[suites](https://variance-authority.dev/docs/execution-record#one-record-for-each-suite),
each suite records on its own, and `select` reads one of them: the one
`--suite <name>` names, or the only one declared. With more than one declared
and no `--suite`, it stops and lists them. `variance run --since` and
`variance journeys` read the same way.

When your checkout has not recorded the suite, as in a fresh clone, `select`
reads the record your mainline published, if the root config gives that suite
to the [share](https://variance-authority.dev/docs/sharing) with `"carry": "share"`. The record is
kept in [the cache](https://variance-authority.dev/docs/cache), never where the suite records, and
stderr names which of the two `select` read:

```text
record of "unit": read from mainline main, published at 51ab09e…, 3 commit(s) behind the merge base with this checkout; kept at <cache>/share/read/unit/51ab09e…/coverage.bin.
```

Once the suite runs in your checkout, its own recording is read instead. The
record a branch published to the share, on its `branch/<name>` line, is never
read: only a mainline's is. When the mainline's record cannot be read either,
stderr names what the share answered, and `select` skips nothing.

It prints a **skip** list, never a run list, and that is the whole of its safety.
A run list has to be complete to be correct, and this journal is never
complete: it records the tests that finished whole, at one commit, in one
recipe. A skip list that comes back empty runs your suite. A run list that came
back empty would run nothing, and the suite would go green in seconds.

So stdout gets paths and nothing else, and every sentence about the reading
goes to stderr, where a `$(...)` cannot pick it up and hand it to a runner as a
path. `--format plain` writes one path per line, relative to the repository;
`vitest` writes two `--exclude=` arguments for each file: its path from the
directory `select` runs in, which every vitest matches in a project rooted there,
and its absolute path, which vitest 3 and later match in every project of a
workspace. Run `select` where vitest runs, and when your config moves `root` or
`test.dir`, from that directory:
`vitest run $(cd packages/app && variance select --format vitest)`. `jest` writes
`--testPathIgnorePatterns=` arguments and re-states jest's `/node_modules/`
default, which that flag would otherwise replace. `--format json` reports the
counts and the widening reason together for a program that decides for
itself.

A failure near the change comes back sooner when the nearest tests run first.
`--at-distance <hops>` cuts the selection to one leg, the selected test files
that many imports from the change, and adds the rest to the skip list. Run
`0-2`, then `3-`, and every selected file runs in one of the two:

```bash
vitest run $(variance select --at-distance 0-2 --format vitest)
vitest run $(variance select --at-distance 3- --format vitest)
```

A leg is still a skip list. A selection that declines to narrow skips nothing
in any leg, and a test the change did not enter and the record never saw whole
(new, or recorded incomplete) runs in both. A test the change entered by no
import it executed has no hop count and runs in the furthest leg. stderr counts
the entered tests at each hop count, and names how many selected files the leg
left and the command that runs them. `--format json` gives the leg as `leg`,
those files as `left`, and each entered test's `hops`, `bearing` and, where no
distance was measured, `because`, as `distances`.

It declines to narrow, out loud on stderr and with an empty stdout, whenever the
journal holds no answer: nothing recorded on this machine, a diff git would not
produce, a lockfile that cannot be compared at the diff's base, or a journal
with no whole observation in it.

A changed file the journal records nothing about is not one of those. Prose, a
workflow, or a fixture your tests read with `fs` keeps no test in the run, and
stderr names it beside the answer, as `json` does under `unread`:

```
$ variance select
skipping 212 of 240 test files recorded whole: none covered a changed line;
every other test file runs.
the journal records nothing about 1 changed file (fixtures/cart.json), so it
keeps no test in the run; a file the suite reads without importing it is
declared as a precondition.
```

When a test does read that fixture, name it in the `preconditions` option of the
Vitest recorder in `@variance-authority/sense`: from the next recording on, a
change to it selects every test it governs.

Each changed source file also gets a line on stderr saying how the parser read
it, or why it could not, and `json` lists the same readings under `readings`.
`variance run --since` adds the same lines to the run's warnings:

```
read src/limits.ts: values (LIMIT) — the readers of the changed values and the changed regions are charged
unseen test/fill.test.ts: loaded src/limits.ts by an import the file graph does not list; named, not selected
read src/cart.ts: unread (the diff does not apply to the recorded text) — its changed lines are charged
```

An `unseen` test loaded the file through an import the file graph is missing.
It is named rather than selected, because the missing edge is what you fix.

The journal's own commit is what the diff is measured from, because its line
numbers are coordinates in that commit's text. `--since <ref>` names a base only
for a journal recorded outside a checkout, which names no commit of its own.
No `variance.config.json` is read, so a repository that uses this tool for
nothing else can still ask.

#### Selecting from a journey file

A journey file from [`journeys finalize` or `journeys stitch`](#finalize-and-stitch-journey-coverage)
records which cases entered which function, so it can skip a test that imports
a changed file but never ran the changed branch. It names no commit, so you
hand it the change:

```bash
git diff origin/main | variance select --execution journeys.bin --diff - --format jest
variance select --execution journeys.bin --diff change.patch
```

Without `--diff`, the change is `git diff` against `--since`, or `HEAD` when you
give no ref. The change does not have to come from git history: a replayed
commit, a synthetic patch and an edit nobody committed are read the same way.
Run it from the repository root, because the file names paths relative to it.

The change has to be a patch, because a journey file selects by changed lines.
A list of paths from `git diff --name-only` is refused: it can only be answered
by the import graph, and that is [`reach`](#reach-what-a-diff-reaches-for-a-pipe).

- **A changed line.** It goes to the innermost function holding it, and only the
  test files whose cases entered that function run.
- **A file the patch names and shows none of**, such as a binary or a rename, or a
  file the journey has no row for. Every test file that imports it runs, read off
  the import graph, together with every case the journey saw enter it.
- **A line in code that runs while its module loads.** The journey saw every
  importer run it, so the import graph answers it as a whole file.
- **A changed lockfile.** It is compared as an install, not as text. The patch's
  `index` line names both versions of the file, git produces them, and every
  package that resolved differently is walked back through the packages that
  depend on it to the files that import them. Every test file those imports
  reach runs, and so does every case the journey saw enter one of those files.
  A lockfile the patch changes without naming its blobs keeps every test.

A changed test file runs itself. A mock is installed before the file's first
case, so what a case crossed ran for real and selects it even in a module its
file mocks; only what the module did while it was evaluated is cut by the mock.
A path neither the journey nor the import graph has keeps no
test in the run and is named on stderr. The whole reading happens in the native
addon, so a stitched file with hundreds of millions of crossings is answered in
milliseconds without expanding it in JavaScript.

### `reach`: what a diff reaches, for a pipe

`select` answers a journal about a suite this tool recorded. `reach` answers the
import graph about a checkout it has never run anything in, and its languages are
JavaScript, TypeScript, Python, Rust, Java, Kotlin and Swift. It prints the files
a diff reaches, one per line, and it is meant to be piped:

```bash
variance reach --since origin/main | grep '_test\.py$' | xargs pytest
variance reach --since origin/main | grep '\.rs$' | xargs -r cargo check --
```

What counts as a test, and how your runner takes a list of them, stays in your
shell — where it is already written, in a form matching the repository you have.

An import over-approximates: `import x` means this file *may* depend on that one,
so the list is a superset of everything affected. That is what makes the graph
alone enough to answer from with nothing recorded, and it is the same direction
of error every narrowing in this tool is allowed.

This one prints a **run** list, which is the dangerous shape, so it has no short
answer at all. Either stdout lists every file the diff reaches — every changed
file that runs differently among them — or the command writes nothing to stdout
and exits `2`. It refuses when the diff is empty, when a changed file in a
language it reads is not in the graph, when no changed file is in the graph, and
when every changed file runs what it ran before:

```
$ variance reach --since origin/main
none of the 2 changed files is in the file graph, so this diff says nothing about
what it reaches. Rather than print a file list this cannot stand behind, `reach`
stops here: a short list piped into a runner is a green build over a change
nobody read.
```

Changed paths in no language it reads — a lockfile, a workflow, a Dockerfile —
are left out of the walk and named on stderr, so you can see the part of your
diff the answer is not about. So is a JavaScript or TypeScript file whose edit
was a comment, a type or formatting: it is read from both texts, runs what it
ran before, and reaches nothing. A JSX pragma and a type in a decorated class
are not that kind of edit, because the compiler writes both into what runs. A
file whose edit changed only some of its exports is walked from those exports:
a file that imports `label` from it is left out when only `total` changed, and
stderr names `total`.
[How different languages are handled](https://variance-authority.dev/docs/polyglot#walked-from-what-the-edit-changed)
says where the walk stays whole. Everything else a person needs goes there too,
including how many files were reached from how many. `--format json` gives
the same facts for a program that decides for itself.

`--whole-files` walks from every changed file whole without reading the edit,
which is the list a file-by-file import graph gives. It is never shorter than
the default list, so running both shows what the reading left out.

No `variance.config.json` is read, and there is no default for `--since`: without
a ref there is no diff, and the honest answer would be every file in the
checkout.

### Sharding: `report` takes more than one file

A suite big enough to split across CI jobs runs `variance run --shard k/n` once
per job:

```bash
variance run --shard 1/3    # and 2/3, 3/3 in the other two jobs
```

Every job computes the same split without talking to the others, and the split
follows three rules:

- **A file goes to one shard whole.** Every story one CSF file declares, and
  every width of one route, are observed by the same job. They import the same
  modules, so two jobs would each pay to load them.
- **Recorded cost decides first.** Each observation in a report records
  `costMs`, the time from its collection to its verdict, and `declaredIn`, the
  file that declares its subject. The run reads the costs
  your mainline's line holds, `subject-costs-v1`, and places
  the longest files first, each on the shard with the least work so far. A
  subject with no recorded cost is priced at the median of the ones that have
  one.
- **A checksum decides when nothing was recorded.** Each file goes to the shard
  with the highest `sha256` of the file and the shard number, so adding a file
  moves no other one.

The shard that finishes last is the file `variance ask costs` lists first: it
prints the slowest files with their summed time, then the slowest subjects, from
the same line the split reads.

A shard keeps neither the suite index nor the costs, since each counts part of
the suite. It writes its part of the index beside its report
(`report.suite-part.json` next to `report.json`). Name every shard's report to
`share --publish` in the job that merges them, and it composes the index one
run over the whole suite would have written and publishes it, with the costs,
under the commit the shards share:

```bash
variance share --publish shard-1/report.json shard-2/report.json shard-3/report.json
```

It publishes nothing when a report has no part beside it or a shard is missing,
and names which. An unsharded run publishes its own index and needs no merge.

The lookup is the same one the [suite index](https://variance-authority.dev/docs/sharing#looking-up-mainlines-record)
uses, and every shard of one build reads the same line, so they place alike. A
checkout with no share, or a line that holds no costs, places by checksum.

`--subjects <glob>` is the other way to split, when you want to choose the
slices yourself.

Either way each job ends with one report. Name them all and `report` answers
about the suite, not about a slice — one exit code, one body for `comment`:

```bash
variance report shard-1.json shard-2.json shard-3.json
```

`comment` takes them the same way, so the pull request gets one body rather than
one per job:

```bash
variance comment --body-file body.md shard-1.json shard-2.json shard-3.json
```

Naming report files replaces the configured one; it does not merge into it.

The merge refuses shards whose renderer identity, retention, or `--intent`
(the free-text label recorded for what a run was meant to do) differ, naming
both files — those were not one run. Two shards observing the same subject
means the slices overlapped, which only the operator can resolve.

What it does accept is the arithmetic nobody wants to do by hand. Each shard
records every subject outside its slice as `excluded`, so three shards report
each subject as excluded twice and observed once; the merge resolves those
against what was actually observed. **A subject that every shard left to another
is promoted to `failed` and turns the merged run red** — each shard exits `0`
because each ran exactly its slice, and the merge is what finds that the
suite is missing a component. With `--shard`, an exclusion names the shard that
owns the subject and what placed it there, so two jobs that read different costs
show it in their reports.

`comment` renders the same report as a pull-request body. The first screen holds
the count, the leading cause, the report link and how to accept, plus any
warning that changes whether the images can be trusted. Every cause, the
collateral count, what was skipped and what painted the images sit under one
fold. It renders **nothing when the check is green** — an empty body, because a
bot that comments on every clean pull request teaches the team to filter it out,
and the filter does not distinguish the clean ones. It writes to `--body-file`
when given one and to stdout otherwise, and it posts nothing itself. `--marker`
prints the HTML comment the poster searches for to find and rewrite its own
previous docket; it is printed by a separate flag because it is needed in
exactly the case where there is no body to read it out of. Exit `0` means *this
rendered*, never *the run was clean* — the verdict belongs to `run`, which
already decided it.

`--intent <text>` declares what the change was *meant* to do, overriding the
config's `intent`. **It is a label, and it changes no verdict.** The string is
recorded in the report and printed by the summary, the docket, the HTML page and
the MCP tools, so a reader knows what the run was for; nothing reads it back.

`adjudicate` is where a declaration is read back. It takes claims as a file
rather than a flag because a claim is a root, a reason and a bound, and
`--intent "tighten the card"` is a sentence:

```bash
variance adjudicate --claims claims.json
```

```jsonc
{ "claims": [
  { "root": "component:Button", "reason": "new brand accent", "maxSubjects": 3 },
  { "root": "component:Card", "reason": "tighten the gap above the action" }
] }
```

A `root` is `component:<name>`, or `shape:<fingerprint>` when the run resolved
no component and grouped the change by its shape alone — which is what the
unclaimed lines below print, and what a suite with no source attribution has to
claim by. A bare name is read as a component; any other prefix is read as part
of the component's name, so a misspelt one comes back as a component that never
rendered, not as an error.

It answers three things: what you declared and delivered; what moved that you
did not declare; and **what you declared that did not happen** — `Card`
rendered in two subjects and changed nothing, which means a wrong file, a dead
branch, an overridden rule, or a stale build. That third answer is distinct
from `Card` never rendering at all, which the run's own subject count already
shows and is not evidence of anything on its own.

Declare before reading the diff — claims copied out of a report score the run
against itself; the tool does not stop you, but nothing is gained by it.
Over-claiming is not an escape either: a claim reaching more subjects than it
declared comes back `overreached`. It changes no verdict and no exit code; it
reports on the run `run` already judged. `variance serve` exposes the same
check to an agent as `variance_adjudicate`.

Those commands cover capture, inspection, approval and delivery. `push` uploads
a finished run and its images to the configured review endpoint using the
operator's ingest token. `comment` generates a comment body and posts nothing;
posting it is the platform integration's half. The exit code and report are what
a CI job gates on.

## Exit codes

```
0  nothing needs review
1  changes need review
2  operator error
```

**A verdict and a crash never share a code.** A red build that could mean either
"a component changed" or "the store did not answer" is a red build nobody
investigates, and the second case is the one where continuing destroys a
baseline. `variance doctor` exists so the second is diagnosable before a run
rather than after one.

## Use as a library

Everything the `bin` does is exported as an ordinary function. A custom host can
therefore load configuration, select its own collector, renderer and store,
write the same report, and use the same exit-code contract without spawning the
executable.

```ts
import {
  EXIT_REVIEW,
  collectorPath,
  exitFor,
  loadCollector,
  loadConfig,
  rendererFor,
  run,
  storeFor,
  writeArtifactToDisk,
  writeCliRunReport,
} from '@variance-authority/cli';

const config = await loadConfig('variance.config.json');

const report = await run({
  config,
  // Everything the run touches, handed to it. This is what the `bin` assembles.
  deps: {
    collector: await loadCollector(collectorPath(config.subjects), { config }),
    store: await storeFor(config),
    // `rendererFor`, not `createPlaywrightRenderer`: it is the one expression that
    // reads `browser` and `renderer` out of the config, so a composition cannot
    // quietly launch a local Chromium for a run configured to paint elsewhere.
    renderer: () => rendererFor(config),
    now: () => new Date().toISOString(),
    writeArtifact: writeArtifactToDisk,
    writeReport: writeCliRunReport,
  },
});

const code = exitFor(report);
if (code === EXIT_REVIEW) console.log('changes need review');
process.exitCode = code;
```

`deps` owns every integration seam: `Collector`, `RunDeps`, `CandidateReader`,
`DoctorProbes`, and the `now` clock used for report timestamps. Supply only the
hosts the integration owns; the workflow remains independent of a global
browser, store, or wall clock.

### Library option boundaries

The executable assembles these objects for you. Import them when an integration
owns its own collector, renderer, storage, or review surface:

- `run` receives a `config` plus injected dependencies. Its `flakes` flag turns
  on the whole-suite stability sweep; `identity` records a run in the optional
  history store; and library `since` is the already-computed `{ changed, ref }`
  selection that the executable's `--since` flag derives from Git. A missing
  `identity` or `since` means that concern is not requested, not that the run
  guessed one.
- `run` also takes `against`, which is a different question from `since`:
  `since` narrows *which subjects render*, and `against` leaves the plan alone
  and reads *what the commit reaches* — the diff against that ref, walked
  through the import graph to the components each subject renders. A changed
  subject the commit does not reach is the strongest finding a report can hold,
  and it is unavailable to anything that only compares images.
- `run` also takes `index`, which narrows nothing. It is where the recorded
  execution index stands — the commit it was written at and how many files the
  working tree differs from it by — and it travels into the report so a reader
  can see what `--since` would have cost on this run. `narrowingFor` resolves
  `since`, `against` and `index` together from the refs a caller was given.
- `run` takes `shard` as `{ index, total }`, the library form of `--shard k/n`,
  and `costs` as `{ commit, costs }`, the subject costs that place files on
  shards and order each worker's queue longest first. The executable reads
  `costs` from the share; without them a checksum places each file.
- `formatReport` takes a `format` of `text`, `json`, or `html`. `subject` narrows
  text or JSON to one id and is refused for HTML because a narrowed page would
  hide coverage. Use the CLI's `report` command when the report must be loaded
  from disk first.
- `accept` receives the report directory as `reportDir`, the baseline `store`,
  and a candidate `read` function. `all` promotes every changed candidate;
  explicit subjects are safer. `shapes` selects a fingerprint only when it is
  the whole change. `project` scopes optional history rows; omit it when no
  history store is supplied.
- `renderComment` accepts `runUrl` when the published artifact has a reviewable
  location, `toAccept` for how a reviewer accepts in your repository,
  `imageRoot` for where the report's images are published, and `limits` when a
  caller needs smaller docket bounds. Limits merge
  over `DEFAULT_LIMITS`; the renderer still states what it omitted.
- `suiteBase(root, { suite, cacheRoot, env })` answers which execution record a
  runner of your own measures a change from: the checkout's own, else the
  `suite-v1/<suite>` your mainline published to the share, or the one fetched on
  this machine earlier when the remote does not answer, else, in a worktree that
  has recorded nothing, the primary checkout's. The last is an offline fallback,
  and the answer has a `missed` field with the reason the mainline's was not
  read. `mainlineRead` and `mainlineMissed` print the same `record of
  "<suite>":` line `select` does. The mainline's record is read with the runs
  record the publishing run carried beside it, at `mainline.runs`. In a fresh CI
  checkout, `layMainline` copies the record and its per-case index into the
  checkout's own layer, with that runs record as a seed that lists no run, so
  the run the job makes lands on them, as a cache restore would. `env` stands in
  for `process.env` when the line is read, and `cacheRoot` for the cache.
- The executable's `config` path selects the source; `parseConfig` takes that
  value and `baseDir` through `ParseOptions`. Relative paths resolve against
  `baseDir`, not the process working directory, so a library caller can load
  the same file from any invocation directory.

## Run order

1. **Collect** — subjects from a list or from a Storybook index.
2. **Settle what the cheap tiers can settle.** A subject whose document digests
   to what the baseline was painted from cannot differ, and is answered by 32 hex
   characters, not by an image.
3. **Render only the residue.**
4. **Write a report that accounts for every subject** — including the ones it did
   not observe.

That last one is the failure this whole system exists to make impossible. A
summary that prints "nothing to review" because eleven subjects failed to render
is worse than no summary at all.

## Acceptance does not produce an image

It promotes one the run already produced. A command that could re-render on
acceptance is a command that can record something nobody looked at.

## Configuration

A file the operator wrote. Nothing is inferred from the network and nothing is
downloaded, so the run's inputs are the ones in the repository.

`$schema` is the one key that configures nothing. It points at
`schema/variance.config.schema.json`, shipped in this package, which describes
every key a config may contain, the values each one accepts and what it decides.
An editor reads it for completion and an in-place refusal; an agent reading the
repository gets the same answers without running anything. The parser accepts the
line and ignores its value, so a wrong path costs completion and never a run.

```jsonc
// variance.config.json
{
  "$schema": "./node_modules/@variance-authority/cli/schema/variance.config.schema.json",
  "project": "todomvc",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": {
    "kind": "storybook",
    "index": "storybook-static/index.json",
    "collector": "variance/collector.mjs"
  },
  "baselines": { "kind": "directory", "root": "baselines" },
  "fonts": ["Inter/400/normal/sha256-abc"],

  // Where components are declared, which is what `--since` narrows against.
  // `relations` reads what imports what, so a changed stylesheet reaches the
  // components that rest on it instead of running everything; `changes` borrows
  // a monorepo tool's answer across a package boundary the scan cannot map
  // back to source.
  "source": {
    "dirs": ["src"],
    "relations": true,
    "unrendered": "whole",
    "changes": { "tool": "turbo", "task": "build" },
    "taints": ["variance.taint.json"]
  },

  "browser": "chromium",
  "report": "out/report.json",

  // What is not the subject. Every rule needs an id and a reason, and every rule
  // must name a `select` or a `fingerprints` — a rule scoped only by band would
  // be a tolerance.
  "ignore": [
    { "id": "clock", "reason": "renders wall time", "select": "header time" }
  ]
}
```

`subjects` is one of three kinds. `{ kind: "list", ids, collector }` and
`{ kind: "storybook", index, collector }` name the subjects up front — **both
need a collector**, and for Storybook that collector is the module in
[step 1](#1-write-the-collector-module). For anything else, neither a list of
ids nor a story index defines how to mount, and the mounting half is code you
write. `{ kind: "collector", collector }`
is the third: the collector discovers the subject list itself, which is what a
`sitemap` or a `directory` route collector needs, and the trade is the operator's
— a page that stops being discovered stops being watched with no diff to approve,
and is reported after the fact as a baseline the run found and did not plan. `baselines` is
`directory`, `lfs` or `remote`.

`source` is the only thing `--since` can narrow against, and it is five settings
in one. `dirs` names where components are declared *and* declares the scope: a
changed file inside it that reaches no component forces a whole run, a changed
file outside it was never claimed to affect a render. `relations: true` reads
what imports what, so `tokens.css` is answered by walking to the components that
rest on it instead of running the suite — it costs one scan of the tree, which
is cached by content and by tree shape and so is paid once. The graph reads the
mocks as it goes: a test that calls `vi.mock('./api')` is not reached by a
change to `api.ts`, at any depth, because its run never covers that module.
`taints` names JSON tables that list what else a file imports beyond, or short
of, its text — a framework's own import notation, a module loaded under a name
the code never writes — keyed by file with `-` and `+` rows. The same graph
answers the execution journal for a changed file it has no row of: the importers
of that file, and theirs, until one the journal did record. `unrendered` answers
the case where the walk succeeds and lands nowhere: a change landing only on
components no baseline records narrows like any other, and the run names what it
could not match — either nothing here watches that surface, or something here
paints it without recording it, which a server component always does. Set it to
`"whole"` for the second, and the run observes everything instead. `changes`
runs `nx` or `turbo` to find what a diff affects and folds their answer in as
**more changed input**, never as a second opinion: it is the edge a specifier
scan cannot see when a workspace package imports its neighbour's built output
and no `tsconfig` names the source that output is emitted from. `turbo` needs a
`task`, because it filters a task graph rather than describing a workspace. If
the tool cannot be run, the run refuses — an empty project list is a legitimate
answer meaning *this diff crossed no package boundary*, and a failure that
produced it would skip every consumer of whatever changed.

`renderer` points the run at a machine that is not this one:
`{ "endpoint": "http://pinned-runner:7777" }`, served by `serveRenderer` from
`@variance-authority/remote`. It takes no token because
`serveRenderer` has no authentication — a field accepting a credential nobody
transmits would read as the endpoint being protected. It is refused together with
`browser`, since the engine belongs to whichever machine paints. `variance doctor`
reports a remote renderer as **not checked** rather than unavailable, and exits
clean: doctor makes no network calls, and an unasked question is not a failed one.

`ignore` is the one setting that makes a run *less* observant, so it is the one
with the most rules attached. Each entry excludes a subtree (`select`) or a
difference shape (`fingerprints`, copied out of a previous run's regions), may be
narrowed by `subjects` or by `tags`, and may set an `until` date after which it
stops absorbing. A subject whose only differences were absorbed reports
**`ignored`**, never `unchanged`, and every run prints a ledger naming the rules
that absorbed nothing — the two states that make a masked suite rot.

The remaining top-level keys:

| key | what it decides |
|---|---|
| `history` | the history service to call. Setting it is what makes `variance run` record observations and `variance accept` record approvals |
| `images` | what a run writes alongside its report |
| `blank` | replaces an image on the wire with a transparent one of the same intrinsic size |
| `sensitivity` | narrows a named subject to a sensitivity level |
| `decoder` | which PNG implementation to use |
| `concurrency` | how many subjects may be in flight at once |
| `workers` | how many browser worlds one run collects in. Each world collects one subject at a time; a world that finishes takes the next file from a shared queue, longest file first. A collector without `openWorker` collects in one world and the run warns |
| `intent` | the default `--intent` label |
| `suites` | each test suite the repository runs, and its kind: `unit`, `integration`, `e2e` or `visual`. Each suite records on its own. Read only from the file at the repository root, as the [execution record](https://variance-authority.dev/docs/execution-record#one-record-for-each-suite) page describes |
| `tiers` | line budgets, largest first, that `variance layers` places each package in by how much code it pulls in, and that a `maxTier` rule in a `.relations.json` names. Tier 0 is the first entry and has no limit. Read only from the file at the repository root; see [tiers](https://variance-authority.dev/docs/boundaries#tiers-say-how-much-code-a-package-pulls-in) |
| `alone.limit` | how many changed subjects a run re-collects in isolation to confirm the change reproduces — the same budget `run --flakes` ignores, above |

`history.token`, and `baselines.token` on a remote store, take either a literal
string or `{ "env": "NAME" }` naming the environment variable that supplies
it. A config file in a repository is the wrong place for a credential.

`browser` is `chromium` (the default), `firefox` or `webkit` — one engine per
run, because the engine is part of the identity a baseline is stored under, so
two engines produce two separate sets of baselines. Switching it is safe:
a run under a new engine finds nothing under its key and reports every subject
`new`, instead of diffing two engines and blaming a component for a font
stack. `retention: "ephemeral"` needs no baselines at all — both images are
produced by this run.

## Run it in CI

The exit code is the whole interface, so any CI that can run a command already
has the gate. On GitHub Actions that is one step:

```yaml
- run: npx playwright install --with-deps chromium
- run: npx variance run --config variance.config.json
```

`run` exits `0` when nothing needs review, `1` when it found something a person
must look at, and `2` when the run did not happen as configured. Do not grep the
output: the three integers are the contract, and a check whose colour depends on
a sentence changes meaning the day the wording improves.

### What the next job reads

A job ends and its machine goes away, and three things it wrote are what the
next job compares against: the baselines, each suite's recording, and the
report. The config names where each one is written, and its `carry` names who
moves it to the next machine:

- `actions-cache`: the host's cache, from one job to a later one in the same
  repository.
- `share`: `variance share --publish`, to the line a checkout on another
  machine reads back. [Sharing](https://variance-authority.dev/docs/sharing) says where a line lives
  and who may write it.

A file with no `carry` stays on the machine that wrote it.

```jsonc
// variance.config.json, beside the project
{
  "project": "todomvc",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": { "kind": "storybook", "index": "storybook-static/index.json", "collector": "variance/collector.mjs" },
  "baselines": { "kind": "directory", "root": ".variance/baselines", "carry": "actions-cache" },
  "report": { "path": ".variance/run.json", "carry": "share" },
  "share": { "kind": "git" }
}
```

Suites are declared in the `variance.config.json` at the repository root,
each with its own `carry`:
`"suites": { "unit": { "kind": "unit", "carry": "actions-cache" } }`.

`variance carry restore` and `variance carry save` print what `actions/cache`
takes: each file's paths, its key and, on a restore, the keys to fall back
to. With `--format github` the lines are step outputs, so the workflow names
no path the config already names:

```yaml
- id: carry
  run: npx variance carry restore --config variance.config.json --format github >> "$GITHUB_OUTPUT"
- if: steps.carry.outputs.baselines-key != ''
  uses: actions/cache/restore@v4
  with:
    path: ${{ steps.carry.outputs.baselines-path }}
    key: ${{ steps.carry.outputs.baselines-key }}
    restore-keys: ${{ steps.carry.outputs.baselines-restore-keys }}
- run: npx variance run --config variance.config.json
```

A suite with `"carry": "share"` gets no key: its record travels through
[`variance share`](https://variance-authority.dev/docs/sharing). Under
`--format github` those suites are printed as one line,
`shared-suites=<name> <name>`, separated by spaces, so a step loops over them
instead of naming them:

```yaml
- env:
    SHARED: ${{ steps.carry.outputs.shared-suites }}
  run: for suite in $SHARED; do npx variance share --suite "$suite"; done
```

A key is `variance-<file>:<branch>:<commit>`. The branch is the one a pull
request targets, so a pull request restores what its target saved and never
what it saved itself. A save appends the run id, because the Actions cache
never overwrites a key. A restore falls back to the newest key on the branch,
then to the newest key on each other mainline. So a pull request into a branch
that saves nothing, for example the base of a stacked pull request, restores
what a mainline saved.

Only a push to a mainline saves a recording. On any other run `carry save`
prints no key for it, and stderr names the reason. The mainlines are the first
of these that answers: the config's `share.mainlines`, the branch the remote's
`HEAD` names, the repository's default branch in the event. When none answers,
nothing is saved, and the message names the answers that were missing.

`carry` also prints `report`, `images` and `review`, which are paths to upload
and the directory to pass `variance review --out`. They have no key, because
an upload is not looked up again.

Posting the report back to the pull request is the one thing a command line
cannot do for itself. Read the report path out of your config and post it with
whichever commenting action you already use.

```yaml
# bitbucket-pipelines.yml
image: mcr.microsoft.com/playwright:v1.62.1-noble

pipelines:
  pull-requests:
    '**':
      - step:
          name: variance
          script:
            - corepack enable && yarn install --immutable
            - yarn build
            # The gate. Nothing parses this output; the exit code is the verdict,
            # and `set -e` is what turns 1 into a failed step.
            - yarn variance run --config variance.config.json --profile chromium
          after-script:
            # `after-script` runs whether or not the step passed, which is the
            # point: the run that failed is the run whose docket is worth posting.
            - yarn variance comment --config variance.config.json --body-file body.md
            - bash ./bitbucket-comment.sh body.md
          artifacts:
            - .variance/**
```

The poster is the platform-specific half, and it needs one thing from this CLI:

```bash
variance comment --marker
```

That prints the invisible marker the rendered body embeds, and nothing else.
Finding a previous comment by it and updating that comment — rather than adding
one per run — is the whole of the "one comment, updated in place" rule; on
Bitbucket that is a `GET` of
`/2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments`, a search for
the marker in `content.raw`, and a `PUT` to the one that has it or a `POST` if
none does. The composite action above does the same three steps against
GitHub's API.

The YAML is a platform example. Its `script` invokes the same `variance` binary
used locally, while `after-script` owns the platform-specific API call that
publishes the body. This package renders the body and marker but does not post
anything.

Two flags make the body something a reviewer can act on from a phone.
`--run-url` links the report you published, and `variance report --format html
--embed-images` makes that report one file a browser opens. `--to-accept` sets
how accepting works in your repository, because the comment has no way to find
out whether that is a workflow to dispatch, a label, or `variance accept` on a
checkout:

```bash
variance comment --body-file body.md \
  --run-url "$REPORT_URL" \
  --to-accept 'add the **variance: accept** label to this pull request'
```

`--image-root` puts pictures in the comment: the leading cause's before and
after on the first screen, and each further cause's pair in the fold. Give it
the address you published the report's directory under. The comment joins each
image path the report records to it, with every segment percent-encoded, so the
file `images/story%3Abutton.before.png` is asked for as
`images/story%253Abutton.before.png`. On GitHub, a commit's `raw` address works,
`https://github.com/<owner>/<repo>/raw/<sha>`, and the composite action's
`image-ref` input publishes one.

## Integration troubleshooting

| Symptom | What it means | Next check |
| --- | --- | --- |
| Exit `2` before any docket | The run failed operationally rather than finding a reviewable change. | Run `variance doctor` in the same environment; then inspect browser, collector, renderer, and store diagnostics. Do not suppress this with `|| true`. |
| Every subject is `new` after changing browser or renderer settings | The environment identity changed, so old and new images are intentionally partitioned. | Confirm the engine, viewport scale, fonts, and stabilization inputs. Establish new baselines only when the identity change was intended. |
| A planned subject is absent from the report | Coverage accounting failed; a complete run must account for observed, excluded, or failed subjects. | Inspect collector failures and, for shards, verify the subject globs cover the whole plan without overlap. |
| HTML report images are broken | Image paths are relative to the JSON report. | Upload or move the HTML report together with its report and image directory. |
| A ready selector times out | The collector opened the subject but its project-owned completion marker never appeared. | Check the collector module's id-to-selector map; do not replace the marker with an arbitrary sleep. |
| A clean pull request has no comment body | This is expected. `variance comment` emits an empty body for a clean report. | Keep the CI gate on `variance run`; let the posting integration delete or skip its prior comment. |
| A merged shard report is refused | The shards did not describe one compatible run or observed the same subject twice. | Align renderer identity, retention, and intent, then make the subject globs disjoint. |
| A change is green but reported as `ignored` | Differences existed and declarations absorbed all of them. | Read the ignore and sensitivity registers; `ignored` is intentionally distinct from `unchanged`. |

---

**[@variance-authority/cli](https://variance-authority.dev/reference/packages/cli)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
