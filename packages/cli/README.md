<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/cli

> Run the Variance Authority workflow from a project config: collect subjects, compare, render what changed, report, accept.

Part of [Variance Authority](https://variance-authority.dev).

`variance` is the executable. It captures every **subject** your project asked
for — one named UI state you asked for and can ask for again: one story, one
route at one viewport, one component mounted in a test, under an id you choose
such as `cart/empty` — compares each against the baseline you approved, writes
one report, and returns the exit code CI gates on. When pixels moved, the report
names the component that drew them and the `file:line` it was written at.

Use this package when a command reading a config file in your repository is the
integration you want. If navigation and readiness already live in Playwright
tests, use
[`@variance-authority/playwright-test`](https://variance-authority.dev/reference/packages/playwright-test)
instead — it runs the same comparison from inside a test rather than from a
separate command.

## Install

The CLI never mounts your application. A **collector** — the module that mounts
a subject and says when it is ready to be captured — owns that boundary, so you
install one beside the executable. For a Storybook:

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

The CLI knows no URL. Nothing in the config names an origin, a port or a server,
so start whatever the collector talks to before you run, and let the collector
own the address.

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
only one of them. `profile` says how much of the page is observed: `chromium`
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

The first successful durable run exits `1` because its subjects are `new`.
Review the generated candidates, accept the intended subject ids explicitly,
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
variance run     [--config <path>] [--profile jsdom|chromium] [--subjects <glob>] [--intent <text>] [--run <id> --commit <sha>] [--since <ref>] [--against <ref>] [--flakes] [--exit-zero-on-changes]
variance select  [--since <ref>] [--format plain|json|vitest|jest]
variance reach   --since <ref> [--format plain|json]
variance covering --file <path> [--line <n>] [--function <name>] | --since <ref> [--execution <path>] [--root <path>] [--format text|json]
variance report  [--config <path>] [--format text|json|html] [--subject <id>] [--exit-zero-on-changes] [<report>...]
variance ask     [--config <path>] [<question>] [--subject <id>] [--subjects <id>[,...]] [--component <name>] [--rule <id>] [--shape <digest>] [--claims <path>] [--test <id>] [--state <state>] [--file <text>] [--name <name>] [--package <name>] [--subpath <subpath>] [--query <words>] [--under|--above|--inside|--beside|--left-of|--right-of <words>] [--on <words>] [--from <path>] [--to <path>] [--changed-file <path>] [--taint-file <path>] [--limit <n>] [--at <address>] [<report>...]
variance distill --test <id> [--eyes <path>] [--execution <path>] [--root <path>] [--format text|json]
variance watch
variance adjudicate [--config <path>] --claims <path> [--exit-zero-on-changes] [<report>...]
variance accept  [--config <path>] <subject>... | --all | --shape <fingerprint>[,...] [--message-file <path> [--message <text>]]
variance changelog [--config <path>] [--component <text>] [--subject <id>] [--limit <n>] [--since <rev>]
variance journeys [--config <path>] [--all] [--file <text>] [--limit <n>] [<shard.bin>... [--into <path>]]
variance push    [--config <path>] [--run <id>] [--commit <sha>] [--branch <name>] [<report>...]
variance serve   [--config <path>]              # MCP over stdio
variance doctor  [--config <path>]
variance share   [--config <path>] [--ref <ref>] [--publish] [<report>]
variance comment [--config <path>] [--body-file <path>] [--run-url <url>] [<report>...] | --marker
```

| command | what it does |
|---|---|
| `run` | produces the **verdict** — the per-subject outcome (`unchanged`, `changed`, `new`, `incomparable` or `ignored`) that decides the exit code |
| `select` | names the test files a foreign runner may skip for this diff, for `vitest`, `jest` or a shell |
| `reach` | names every file a diff reaches, in any language it reads, for whatever you pipe it into |
| `covering` | names the tests that entered one source file, line or function, nearest first |
| `report` | re-reads what `run` wrote |
| `adjudicate` | re-reads it against what you said you were doing |
| `accept` | promotes a candidate image to baseline, by subject, by `--all`, or by `--shape` |
| `changelog` | reads back why the baselines are what they are |
| `journeys` | reads back which regions of one module this run's subjects entered differently, and folds shard snapshots into the one this checkout reads |
| `push` | sends a finished run to a review surface for somebody to decide |
| `doctor` | says what this machine can observe, before a run, not after one |
| `share` | says what the share has for mainline, or publishes what this run derived |
| `watch` | listens to a suite that is still running, so `ask` has something live to ask |
| `distill` | combines one test's portable Eyes attention and Sense execution evidence into reduction opportunities |
| `serve` | exposes the last run's report to an MCP client over stdio |
| `ask` | the same questions `serve` answers, without an MCP client |

`--shape` accepts a difference **shape**: a fingerprint computed from the diff
itself, which identifies a category of visual difference so it can be matched
across subjects. It promotes a subject wherever that shape accounts for the
whole change, and refuses by name any subject where something else changed too.

`serve` and `ask` share their questions with `@variance-authority/mcp`, so an
agent can ask what changed, in which component and which file, without
re-running anything.

### Ask: the agent answers, without an agent protocol

```bash
variance ask                          # the questions, and what each answers
variance ask summary
variance ask changes --component Toggle
variance ask describe --subject story:card
variance ask search --query viewport    # the code, not the run: no report and no config needed
```

`ask` calls the tools `serve` serves and prints what they return. The same
function, so the two cannot describe the same run differently — and a shell is
all it takes, which matters because an MCP server is a process the *client*
launches from a config file that belongs to the client. A CI job, a sandboxed
agent, a container with no editor in it, somebody else's harness: all of them
have a shell, and many of them cannot add a server. The skill this package ships
at `skill/SKILL.md` routes an agent through these questions in order.

Every answer exits `0`, including one that describes changes. `ask` reads; it
does not decide. The verdict stays with `run`, `report` and `adjudicate`, which
exit `1` when something needs review — one command per gate, so a workflow
cannot lose its exit code to a question.

`ask diff` reports what changed since the previous question was answered. An MCP
connection keeps that state in memory for as long as it lasts; a command line
cannot, so the report each answer was read from is recorded beside the
configured report as `asked.json`. Deleting it costs the next `ask diff` its
comparison and nothing else.

### Distill: find a smaller test boundary

`distill` reads two evidence files your test run writes, and neither comes from
`variance run`:

- **the Eyes archive** — what each test queried, operated and read. Install
  [`@variance-authority/eyes`](https://variance-authority.dev/reference/packages/eyes),
  record a journal per test, and fold the directory once where the run ends with
  `writeEyesArchive('.variance/eyes.json', await gatherEyesArchive('.variance/eyes'))`
  from `@variance-authority/eyes/collect`;
- **the execution index** — which files and regions each test entered. Install
  [`@variance-authority/sense`](https://variance-authority.dev/reference/packages/sense)
  and wrap the Vitest config in `withTestSelection(config, { cases: true,
  executionFile: '.variance/execution.json' })`.

Either file may be omitted and the missing domain stays unavailable; execution
alone lists entered source but produces no opportunities, because missing
attention is not an empty addressed surface.

Replace `<recorded-test-id>` with an entry's `id` from the evidence file's
`tests` array:

```bash
variance distill \
  --test '<recorded-test-id>' \
  --eyes .variance/eyes.json \
  --execution .variance/execution.json
```

`--test` identifies an entry in the evidence file's `tests` array by its `id`.
When both evidence files are supplied, their IDs must agree to join the readings.
A file path works only when it is the recorded ID. With Eyes evidence, a unique
exact title or unique case-insensitive title fragment also resolves to an ID;
ambiguous title matches are refused. Execution evidence is always matched by
exact ID, including after Eyes resolves a title.

`distill` reads the paths named on the command line and does not read project
configuration. It reports addressed targets by authored Arrange/Act/Assert
phase, React update initiators inside and outside those target paths, and files
entered by the exact test id without addressed source attribution:

```text
act:
  components: CheckoutForm
  source: src/checkout/form.tsx

React update initiators:
  act: 2 commit(s)
    inside addressed component paths: CheckoutForm
    outside addressed component paths: Clock

Runtime journey: 4 source file(s) entered by exact test id.
Entered with no addressed target attributed to the same file: 2.
  distillation opportunity at depth 0 — src/analytics.ts
  distillation opportunity at depth 0 — src/top-nav.tsx
```

The command options are `test`, `eyes`, `execution`, and `format`; their flag
forms are shown in the synopsis above.

`--format json` returns the same ordered analysis as data. The command always
reads: a distillation opportunity is not a verdict that a file is safe to mock.
The verification workflow is in [distill a test](https://variance-authority.dev/docs/distill).

### Covering: which tests entered this line

`covering` reads the same execution index `distill` does, and asks it the
question a reader has while looking at code rather than at a test: which named
tests went through here.

```bash
variance covering --file src/checkout/total.ts
variance covering --file src/checkout/total.ts --line 48
variance covering --file src/checkout/total.ts --function applyDiscount --format json
```

```text
3 named tests reached line 48 of src/checkout/total.ts, nearest first where the index carries a depth:
  depth 0 — applies a percentage discount — src/checkout/total.test.ts [total.test.ts::applies a percentage discount]
  depth 0 — renders a cart with a coupon — src/checkout/Cart.test.tsx [Cart.test.tsx::renders a cart with a coupon]
  depth 0 — checks out — src/checkout/flow.test.tsx [flow.test.tsx::checks out]
```

This is not a verdict. Execution says where a test went, never why the trip was
worth taking, so three tests on one line is the beginning of the question *why
do all three need this code* and not the answer to it.

Depth is the shortest call-stack distance between the test and that region, and
it sorts the list where a producer measured one. The Vitest recorder in
`@variance-authority/sense` does not measure it — every crossing it writes is
depth zero, and a fabricated number would sort the answer by something nothing
observed — so under that recorder the list comes back in identity order. An
index from a runner, debugger or editor integration that measures real depths
sorts nearest first, and the column is printed either way so you can tell which
kind of index you are reading.

Given `--file` alone the answer is per range rather than per test: the recorded
regions of the file, each with the tests shared by every line in it, which is
where an unclaimed region shows up as one.

The index comes from a run wrapped in `withTestSelection(config, { cases: true })`
and is read from where that run writes it, so an agent with a line number
needs no flag but `--file`. `--execution <path>` names an index recorded
somewhere else, and `--root <path>` names the project root the run recorded
against. A missing index is refused rather than answered empty, because an empty
list here reads as *no test covers this line* — the sentence that gets a test
deleted.

### Covering a change: what a review needs before reading the diff

`--since <ref>` asks the same question of everything a diff touched, which is
the shape a review has:

```bash
variance covering --since main
```

```text
2 changed files since main, 5 changed regions: 1 nothing entered, 2 entered by one case.
Read from ~/.cache/variance-authority/test-selection/<digest>/coverage.bin.cases.json, recorded at 8a72c74.

src/checkout/total.ts
  41-60 function applyDiscount — 3 cases
    depth 0 — applies a percentage discount — src/checkout/total.test.ts [total.test.ts::applies a percentage discount]
    ...
  62-66 branch applyDiscount — no case entered this region

src/checkout/total.test.ts
  a test file — 4 named cases declared here, which is what changed rather than what was reached:
    applies a percentage discount [total.test.ts::applies a percentage discount]
    ...
```

Two of those lines are findings and neither is a percentage. A changed region
**no case entered** is a hole in the evidence; a changed region one case alone
entered is evidence standing on a single point, and a line count cannot tell
the two apart from a region twenty tests cross. A case that was inside a region
only while its module was evaluating is counted apart, because it was present
rather than exercising anything.

A changed **test file** has no module row — the run instruments what the tests
import, not the tests themselves — so it is answered with the named cases it
declares rather than reported as unmeasured. A changed path the index holds
nothing for says so, in those words, because *no row* and *no test* are
opposite facts.

The diff is measured from the commit the record was written at rather than from
the merge base with `<ref>`, since the index's line ranges are in that commit's
coordinates and nothing else's. Record before you read: an index behind the tree
answers fluently about regions that have moved.

### Watch: ask about a suite that has not finished

A finished run leaves a file, so any number of processes can open it whenever
they like. A run in flight leaves nothing, and the only copy of what it said is
in the memory of whatever was listening at the time. So somebody has to be
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
it for the suite asks with nothing extra typed. Ask `self` first: it says where
the watcher is listening and what it has heard, which is what separates a run
that reported somewhere else from one that has not started. `run-signals` marks
the test still going with `▸`; `test-signals` gives everything one test
announced, in order, with the realm that said each and the work that started
without finishing — the answer a timeout cannot give, because a runner reports
what a test *wanted*.

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

The `review` section is what tells `push` where to send it — an `endpoint` and
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

Both ends say what they are. `push` asks the deployment for its API version
before it reads a byte off disk, prints the pair on the line it reports, and
names the mismatch when they differ — a CLI newer than its deployment uploads
every image it has rather than naming the ones already there, and that
looks like a slow network until something says otherwise. `variance --version`
prints this tool alone.

While it works, `push` writes its phase to stderr: one line rewritten in place
on a terminal, one line per phase in a log, and a clock on both, so the wait
between the last file read and the first byte acknowledged is legible rather
than silent. Calling `push` from your own code, the same events arrive through
`onProgress`, and `formatPush` renders the result the command prints.

### Changelog: explain a baseline update

A baseline update's report says what the new baseline is, not what the change
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
    (11 of 14 subject(s) this shape reached were promoted here)
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
subject that keeps changing, a second reading names a subject that disagrees with
itself, and none of them can say **where in the source** the two readings parted,
because none of them was inside the module while it ran.

A build instrumented with `testSelectionProbes()` from
`@variance-authority/sense/journal` was. It records which regions of which
modules each subject crossed while it was painted, and two subjects that render
one module and enter different regions of it have parted:

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
of its own that nobody in the pool entered at all. `--file` narrows to modules
whose path contains a string, `--limit` caps how many modules are named, and
what a cap left out is counted, not dropped.

It exits `0` whatever it finds. Every suite with two stories per component has
partings, so gating on one would fail every suite; this is where to look once
something else has said something changed.

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
- A pool of fewer than two observations is said out loud. A parting is a
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
found six and exited 0 would have told CI nothing it could act on.

Stability is demanded only inside the boundary a subject declares. A **sensitivity
level** names the set of bands a subject is actually asserted on — `strict`
(every band, the default), `layout` (`a11y` and `geometry` only), or `content`
(`a11y` and `content` only). A route with `sensitivity.level: layout` has said
it does not assert on what the page is painted with, so a clock ticking inside
it is listed under *not asserted on*, does not gate, and is not refused by
`accept`. `strict` absorbs nothing.

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

Exit `2` says the run did not happen as configured; anything else that escapes is
reported as a defect in this tool, with a stack trace, because telling somebody to
go and edit a config that was never wrong costs them an afternoon.

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
folded 3 snapshots into /home/ci/.cache/variance-authority/test-selection/1f3a…/coverage.bin
  342 observations over 1204 modules, recorded at 4f2a1c9d0b73

app/src/components/CartCard.tsx  3 observers
  …
```

The fold refuses shards that were not one run, naming both files: recorded
under different probe recipes, or at different commits — and a shard recorded
outside a checkout names no commit, which is a disagreement rather than a
blank. A test file two shards both recorded means the split overlapped, which
only the operator can resolve. A module one shard could not instrument is
unread in the fold however many others measured it, because that row is the
one a selector widens on.

Where it lands is this checkout's own cache, the file every run on this
machine layers over, unless `--into <path>` names somewhere else — a job that
folds and uploads names the artifact it uploads. Landing is a layer, not a
replacement: what was already there is merged under the fold, so the result
stands at the fold's commit, retires every observation the fold re-recorded
whole, and keeps the ones it did not. That is the whole of the recipe for a
laptop:

```bash
base=$(git merge-base origin/main HEAD)
# fetch the snapshot your CI folded and uploaded for $base, however it stores artifacts
variance journeys ./coverage-$base.bin
```

The full suite on the default branch records the floor; each local run layers
its own evidence on top; and a selection made against the result is measured
from the commit the fold named, which is what `variance run --since` and the
journal both read.

### `select`: what your own runner may skip

`variance run --since` narrows the subjects this tool renders. `variance select`
answers the same journal for a suite this tool does not run — `vitest`, `jest`,
or any runner a shell script hands paths to — by naming the test files that diff
cannot reach:

```bash
vitest run $(variance select --format vitest)
jest $(variance select --format jest)
```

It prints a **skip** list, never a run list, and that is the whole of its safety.
A run list has to be complete to be correct, and this journal is never
complete: it records the tests that finished whole, at one commit, in one
recipe. A skip list that comes back empty runs your suite. A run list that came
back empty would run nothing, and the suite would go green in seconds.

So stdout gets paths and nothing else, and every sentence about the reading
goes to stderr, where a `$(...)` cannot pick it up and hand it to a runner as a
path. `--format plain` writes one path per line, relative to the repository;
`vitest` writes `--exclude=` arguments naming each file's absolute path, because
a workspace is many projects and a project matches an exclude pattern against
its own directory rather than the root the journal counts from; `jest` writes
`--testPathIgnorePatterns=` arguments and re-states jest's `/node_modules/`
default, which that flag would otherwise replace. `--format json` reports the
counts and the widening reason together for something that wants to decide for
itself.

It declines to narrow, out loud on stderr and with an empty stdout, whenever the
journal cannot speak: nothing recorded on this machine, a diff git would not
produce, a journal with no whole observation in it, or a diff touching a file no
probe was ever in. That last one is the common case on a first read — an asset,
a config, a module your probes do not cover — and it is why the command reads
`0` even when it skips nothing:

```
$ variance select
skipping nothing: the diff changes 3 files the journal holds no measurement of
(docs/selecting.md), so it cannot say which tests enter them.
the execution journal was not asked, having no record of every changed file.
```

The journal's own commit is what the diff is measured from, because its line
numbers are coordinates in that commit's text. `--since <ref>` names a base only
for a journal recorded outside a checkout, which names no commit of its own.
No `variance.config.json` is read, so a repository that uses this tool for
nothing else can still ask.

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
answer at all. Either stdout lists every file the diff reaches — the changed
files themselves always among them — or the command writes nothing to stdout and
exits `2`. It refuses when the diff is empty, when a changed file in a language
it reads is not in the graph, and when no changed file is in the graph:

```
$ variance reach --since origin/main
none of the 2 changed files is in the file graph, so this diff says nothing about
what it reaches. Rather than print a file list this cannot stand behind, `reach`
stops here: a short list piped into a runner is a green build over a change
nobody read.
```

Changed paths in no language it reads — a lockfile, a workflow, a Dockerfile —
are left out of the walk and named on stderr, so you can see the part of your
diff the answer is not about. Everything else a person needs goes there too,
including how many files were reached from how many, and which files were
traversed because their own imports could not be read. `--format json` gives
the same facts for something that wants to decide for itself.

No `variance.config.json` is read, and there is no default for `--since`: without
a ref there is no diff, and the honest answer would be every file in the
checkout.

### Sharding: `report` takes more than one file

A suite big enough to split across CI jobs runs `variance run --subjects <glob>`
once per job and ends with one artifact each. Name them all and `report` answers
about the suite, not about a slice — one exit code, one body for
`comment`:

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
means the globs overlapped, which only the operator can resolve.

What it does accept is the arithmetic nobody wants to do by hand. Each shard
records every subject outside its slice as `excluded`, so three shards report
each subject as excluded twice and observed once; the merge resolves those
against what was actually observed. **A subject that every shard filtered out is
promoted to `failed` and turns the merged run red** — each shard exits `0`
because each did exactly what it was told, and the merge is what notices the
suite is missing a component.

`comment` renders the same report as a pull-request body: causes first,
collateral counted rather than listed, and **nothing when the check is green** —
an empty body, because a bot that comments on every clean pull request teaches
the team to filter it out, and the filter does not distinguish the clean ones.
It writes to `--body-file` when given one and to stdout otherwise, and it posts
nothing itself. `--marker` prints the HTML comment the poster searches for to
find and rewrite its own previous docket; it is asked separately because it is
needed in exactly the case where there is no body to read it out of. Exit `0`
means *this rendered*, never *the run was clean* — the verdict belongs to `run`,
which already said it.

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

- `run` receives a `config` plus injected dependencies. Its `flakes` flag asks
  for the whole-suite stability sweep; `identity` records a run in the optional
  history store; and library `since` is the already-computed `{ changed, ref }`
  selection that the executable's `--since` flag derives from Git. A missing
  `identity` or `since` means that concern is not requested, not that the run
  guessed one.
- `run` also takes `against`, which is a different question from `since`:
  `since` narrows *which subjects render*, and `against` leaves the plan alone
  and reads *what the commit reaches* — the diff against that ref, walked
  through the import graph to the components each subject renders. A changed
  subject the commit does not reach is the strongest thing a report can say,
  and it is unavailable to anything that only compares images.
- `run` also takes `index`, which narrows nothing. It is where the recorded
  execution index stands — the commit it was written at and how many files the
  working tree differs from it by — and it travels into the report so a reader
  can see what `--since` would have cost on this run. `narrowingFor` resolves
  `since`, `against` and `index` together from the refs a caller was given.
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
  location and `limits` when a caller needs smaller docket bounds. Limits merge
  over `DEFAULT_LIMITS`; the renderer still states what it omitted.
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
summary that says "nothing to review" because eleven subjects failed to render is
worse than no summary at all.

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
  // a monorepo tool's answer across the package boundary a specifier cannot
  // cross.
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
ids nor a story index says how to mount, and the mounting half is code you
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
rest on it instead of running the suite — it costs one scan of the tree,
which is cached by content and by tree shape and so is paid once. The graph
reads the mocks as it goes: a test that calls `vi.mock('./api')` is not reached
by a change to `api.ts`, at any depth, because its run never enters that module.
`taints` names JSON tables that say what else a file imports beyond, or short
of, its text — a framework's own import notation, a module loaded under a name
the code never writes — keyed by file with `-` and `+` rows. The same
graph answers the execution journal for a changed file it has no row of: the
importers of that file, and theirs, until one the journal did record. `unrendered`
answers the case where the walk succeeds and lands nowhere: a change landing
only on components no baseline records narrows like any other, and the run names
what it could not match — either nothing here watches that surface, or something
here paints it without recording it, which a server component always does. Set it
to `"whole"` for the second, and the run observes everything instead. `changes`
asks `nx` or `turbo` what a diff affects and folds their answer in as **more changed
input**, never as a second opinion: it is the one edge a specifier scan cannot
see, since a workspace package imports its neighbour's built output. `turbo`
needs a `task`, because it filters a task graph rather than describing a
workspace. If the tool cannot be run, the run refuses — an empty project list is
a legitimate answer meaning *this diff crossed no package boundary*, and a
failure that produced it would skip every consumer of whatever changed.

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
| `intent` | the default `--intent` label |
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
