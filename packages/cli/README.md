<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/cli

> Run the Variance Authority workflow from a project config: collect subjects, compare, render what changed, report, accept.

Part of [Variance Authority](https://variance-authority.dev).
Point your coding agent at [`llms.txt`](https://variance-authority.dev/llms.txt).

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
[run visual review from the command line](https://variance-authority.dev/start/cli)
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
variance shards  [--setup <seconds>] [--budget <seconds>] [--max <n>] [--workers <n>] [--since <ref> [--collected <file>]] [--at-distance <hops>] [--suite <name>] [--unrecorded <n>] [--format text|json]
variance reach   --since <ref> [--format plain|json] [--whole-files] [--no-git]
variance covering --file <path> [--line <n>|<a>-<b>] [--function <name>] [--at-distance <hops>] [--in-package] [--hops] [--text <path>|-] | --since <ref> [--against <record>] [--cases last|<test file>] [--where <name>[=<value>]]... [--read <name>[=<value>]]... [--execution <path> | --suite <name>] [--root <path>] [--format text|refs|json]
variance coverage [--suite <name> [--against <record>]] [--from <dir> | --packages] [--at-distance <hops>] [--fan-in] [--root <path>] [--format text|markdown|json]
variance layers  [--against <index>] [--root <path>] [--format text|markdown|json]
variance restrictions [--root <path>] [--format text|json]
variance review  [--since <ref>] [--against <record>] [--suite <name>] [--coverage] [--out <dir>] | --from-run <run id or URL> [--artifact <name>] [--root <path>] [--format text|markdown|json|handover]
variance report  [--config <path>] [--format text|json|html [--embed-images]] [--subject <id>] [--exit-zero-on-changes] [<report>...]
variance ask     [--config <path>] [<question>] [--subject <id>] [--subjects <id>[,...]] [--component <name>] [--rule <id>] [--shape <digest>] [--claims <path>] [--test <id>] [--state <state>] [--build <id>] [--file <path>] [--files <path>[,...]] [--area <id>] [--name <name>] [--package <name>] [--subpath <subpath>] [--query <words>] [--under|--above|--inside|--beside|--left-of|--right-of <words>] [--on <words>] [--from <path>] [--to <path>] [--imports <import>] [--declares <regex>] [--path <regex>] [--text <pattern>] [--except-from|--except-to|--except-imports|--except-declares|--except-path <value>] [--changed-file <path>] [--taint-file <path>] [--just-answer] [--limit <n>] [--offset <n>] [--at <address>] [--format text|json] [<report>...]
variance distill [--test <name>] [--file <path> | --from <dir>] [--execution <path> | --suite <name>] [--root <path>] [--format text|json|jsonl]
variance story   [--file <path>] [--name <name>]... [--label <label>] [--in <file> | --package <name> | --around <step> | --whole | --compare last|outcome|<a>,<b>,…] [--root <path>] [--format text|json]
variance watch
variance adjudicate [--config <path>] --claims <path> [--exit-zero-on-changes] [<report>...]
variance accept  [--config <path>] <subject>... | --all | --shape <fingerprint>[,...] [--message-file <path> [--message <text>]]
variance changelog [--config <path>] [--component <text>] [--subject <id>] [--limit <n>] [--since <rev|instant>]
variance journeys [--config <path> | --suite <name>] [--all] [--file <path>] [--limit <n>] [<shard.bin>... [--into <path>]] | finalize <journey-file> | stitch <shard.bin>... --into <journey-file> | combine <record.bin>... --into <new-record> | inspect <record.bin> [--format text|json]
variance push    [--config <path>] [--run <id>] [--commit <sha>] [--branch <name>] [<report>...]
variance serve   [--config <path>] [--just-answer] # MCP over stdio
variance doctor  [--config <path>] [--baselines]
variance prune
variance share   [--config <path>] [--mainline <branch>] [--publish] [<report>...] | --suite <name> [--publish [--collected <file>] | --format text|github]
variance collect [--config <path>] [--subjects <glob>] [--shard <k>/<n>] [--workers <n>] --out <part.json> | merge <part.json>... --out <suite.index>
variance carry   restore | save [--config <path>] [--format text|github]
variance comment [--config <path>] [--body-file <path>] [--run-url <url>] [--to-accept <text>] [--image-root <url>] [<report>...] | --marker
```

| command | what it does |
|---|---|
| `run` | produces the **verdict** — the per-subject outcome (`unchanged`, `changed`, `new` or `ignored`) that decides the exit code |
| `index` | publishes the file graph that `select`, `reach`, `covering` and `run --since` read |
| `select` | names the test files a foreign runner may skip for this diff, for `vitest`, `jest` or a shell |
| `shards` | prints how many shards a recorded suite is worth, and the `k/n` of each for a CI matrix, from what each shard spends before its first test |
| `reach` | names every file a diff reaches, in any language it reads, for whatever you pipe it into |
| `covering` | names the tests that covered one source file, line or function, nearest first |
| `review` | prints what a change did, after the suite ran it: the edits, the changed code no case covered, the cases added, and what changed outside any import |
| `report` | re-reads what `run` wrote |
| `adjudicate` | re-reads it against what you said you were doing |
| `accept` | promotes a candidate image to baseline, by subject, by `--all`, or by `--shape` |
| `changelog` | reads back why the baselines are what they are |
| `journeys` | finalizes one runner's journey artifact, stitches artifacts from CI shards, or reads back which regions this run's subjects covered differently |
| `push` | sends a finished run to a review surface for somebody to decide |
| `doctor` | prints what this machine can observe, before a run, not after one; `--baselines` asks only what the baseline store holds, with no browser opened, and exits 2 on a checkout of git-LFS pointers git-lfs cannot fetch here |
| `prune` | removes the cache entries whose checkout, worktree, process or commit is gone, now |
| `collect` | reads the suite index's facts with no baseline, comparison or image, one part per shard; `collect merge` checks the parts are one build and folds them into the index |
| `share` | prints what the share holds for your mainline, or publishes this run, or every shard of one build, to its line; `--suite <name>` does either for one suite's record alone |
| `carry` | prints the paths and cache keys a CI job restores before a run and saves after it, from the config |
| `watch` | listens to a suite that is still running, so `ask` has something live to ask |
| `distill` | combines one test's portable Eyes attention and Sense execution evidence into reduction opportunities |
| `story` | draws the route one case took through the code: the files and declarations it went through, with the steps it reached each, then the part of the route you ask for, each loop drawn once; with `--compare` or several `--name`, lists what every recorded run on some sides did and no run on the others did |
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
was produced, saying under an answer or a refusal that the checkout was not
compared with it; `search --format json` carries `compared: false` instead.
Without the flag a generation is reused for one hour before the next source
question refreshes it. A question refused from a reused generation, on `ask`
or `serve`, is asked again of one made now, with the dependency lexicon built
when it is missing or behind, before the refusal is given; on `ask` that holds
under `--changed-file` and `--taint-file` too. When the checkout cannot be read
again, the refusal says it was not compared with the generation, and why; when
the lexicon cannot be built, it says the installed packages were not compared,
and why. An injected
`AskRequest.source` is read again with `current` set, and owns its own lexicon. When no changed files are
named, `search` is the exception: it reads the published generation, whatever
its age, and says so on the same line. When nothing is published it reads the
checkout and publishes the search, unless you passed `--just-answer`, which
refuses and names that flag. `--changed-file` and `--taint-file` still ask it
for a new generation by name.

A library host that injects `AskRequest.source` receives `SourceReadOptions`.
Its `current` field is true when a question was refused from a generation
older than the question, and asks for one made from the checkout now. Its
`tree` field is true only when the selected source tool names a `from` or `to`
path, so the injected reader can avoid loading the graph for every other
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
variance ask decisions --subject story:card   # what reviewers decided on it, read with the share token
variance ask concerns --build ci-42           # what reviewers flagged as suspect on the subjects that build showed, and why
```

`ask` calls the tools `serve` serves and prints what they return. The same
function, so the two cannot describe the same run differently — and a shell is
all it takes, which matters because an MCP server is a process the *client*
launches from a config file that belongs to the client. A CI job, a sandboxed
agent, a container with no editor in it, somebody else's harness: all of them
have a shell, and many of them cannot add a server. The skill this package ships
at `skills/variance-authority/SKILL.md` routes an agent through these questions in order;
the one at `skills/variance-testing/SKILL.md` is the order to ask them in while
it writes, fixes or debugs a test. Link both into your agent's skills directory
rather than copying them; `variance doctor` prints whether an agent can find
each and prints the link when it cannot.

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
variance distill --file test/checkout.spec.ts --test 'checkout > submits'
```

`--file` takes the test file's path, relative to the checkout or absolute, and
names that file alone. `--test` takes the case's
`id` or its whole title, its `describe` blocks and its name joined with ` > `. Either
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

`--line 40-60` asks a run of lines, and `--function Cart` a class: every case
that entered one of its recorded methods. A line whose edit charges the
module's own region, such as a module-level statement or the first line of a
top-level function, is answered at file grain, with the cases that loaded the
file, and the answer says so.

Over a whole file, a region no case entered on a line the function around it
also charges, such as a one-line branch or the line that opens a longer one,
gets a range of its own and a line saying no case entered it, and whether that
is unwalked or a hole; `--format json` lists it under the range's `unentered`.
A narrowed answer and a file edited since the run say the same, at the line the
region stands on now.

A function some cases entered can still hold a part none ran: a branch no case
took, or a callback no case called. `--function` names each one under its
cases, `No case ran a part of it: the branch at line 112`, and `unrun` under
`--format json`. They are read over every case, before `--where` or
`--at-distance` narrows the list, with the review's own reading over the whole
function, in each suite the answer reads, as the handover reads them.

A module the run loaded without instrumenting it, such as one named in
`unprobed` or one whose text the run could not parse, has no recorded line. It is a
precondition of every test file that loaded it, and `variance select` selects
all of them on a change to it, so `covering` names those files and no case:

```text
src/format/stabilize.ts is a precondition of 4 test files, and a change to it selects every one: the run loaded it without instrumenting it, so no line of it has a recorded case.
  src/render-cache.test.ts
  …
```

A file the suite declares a precondition, such as a native source no probe
reaches, is said to be one rather than met by each test file:

```text
native/src/lib.rs is not instrumented: the suite declares it a precondition of every one of the 212 test files these cases come from, so no case is recorded entering any line of it, and a change to it selects all of them.
```

Over a whole module that many test files import, each range names the cases
that ran it and counts the rest, the ones that ran it only while their file
imported the module:

```text
src/format/index.ts — 3 recorded ranges, 4 named tests, and 180 more that ran it only while their file imported it
lines 1-40
  src/format/index.test.ts
    formats a total
  and 180 cases in 96 test files ran it only while their file imported the module
…
```

A record cut under probes this build does not place still answers: what ran,
and which cases ran it, is read from the record as it holds it, at its own
commit. The answer opens with both probes and the question the difference leaves
open, which is whether a region this build cuts and those probes did not ran.
For the file asked about, `covering` compares the regions the record holds, and
their lines, with the ones this build's presence walk cuts in the text the
record was made over, and names any that differ. An equal cut does not show that
a hit means the same under both probes, and the note says so. When this machine holds the mainline's record cut under this
build's probes beneath the one read, the note names its path, which
`--execution` reads.

When the root `variance.config.json` declares
[suites](https://variance-authority.dev/docs/execution-record#one-record-for-each-suite),
`covering` reads every suite's record and answers under each suite's name and
kind, because each suite proves something different:

```text
unit (unit):
  2 named tests covered line 48 of src/checkout/total.ts:
  …

checkout (e2e): nothing is recorded in /repo: no run left a per-case index at …

Not loaded by stories (visual): a run that never loaded the file has no answer about it, which is not the same as no test covering it.
```

Suites are asked nearest kind first: unit, integration, e2e, visual. Once any
suite answers, the answers come first, then any suite that has never run. A
suite that never loaded the file costs one line at the end. A suite whose record
was made before the file existed says so, with the commit it recorded at, since
only its next run can answer. When no suite answers, each says why in full,
with the record it read, since a wrong path is
then the likely cause. The record names files from the repository root, so give
`--file` that way, or as an absolute path; one outside the root is refused. A
refusal names the path you asked and no other: `apps/shop/src/checkout/total.ts`
is a different file from `src/checkout/total.ts`, and so is any other recorded
path of the same name.

In JSON the answer is a `suites` list. Each entry is that suite's own answer
with its `suite` and `kind`, or its `reason` with `refused` set to `unrecorded`,
to `unloaded` for a file the suite never loaded, or to `older` for a file its
record predates. A file the suite loaded without
instrumenting it is answered with `preconditionOf`, the test files that loaded
it. Beside the list, `marks` cuts the file into runs of lines and gives each
the one state the suites that ran it make together, with their names, so an
editor paints a line once. `--suite <name>` reads one record alone, answers in the shape a repository with one record does, and so
gives a suite's refusal in full.

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

A range with no word is one the record cannot rank: a case's stop was never
recorded, or a case ran it in another text than the one its lines are numbered
in.

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
[`variancePrecondition`](https://variance-authority.dev/reference/packages/sense#record-the-state-each-test-ran-under) has it
on its row, and every case `covering` lists prints each value with the call
that recorded it. `--where` keeps the covering cases that ran under a
precondition, in every form of the question:

```bash
variance covering --file src/checkout/total.ts --function total --where mocks:prices=discounted
```

```text
Kept the 2 of 4 cases that covered function total of src/checkout/total.ts and recorded mocks:prices=discounted.
2 named tests covered function total of src/checkout/total.ts:
  test/total.test.ts — 2/4
    sale prices > applies the discount — read flags:discount=true said true, mocks:prices=discounted (test/prices.ts:12)
    sale prices > charges the sale price — read flags:discount=false said false, mocks:prices=discounted (test/prices.ts:12)
```

The count is out of the cases that covered what you asked about, before
`--where` narrowed them. `--where mocks:prices` keeps every value of
`mocks:prices`, `--where mocks` every key of the dimension, and every repeated
`--where` must hold. Where the code under test leaves a breadcrumb with
[`varianceBreadcrumb`](https://variance-authority.dev/reference/packages/event),
each case prints what the code read beside what the case said under the same
name, `read flags:discount=true said true`, and `--read` keeps the cases by
what the code read, in the same forms. The two filters never stand in for each
other: `--where flags:discount=true --read flags:discount=false` keeps the
cases whose claim never reached the code. Two values recorded at one level print as a
contradiction, and match a `--where` naming either. A record made before cases
recorded preconditions keeps none and counts every case as unmeasured, rather
than answering that no test covered it, and a case from a runner that does not
record preconditions is counted apart from the cases that recorded nothing. When `--where` keeps none of the cases that covered
a line or function, the answer prints that the filter left none of them and how
many there were, rather than that no test covered it. The state of a line,
function, range or changed region, and the cases that stopped before it, are
read over the same cases before `--where`: a line three cases ran stays `walked`
when `--where` keeps one of them, and a hole stays a hole when it leaves out the
case that stopped.

#### Asking about the text you hold

The recorded line numbers are numbered in one text of the file. Edit the file
and they point at whatever code sits there now. So the answer about a file, a
line or a function checks your text against the record first, and names the
`frame` its numbers stand in:

- `recorded`: your text is the one the record's lines are numbered in.
- `mapped`: the text changed, and every range was carried to where its lines
  stand now. A range an edit touched is marked `moved`.
- `stale`: the text changed, and the text the lines are numbered in could not
  be found. No ranges are printed, because ranges at the wrong numbers would be
  read as real. The answer names the cases that ran code in the file, and says
  that which of them ran the line you asked about cannot be said.

```bash
variance covering --file src/checkout/total.ts --text - --format json < buffer.ts
```

`--text <path>` reads the held text from a file, and `--text -` reads it from
standard input, which is how an editor queries a buffer you have not saved.
`--line` then names a line in that text. A line the edit wrote is answered
with no case, and the answer says the edit wrote it. A line a case ran over,
where a run over another text has landed since, is answered with no case for it
either, and named in `overwritten`: a line your text holds and the record's
does not, and every line of a region a run in part under `-t` landed an edit
over, where the cases that ran the region before ran another text. The record
lost which case ran the line, and a later run that numbers the record in your
text again does not bring that back. Over the whole file, `--format json` names
those cases under the range's own `overwritten`.

#### How fresh and how actual the answer is

The frame says where the record's numbers stand in your text. It does not say
which text each test file ran over, or when. Those differ from one test file to
the next, because a run of some test files lands on the record and moves it to
the commit it ran at, and every test file it did not run keeps where it last
ran. Run `a.test.ts` and `b.test.ts` over an edit you have not committed,
commit another edit, and run `a.test.ts` alone: the record now stands at the
second commit, `b.test.ts` last ran over a text that was never committed, and
an answer naming both is two answers of two ages over two texts.

So under the answer, after the frame line, the test files it names are said in
groups, one line each, in the order their runs landed: a group the record holds
no time for first, then the oldest.

```text
The recorded lines of src/pay.ts are placed in its text as it is now.
src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 9 hours ago; `pay` is the same in both.
src/pay.ts is the text the other test file named here ran over, in a run that landed 6 minutes ago.
```

The frame line says nothing under `recorded`. A `stale` answer about the file
or a line says it first instead, since it is why no line is given, and under
`--function` it adds that the parts of the function no case ran are not said.
Under `mapped`, a part of an asked function no case ran that an edit touched
prints as `edited`. A file whose record does not say which text its lines are
numbered in gives them as recorded. A file not on disk is answered in the
record's lines, and its test files are dated with no text to compare.

A group is the test files one run last finished. A run finishes a test file it
runs whole, and one the record held no cases of; a run that executes none of a
test file's cases, every one skipped or filtered out, did not run it. A later
run that runs one in part, under `-t`, a filter or a skip, names the cases it
ran, so each case the answer names is dated by the run that last ran it and
compared with that run's texts. A test file whose named cases last ran in
different runs is said part by part on one line, newest first:

```text
src/pay.test.ts ran 'refunds' over this text, in a run that landed 1 hour ago, and its 1 other case named here over another text of src/pay.ts, in a run that landed 3 days ago, in which `pay` is the same.
```

A run in part that kept no cases, because its seam recorded none, says it
laid none of them, so each case the answer names is dated by the run that last
finished the file, whose cases the index still holds. A test file the answer
names no case of spans the times of every run that wrote its lines: the one
that last finished it, and each later run in part. So does a case of a test
file whose later run in part does not say which cases it laid, as a runs record
another tool wrote may not. When those runs ran over different texts and only
some of them over yours, which text its cases ran over is not known, because
the record does not say which case ran in which run.

Each run is read where it stood: its commit, when it landed, and the texts it
ran over that were not committed there, as the runs record keeps them. Your
text, the `--text` buffer or else the file on disk, is compared by digest with
the text the runs record names for that run, else with the committed one at its
commit. A group is compared only on the files its runs read: the asked file
its cases entered or hold as a precondition, and under `--since` each changed
file its cases are named for, entered or hold as a precondition. A file its
runs never loaded says nothing of the text they ran over, so it is neither
another text nor one that did not exist. The test files that ran over your text
share one line. A group that ran over another text, or whose text is not known,
is named. A file a group read that did not exist at the commit it ran at is
said so, as in `src/extra.ts did not exist where src/fee.test.ts ran`, while a
commit or a text this clone lacks leaves the text not known. Every file a group
read is said: a group that ran over your text of one file and another text of
the next says both, so no file's verdict hides another's.

When you asked about a line, a run of lines or a function, a named group's line
goes on to say whether that region is the same in both texts, read by placing
your region in the text they ran over, or why that is not known: that text is
neither kept nor committed, or the record's lines have no place in yours. A
function with no block in your text is said to be gone from it. Under
`--function`, the line says nothing of the region when the record does not say
which text its lines are numbered in, since the function is found by those
lines, which then have no known place in yours.

The time is when that run landed in the record: `in a run that landed 3 hours
ago`. A line that says several groups, or a test file a later run ran in part,
spans their landings, `in runs that landed from 3 days ago to 3 hours ago`, and
so does a group whose runs record keeps one span for every run at its commit.
It is never when a commit was made, which says nothing of when a test ran. A
group the record holds no time for says it ran `at a time the record does not
hold`, as does a record seeded before runs kept their landings, since the seed
stamped it when it was copied. One whose texts the record does not hold says
that whether the text is yours is not known, and why. A record of runs outside
a git checkout names no commit: a later run there leaves the test files an
earlier one finished where they ran, as at one commit, and each is dated by
when its run landed. Only the run that wrote the snapshot is compared with the
text the snapshot's rows were recorded over; an earlier run's rows a later one
may have written over, so its text is not known. A test file your checkout
reads from a newer mainline record is dated and compared by the run that
published it.

A test file the runs record does not place, and every test file when no runs
record lies beside the snapshot or the one there is of another commit, is read
where the record assumes it ran, at a time it does not hold, and which text it
ran over is not known; a last line says how many were read so. An answer that
names no test file is dated by the test files that entered the file, and
compared over it, else by every test file of the cases it was read from, and
compared over nothing, since none of them loaded it. Under `--since`, a changed file
that is not on disk is named first, and no line says a test file ran over it.

In JSON, `at` is the commit the record stands at, on every answer whose record
names one. `ran.stands` holds one entry per group: its `commit`, absent for a
run outside a git checkout, its `tests`, `cases` naming the cases of its one
test file when that file is said part by part, `landed` with ISO `first` and
`latest` and, when the record counts them, `runs`, and `partly` with the
`commit` and `landed` of each later run in part that may have run them: every
one when no case is named, else each that does not say which cases it laid. `files` names the asked files they are compared on when fewer than
all. Then `text` is `held` when they ran over your text of every file they are
compared on, else `other`, with `other` naming the files they ran another text
of, `absent` the ones that did not exist where they ran, `held` the ones whose
text is yours when not every one is, and `region` as `same`, `changed`, `gone`
or `{ "unknown": <why> }`. `unknown` says why the text of the files none of
those name is not known, and `assumed: true` marks a group the record did not
place, with `ran.assumed` saying how. `ran.unheld` names the changed files under
`--since` that are not on disk, and `ran.named` is `entered` or `read` when the
answer names no test file and the groups are the ones it is dated by instead.
`ran` holds `tests` and `unread`, saying why, in place of `stands` when where
they ran cannot be read.
`moved: true` marks a `--function` answer and each `unrun` part an edit touched,
and `unheld: true` a file that is not on disk. `ran` is left out under
`--format refs`.

The index comes from any run wrapped in `withTestSelection(config)` and is read
from where that run writes it, so an agent with a line number
needs no flag but `--file`. `--execution <path>` names an index recorded
somewhere else, and `--root <path>` names the project root the run recorded
against. A record named so that names its commit is read as the suite's own:
its `at` is that commit, its lines are framed in your text against it, and it is
dated by the runs record beside it. One that names no commit, as a journey file
does, gives its lines as recorded and is said to name none. A missing index is refused rather than answered empty, because an empty
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

Under the regions, the answer says which changed files the test files it names
ran over and when, as an answer about one file does, with no region. When the
record names no commit, the `Read from` line ends `; the record names no
commit.` in place of `recorded at`.

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
landed. Each region whose cases changed is one of four:

- **lost**: cases walked it at the base, none do now, and every case that could
  have reached it finished. The region is no longer run.
- **hidden**: the same, except a case that could have reached it stopped. The
  case is named, and whether the region is still run is not known.
- **thinned**: several cases walked it at the base, one does now.
- **gained**: no case walked it at the base, one or more do now.

A region is none of the four when a case that walked it at the base belongs to
a test file that has not run since the region's file changed. The record kept
that file's cases from its last run and dropped them where the edit could have
changed what they did, so whether the test still walks the region is not
measured. The answer lists the region as not measured, and does not say that
the test file no longer enters it.

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

### Handing the coverage to a reviewer before CI runs

```bash
variance review --since origin/main --format handover
```

points to the coverage of the changed area as one folded
`<details>` block for the pull request body. A review bot reads the body when
the pull request opens, before any check has finished. A changed function gets
a line when there is something to look at: 🔴 when part of it ran under no
case, or has none in a record from before the change, 🔵 when the change wrote
it and no case has run it yet; otherwise the review comment's mark for its
furthest reached part: 🟡 far, 🟠 a distance not measured, ⚪ only while its
module loaded. A reached line names how many cases and the first test file to
open. A function every case reached from a test file that imports it is only
counted. Absences come first; past twelve lines the rest are counted, and the
block ends with the `variance covering` command that reads one file in full.
Every declared suite is read, and when more than one is, each line names its
suite; a suite whose record cannot be read is named with the reason, and one
named with `--suite` fails instead. When a suite ran on the change, the runs
on the change alone answer for every changed file it read: a record from before the
change places the edit by its old lines, and its cases reached the old code.
Elsewhere a record from before the change answers, and a summary with no gap in it
counts what only it reached; when the block reads both, a line it answers says *in the
record*. The block sits between `<!-- variance-authority: handover -->` and
its closing marker: the block a later run prints is pasted over everything
between them.

It reads this checkout's record as `covering` does. `--from-run`, `--out`,
`--coverage` and `--against` read or compare what a run made, so a handover
refuses them, and it leaves out the cases local runs moved: CI's comment
reports those.

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

2 changed regions in 1 file: 1 new, 1 modified.
- 1 no case covered: 1 new.
- 0 covered only by tests further than one import away.

Edits:
      1  top-level values
      1  not a module

Changed regions (new or moved in brackets):
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
  `--format json` keeps every region. Each region is new, modified or moved:
  new when the change wrote every line of it, moved when those lines are text
  the diff removed, from that file or another, and modified otherwise.
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
compares nothing for them. A second run at this commit that ran a test file
again retired cases that name no commit to diff from, so the review compares no
case and says why, in every format, under `motion.undiffed` in `review.json`;
the rest of the review is answered as usual. Commit, and the first run after it
compares again.
`--against <record>` compares with a case index you hold instead. `--out <dir>` writes `review.json` and `review.md` beside what is
printed. The markdown starts with a hidden marker line, so a pipeline finds its
own pull request comment and edits it instead of posting another.

`--coverage` includes coverage for every declared suite in the same review,
and reads the changed regions from every suite too. A suite answers for a
changed file it ran as the tree holds it, so a region no unit case entered and
an integration case ran is counted as run, by that case; each region is read
from the suite that came nearest. Where no suite ran the file's current text,
the suite named with `--suite` answers alone, as it does without `--coverage`.
The comment leads with the changed-code finding, which test files ran, and the
execution changes per suite. Percentages, each suite's coverage in and out,
and source inventories are folded under **Coverage by suite**. Each suite keeps
its own denominator and baseline; a missing record or baseline is named rather than counted as zero.
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

The markdown's first line names what it read: the commit reviewed, the commit
the change starts from, the commit the cases ran at, and the commit of each
recording coverage is compared with. In CI on a pull request the checkout is
GitHub's merge of it, so the comment names the pull request's head, the merge
it was tested as, and says it describes an earlier commit once the head moves
on. Each changed place links to its lines at that commit.

When the changed functions sit in more than one package, the verdict is
followed by **Where this change lands**: one row a package, as its nearest
`package.json` names it, with its changed functions counted by mark, how many
of them hold code no case ran, the packages whose tests ran them (`own` for its
own), and how many other packages import its changed files through any number
of imports, type-only ones included. A function is counted under the mark the
table of what ran gives it, for the nearest test that entered it, so a function
a case entered is never counted under 🔴; a branch in it no case ran is counted
in the next column, beside the functions no case entered. Packages with code no
case ran come first, then those with the most functions no test importing their
file ran. The table stays within 10 rows in a repository of any size: past
that, the packages whose every changed function a test importing its file ran,
in full, are folded into one row, and the packages that do not fit above it
into another. `review.json` lists every package under
`changedPackages`.

Changed functions are listed in one table: how the edit wrote each (new,
modified, or moved and from where), the cases that entered it, and the cases
that ran a changed line in it. A case entered a function when it called into
it, and ran a changed line when it entered the function and `variance covering
--line` names it for a changed line in it, so a test that calls the function and
takes the branch the change left alone is counted in the first and not the
second. The cases added and removed come
first, the legend for the marks above the table, and the table's 100 rows name
the first three test files of each function; the cases by title are in
`review.json`. Files not in the record, cases moved against the base and each
changed file are folded under **Recording scope and limitations**, which lists
the first 40 moved regions, test files whose reach moved, and files not
compared, and counts the rest.

Under the table, folded, the changed functions are drawn as a Mermaid diagram,
those no case ran included: each under its file, coloured by how near the
nearest case that ran it is, with its edit and both counts, and an edge from
each test file whose cases called into it. A red function with no edge is one
no case ran. The diagram draws 24 functions, those no case ran first, then
those a file only loaded, then those furthest from their nearest case, and the
8 test files that reach the most of them, and counts the rest.

GitHub rejects a comment longer than 65,536 characters, so a longer markdown
review is cut at a line break before that length, and its last line gives the
number of characters not shown.

When the cases that entered a function recorded more than one value of a
precondition, its row names every value — `ran under flags:discount=false,
flags:discount` — so you see which states ran the change without asking
`covering --where`. When they read a breadcrumb, the row splits them by what
they read — `flags:express read false by 1, true by 1, not by 6`, where `not`
counts the cases that entered the function and never read the key — so new
code behind a flag that only the flag-on case reached shows
`flags:express read true by 1`. `review.json` keeps each case with the
preconditions it recorded and the reads its code made, as `preconditions` and
`reads`, and any misused breadcrumb as `misused`, the way `covering` prints
them. For a record made before cases recorded preconditions, the
state they ran under is printed as unmeasured, and cases from a runner that
does not record preconditions are counted apart from the cases that recorded
nothing.

A comment shows part of the answer, and `review.json` holds all of it. It
names each case once, under `cases`, ordered by test file, title and id, and
each changed region lists the cases that entered it under `called` by their
place in that list, so a change that moves most of a suite weighs its regions
plus its cases, not one times the other. The places hold within one file only:
to compare two reviews, match cases on `id`. A region's test files are those of
its cases, so the file leaves them out. `version` names the shape, `2` for this
one. Upload the `--out` directory as an artifact, and anyone with the GitHub
CLI can print the whole review in their own terminal:

```bash
variance review --from-run https://github.com/acme/shop/actions/runs/36531792356
```

`--from-run` takes a run id or the URL of a run or one of its jobs. It runs
`gh run download` for the artifact `variance-review`, or the one `--artifact`
names, and prints the `review.json` inside in the format asked for. It reads
one written before `version` too, and one larger than a single string holds, a
member at a time. The review
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
    checkout  e2e     3,832 → 3,900  80.0% → 81.0%  +51 newly run · −2 no longer run · +19 run in 22 added regions
    stories   visual  1,437 →   718  30.0% → 14.9%  −716 no longer run · −3 no longer run after a case stopped
    unit      unit    3,353 → 3,352  70.0% → 69.7%  +4 newly run · −9 no longer run · +4 run in 22 added regions
  stories: src/checkout.stories.tsx no longer runs 212 functions in 9 files (716 regions) at the base
  unit: src/checkout/total.test.ts no longer runs total in src/checkout/total.ts (3 regions) at the base
```

Each part is signed by what it does to the count. `newly run` and `no longer
run` are regions whose cases changed, the `gained` and `lost` of
[What a change moved](#what-a-change-moved); `no longer run after a case
stopped` is its `hidden`. `unmeasured` regions lost a case of a test that has
not run since the region's file changed, so they are not counted as no longer
run. `added regions` and `removed regions` are regions
only one of the two records has, in a file both have, and `newly loaded files`
and `files no longer loaded` count the files only one of them has. `run by
fewer cases` is unsigned, because those regions still run. The signed parts add
up to the change in the count, and the markdown says so when they do not. The test files whose regions changed most
are named under the table, up to three that stopped running regions and three
that started, each with the functions its moved regions sit in, file by file,
or a count of them when there are more than four; a count says how many test
files were left out, and `--format json` lists every one.

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

A package at 100% can be run entirely by the tests of the packages that import
it. Split a component into three files and move two of them to a shared
package, and the coverage stays where it was while the shared package has no
test of its own. So `--packages` also counts each package by whose tests ran
it:

```text
which package's tests ran each package
                 ran    own tests  only others'         by
  packages/cli   8,020  100.0%     0             0.0%
  packages/help  2,069  88.9%      229           11.1%  packages/cli 229
run only by other packages' tests
  packages/help/src/  229  packages/cli 229
    tools/            210  packages/cli 210
      uses-of.ts      32   packages/cli 32
      uses.ts         28   packages/cli 28
```

A region is the package's own when one of the package's tests ran it, whoever
else did too. A region that only other packages' tests ran is counted apart,
under each package that ran it. The tree walks the five packages with the most
such regions down to their files, largest first, so the first file named is the
first place to ask whether the package needs a test of its own. A region a test
entered only while its module loaded counts for no package, and test files are
left out. A package here is a row of the table, and a file belongs to the
deepest one that holds it, so a suite kept at the repository root belongs to
`.` and everything it runs elsewhere is another package's. `--format json`
lists every file under `ownership`.

Owning a region is not the same as testing it closely. A package's own
integration test can reach a helper four imports down, and an import chain can
run inside one package as easily as across two. `--at-distance <hops>` counts
each region by the nearest test that ran it, in any suite, in the band
`covering --at-distance` takes:

```bash
variance coverage --at-distance 0-1
variance coverage --at-distance 2-
```

```text
coverage at 818a2cec — 40,331 regions in 1,159 files the suites loaded, counted where the nearest test that ran the code is 0-1 import hops away; 2,204 regions run from no measured distance, in no band
  any suite                   24,163      59.9%
coverage at 818a2cec — 40,331 regions in 1,159 files the suites loaded, counted where the nearest test that ran the code is 2 or more import hops away; 2,204 regions run from no measured distance, in no band
  any suite                   10,100      25.0%
```

A test's own file is `0` hops from it and a module it imports directly is `1`,
walked over the modules the test entered. A region counts under `2-` only when
no test ran it from closer, so the bands split what ran: here 24,163, 10,100
and the 2,204 no walk placed add up to the 36,467 regions run with no band.
Within a band, only the crossings of the tests in it are kept, so `--packages`
under `--at-distance 0-1` names the regions only another package's near tests
ran. The band also composes with `--from`. A test file the graph does not hold
is left out of every band and counted in the heading, and so are the regions
only an unplaced walk ran. The hops are measured on the import graph of the
tree as it is now, so no suite is compared with its base under a band, and each
says so.

`--packages` also counts each suite in and out over the same regions. A region
is in when a test of its own package ran it from at most one import hop, and out
when any other test ran it: another package's, or the package's own from
further away. Out and never in is accidental coverage, and in is earned:

```text
in: its own package's tests within one import hop ran it · out: any other test did · accidental: out, never in
               regions  in             out            accidental
  chromium     29,797   466     1.6%   5,642   18.9%  5,408       18.1%
  integration  29,788   1,365   4.6%   6,109   20.5%  5,496       18.5%
  unit         39,849   23,596  59.2%  27,157  68.1%  11,971      30.0%
  any suite    40,368   24,145  59.8%  28,455  70.5%  12,347      30.6%
  2,204 accidental regions ran only under tests at no measured distance
```

In and out are separate coverages, so each can reach 100%: a passing end-to-end
suite runs everything out, and the unit next to each file runs it in. They
assume the farther a test is from the code, the less it is about that code;
whether it checks what it ran is for mutation testing to say. A hop is any
runtime import, a re-export or a helper as well, and `--at-distance` leaves in
and out counted over every test. A test no walk placed is
never in, and the regions only such tests ran are counted on the last line.
`--format json` carries the counts under `earned`, per suite and joined.

`--fan-in` counts how many test files called into each region, for every file
at once. A test file counts once per region however many of its cases ran it,
and a case that ran a region only while its module loaded does not count, so an
edit runs at least these; `covering --file` names the rest:

```text
test files that called into each region
               test files  regions ran  one test file         median  p90  max
  e2e          55          5,871        2,894          49.3%  2       14   39
  integration  83          6,866        3,174          46.2%  2       11   54
  unit         1,001       35,729       9,983          27.9%  3       25   453
```

Three lists of ten files follow: the most regions only one test file ran; the
most test files called into the file, as a share of the suites that recorded it
and of their time, and per kind; and the files whose test files exceed their
median region's by the most: the most a split could save a selection by file,
since a split file still sends every test file that called into either part.
None has a threshold. Under `--at-distance` the counts read only the band. `--format json` lists
every file under `fanIn`. For one file or line, `covering` names the tests.

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

A `remote` store's baselines are not commits, so its history is the record the
deployment made when a reviewer approved them. `variance changelog` reads it
from the deployment with your share token, which reads what review settled and
never decides; declare the share as
`{ "kind": "http", "endpoint": "<deployment>/share", "token": { "env": "VARIANCE_SHARE_TOKEN" } }`.
The same filters narrow it, `--since` takes an instant there rather than a
revision, and `--limit` caps how many approvals are read. Each change reads in
the columns above, with the builds that carried it and who approved it.

Three failure modes are handled explicitly:

- **git missing, no repository, or an unresolvable revision** each exit `2`
  with a message, instead of printing an empty history that looks the same as
  "nothing has changed since the last baseline."
- **A shallow clone bounds what can be read.** CI checkouts at depth 1 see one
  commit; the output prints a `note:` saying what it could not see.
- **A project that keeps no baselines is refused by name.** Under `ephemeral`
  retention there is no baseline to explain, and an empty history would read
  as a broken writer.

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
variance journeys --file app/src/components/CartCard.tsx
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
of its own that nobody in the pool covered at all. `--file` narrows to the one
module at that path in the checkout, `--limit` caps how many modules are named, and
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
`--embed-images` and it carries the pictures its cards show:

```bash
variance report --format html --embed-images > variance-report.html
```

One file then opens anywhere. On GitHub Actions, upload it
with `actions/upload-artifact@v7` and `archive: false`, and the artifact link
opens the page in the browser instead of downloading a zip.

The file grows with the subjects that changed. An unchanged subject carries no
picture, because the page shows no card for it. A full page is carried whole, so every card keeps its wipe, blend, blink and
trio, unless it is longer than 16,384 pixels, the largest image Chromium draws
in one piece, and its run cut a change picture. Such a page is carried as that
crop, and its card names each full page it leaves out, with its size. Those
pages stay beside `report.json`, so the run's artifact still holds them.

Every subject's card comes first in the file, then the picture each card opens
on, then the pictures behind its other views. You can filter, read regions and
copy commands while the pictures are still arriving, and every card's change is
on screen before any card's other views have loaded. Each picture keeps its
place at its own size before it arrives, and stays text until a view near the
screen shows it, so opening the page decodes only what you are looking at. The
page's script turns each carried picture into an image, so a viewer that runs
no script shows the cards without their pictures. The command writes the page
as it goes, one picture at a time, so its memory does not grow with the run.

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
[unstable] story:case-surface--ticking: … Clock cases/storybook-case/src/ds.jsx:118 read differently
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
`coverageFile`, and the job uploads it as an artifact with the runs record the
seam writes beside it, `coverage.runs.json` beside `coverage.bin`, which names
the install the shard ran on — and every question anybody asks is about the
suite. Name them all and `journeys` folds them into
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

For a CI job that only combines records, `journeys combine` writes the one
record an unsharded run would have written, and nothing else:

```bash
variance journeys combine shard-1/coverage.bin shard-2/coverage.bin \
  --into artifacts/coverage.bin
```

```
journeys: combined 2 records into artifacts/coverage.bin (342 tests, 1204 modules, 51873 crossings, 2210 cases, recorded at 4f2a1c9d0b73)
```

It reads the shards and nothing else: no configuration, no checkout, no
source index. The output is the same bytes whatever order the shards are named
in. `--into` names a new file: a path that is already there, a shard among
them, is refused, because combining over a record would discard it. To lay the
shards over a record that is already there, name it to `journeys` instead:
`variance journeys <shard.bin>... --into <record>`. Paths resolve from the
working directory. Landing the combined record, in this checkout or another,
is `journeys`'s; the rules below apply to both commands, because `journeys`
combines its shards the same way and lands the result as one.

Each test file keeps the duration its shard measured: a test file runs in one
shard, and a file two shards recorded is refused below. A shard that recorded no
test files changes nothing, whatever commit or recipe it names.

The fold refuses shards that were not one run, naming both files: recorded under
different probe recipes, or at different commits — and a shard recorded outside
a checkout names no commit, which is a disagreement rather than a blank. A test
file two shards both recorded means the split overlapped, which only the
operator can resolve. A module one shard could not instrument is answered by the
shards that did: that row records that one build could not read the module, and
is no evidence about the tests another build watched run it.
Shards whose selection read two records fail the build, naming both. A shard
whose record names that read `unknown`, as a JVM shard's does, is combined
without that check, and the output names it.

The cases are refused by the shard that holds them, with what to do. A test
file whose cases two shards both ran names both shards: two runs of one file's
cases cannot both be the suite's, so you combine only one of them. A case index
this build cannot read, the row spelling of older versions among them, is
recorded again with this version. A case whose lines stand on a file two
shards cut into different regions is refused, because its lines name regions
by their order; record every shard with one build. Two shards that hold
different Eyes journals for one attempt of one case, or a journal of a case
the combined index does not record, are refused by name. Shards that started
from different records fail the build: each record names the record its run
was laid over, or none, and shards that name two, that stand on before layers
at different commits, or that stand on one file at different text, each split
the suite against another plan, so a test may have run in no shard. The
message names the shards and their records, says nothing of the build is
combined and the record before it stands, and names what starts shards alike:
every one restoring the same cached record. A shard that names no record at
all, as one an earlier version wrote, is not combined either: nothing in it
says where it started.

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
A shard keeps no cases when its seam recorded none, and one that kept cases
beside one that kept none is refused, because their combined record could
answer for the cases of only some of its files. If another run is writing
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
variance select
```

```
source index updated: 2215 files, 0 read again, at <cache>/test-selection/<digest>/source-index.bin
code map: 71 packages in 16 areas, 2 deep, over 8 dependency layers
journeys, suite unit: 5718 cases walked; a caller is found for 216327 of the 253543 functions they ran (85%); 8895 calls, 204 package flows; 2 imports the index did not resolve were resolved by the walk
dependency lexicon: 213 workspace-dependency pairs, 309 public entrypoints, 213 reused, 167 unavailable, at <cache>/test-selection/<digest>/dependency-lexicon.bin
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
cannot reach. A Vitest or Jest config wrapped by `withTestSelection` reads the
same answer when you set `VARIANCE_AUTHORITY_SINCE`, and the runner drops those
files itself, with no path on its command line:

```bash
VARIANCE_AUTHORITY_SINCE= vitest run
VARIANCE_AUTHORITY_SINCE= jest
variance select              # the same reading, printed
```

[The seam's own page](https://variance-authority.dev/reference/packages/sense#let-the-runner-skip-them) says what
the run prints and when it does not select.

The journal is what [`@variance-authority/sense`](https://variance-authority.dev/reference/packages/sense) wrote the
last time that suite ran: its seams record Vitest, Jest and Rstest, and
[`@variance-authority/sense/runner`](https://variance-authority.dev/reference/packages/sense#record-a-runner-this-package-has-no-seam-for)
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
path. `--format plain` writes one path per line, relative to the repository,
for a runner with no seam. `vitest` and `jest` are deprecated, and say so on
stderr: a large selection outgrows a command line, which the variable never
touches. `vitest` writes `--exclude=` arguments naming each file's absolute path, because
a workspace is many projects and a project matches an exclude pattern against
its own directory rather than the root the journal counts from; `jest` writes
`--testPathIgnorePatterns=` arguments and re-states jest's `/node_modules/`
default, which that flag would otherwise replace.

`--format json` is for a program that decides for itself, such as a CI step or
an agent, and it says why each test file runs. `ground` names the reading:
`read` when the record answered, or the reason it could not: `no-journal`,
`no-coverage`, `no-diff`, `no-install`, or `before` when the diff moved what
the suite rests on, with the changed files under `rests`. `widened` is present
whenever every test file runs, under `read` too when the record holds no whole
observation. When the record narrowed, `selected` lists each test file the
change reached with the positions of its reasons in `reasons`, which names each
reason once however many test files it selected. A reason is a changed
`region` the test file entered, a changed `precondition` it declared, a
`reader` of a value the change moved, or an `importer` trail from a changed
file the record did not measure to the file whose tests answered for it. A
region of a file under `install.files` is one a bump or a moved manifest made
the reading treat as changed whole, which the diff never touched; `through` is
the chain from the bumped package. A journey file names the tests it reached
and not why, so a reading of one carries neither list. `incomplete`, when the
record keeps one, lists the recorded test files whose observation was not
whole, which run whatever changed. With `selected` present, a test file in no
list is one the record never saw, and runs too. An excerpt:

```json
{
  "ground": "read",
  "skip": ["test/alpha.test.ts"],
  "reasons": [{ "kind": "region", "file": "src/pad.ts", "name": "pad", "path": "pad", "startLine": 1, "endLine": 3 }],
  "selected": [{ "test": "test/beta.test.ts", "reasons": [0] }],
  "incomplete": []
}
```

A failure near the change comes back sooner when the nearest tests run first.
`--at-distance <hops>` cuts the selection to one leg, the selected test files
that many imports from the change, and adds the rest to the skip list. Run
`0-2`, then `3-`, and every selected file runs in one of the two:

```bash
VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=0-2 vitest run
VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=3- vitest run
```

A leg is still a skip list. A selection that declines to narrow skips nothing
in any leg, and a test new since the recording is on no skip list, so it runs in
both. A test the change entered by no import it executed has no hop count, and
runs in the *end leg*: the one leg that holds the furthest hop measured, so
`0-2` is the end leg when something is placed and nothing past two hops, and
`3-` then is not. With nothing placed, the end leg is the *open leg*, the one
with no upper bound, such as `3-`. A test recorded incomplete, such as one a
partial run over an edit left, that the change did not enter, is placed by the
shortest import path it ran to a changed file it loaded, and runs in the leg
its hops fall in. With no such path it runs in the open leg only. stderr counts
the entered tests at each hop count and names the leg that runs those with
none, counts the incomplete tests this leg runs because of their path to the
change, and names how many selected files the leg left and the command that
runs them. `--format json` gives the leg as `leg`, those files as `left`, and
each entered or placed test's `hops`, `bearing` and, where no distance was
measured, `because`, as `distances`.

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

A changed lockfile is compared as an install, from the install the suite ran on
to the one in your tree. A recording keeps the lockfiles and manifests that
differed from its commit while it ran, so an install you had not committed yet
when you recorded is the one compared from, and selecting over it with nothing
else edited skips the whole recorded suite. A test keeps that install after you
commit and run only the selected tests: it is compared from what it last ran
on. Shards landed with `variance journeys <shard>...` ran on the install every
shard's runs record names. Where a shard came without its runs record, or the
shards ran on different installs, no install was kept. Where no install was
kept, tests are compared from the commit they last ran at. Where the kept texts
are not in this cache, they are compared from that commit too, and stderr names
each such commit: a shard keeps the texts of its install in the cache of the
machine it ran on, so shards that ran over an uncommitted install elsewhere are
compared from their commit. A suite that ran with its
lockfile deleted has no install to compare, and stderr says it ran without one.
Every package the lockfile resolves differently is walked back through the
packages that depend on it to the files that import them, and those files are
read as changed whole. stderr names the lockfile, the packages, the package
most of each one's files imported it through and the files, and `json` gives
the lockfile, the packages, the moved manifests and the count of files under
`install`:

```
$ variance select
skipping 13 of 198 test files recorded whole: none covered a changed line or
entered a file the install moved; every other test file runs.
pnpm-lock.yaml resolves 1 package differently than at c921284daa53 (tinyglobby
through vitest), so 185 files importing it (src/a.test.ts, src/b.test.ts,
src/c.test.ts and 182 more) were read as changed whole.
```

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
git diff origin/main | variance select --execution journeys.bin --diff -
variance select --execution journeys.bin --diff change.patch
```

Without `--diff`, the change is `git diff` against `--since`, or `HEAD` when you
give no ref. The change does not have to come from git history: a replayed
commit, a synthetic patch and an edit nobody committed are read the same way.
Run it from the repository root, because the file names paths relative to it.

The change has to be a patch, because a journey file selects by changed lines.
A list of paths from `git diff --name-only` is refused: it can only be answered
by the import graph, and that is [`reach`](#reach-what-a-diff-reaches-for-a-pipe).

- **A changed line.** It goes to the innermost function or branch holding it,
  and only the test files whose cases entered it run. A line that opens one, such
  as `if (ready) {`, goes to the code around it as well, because every case that
  evaluated the condition ran that line. These are the tests `variance covering
  --line` names for it.
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

### `shards`: how many CI jobs a suite is worth

A Vitest or Jest config wrapped by `withTestSelection` places the files of
`--shard k/n` by the time each took on the last recorded run, so the shards
finish close together; [sharding](https://variance-authority.dev/docs/sharding) shows a build that
does it. `variance shards` says what `n` to start, from the same record and
what one shard spends before its first test:

```bash
variance shards --suite unit --setup 90 --workers 8
```

```text
2 shards, the last done 335.2 s in: 90.0 s of setup and up to 1629.5 s of tests each, about 245.2 s on 8 workers.
From 782 test files, 3259.1 s in all, recorded at 789bdbddee97.
More shards finish no sooner: packages/sense/src/test-selection/journey-trace.integration.test.ts alone takes 245.2 s.
```

Every shard is charged its `--setup`, and the count is the one whose wait and
setups come to least, so a shard is added only when it shortens the wait by more
than it spends. Without `--setup` the count weighs no setup, and the answer says
so. `--budget <seconds>` asks instead for the fewest shards whose last
one finishes within it; a budget no longer than `--setup` is out of reach at any
count, and the answer is the count that finishes soonest, naming the setup as
the reason. Either way the count stops at the slowest test file,
which no shard can finish before; the answer names it, and its slowest case when
the run kept its cases. `--workers` is how many files one shard's runner runs at
once.

`--since <ref>` leaves out the files that change lets the run skip, as the seam
does under `VARIANCE_AUTHORITY_SINCE`, so a change that reaches no test answers
`0 shards`. Pass `--collected <file>` with it, the runner's list of the suite's
test files, as `share --collected` reads it: the record holds only the files it
has seen, and a file on the list it has not is priced at the median of the timed
ones. Without the list, only recorded files are counted, the answer says so in
`notes`, and a change that skips every one of them answers `1 shard`, with `why`
set to `unlisted`, for whatever it adds. `--at-distance <hops>` counts one leg of that selection, as `select
--at-distance` cuts it: a near wave under `VARIANCE_AUTHORITY_AT_DISTANCE=0-2`
is counted with `--at-distance 0-2`; without `--since` it cuts nothing, and the
answer counts the whole suite and says so. Without `--since`, only the recorded files
are counted. With nothing recorded the answer is `1 shard` and says so, unless
`--unrecorded <n>` names the count to start until it is, and starts one when it names none. `--format json` prints the count, a `matrix` of
`k/n` strings, each shard's load, and why, with `notes` naming anything the
count could not weigh. A pull request's build can start its
matrix from it; the push to your mainline runs without `--since`, so its shards'
records fold into the one the next build is placed by, as
[sharding](https://variance-authority.dev/docs/sharding#start-only-what-the-change-needs) shows:

```yaml
# a pull_request workflow
plan:
  outputs:
    shards: ${{ steps.count.outputs.shards }}
  steps:
    - id: count
      run: |
        set -o pipefail
        npx vitest list --filesOnly > "$RUNNER_TEMP/collected.txt"
        shards=$(npx variance shards --suite unit --setup 90 --since origin/main --collected "$RUNNER_TEMP/collected.txt" --format json | jq -c .matrix)
        echo "shards=$shards" >> "$GITHUB_OUTPUT"
test:
  needs: plan
  if: needs.plan.outputs.shards != '[]'
  strategy:
    matrix:
      shard: ${{ fromJSON(needs.plan.outputs.shards) }}
  steps:
    - run: VARIANCE_AUTHORITY_SINCE=origin/main npx vitest run --shard ${{ matrix.shard }}
```

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

### `collect`: the suite index without a visual run

The suite index says which subject renders which component, at which landmark,
declared in which file. A `run` writes it as a side effect of comparing pixels;
`collect` writes it with no baseline, no comparison and no image, so a suite
that never takes screenshots still gets an index an agent can look subjects up
in.

Each CI job collects its shard into a part, and one more job merges the parts:

```bash
variance collect --shard 1/4 --workers 2 --out evidence-1.json   # and 2/4, 3/4, 4/4
variance collect merge evidence-*.json --out suite.index
```

`--workers` counts browsers per job, not per suite: four shards with two
workers each open eight browsers at once. A shard splits the plan the way
`run --shard` does, so a shard that owns no subjects still writes a part, and
the merge can tell it from a missing one.

Every part records the plan it split, the build it read (the Storybook build's
digest, the commit, and every source file under `source.dirs` as it is on
disk, uncommitted and git-ignored ones included), the config that shaped the reading, and an outcome for every subject it
owns. The merge refuses parts that disagree on the plan, the build or the
config, a missing or repeated shard, sharded and unsharded parts together, and
a subject no part accounts for, and says why: by the part or the shard when
one is to blame. The index it writes is the
same whatever the shard count or the order you name the parts in.

A subject that failed to render keeps the index at `--out` as it was: the merge
writes what the parts hold to `<out>.incomplete`, names each failed subject
with the command to collect it again, and exits `2`: `variance collect --shard
k/n` for the shard that owns it, or `variance collect` when the collection was
not sharded. The parts stay where they are, so you collect only that part again
and merge.

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
- **File count decides when nothing was recorded.** Every file weighs the same
  and is placed by the same rule, ties broken by path and then by the lowest
  shard, so the shards differ by at most one file. Adding a file can move
  others: the placement is a function of the whole plan.

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

It publishes nothing, and says why, when a report has no part beside it, a
part cannot be read, a shard is missing or given twice, or an unsharded run is
named with shards or beside another unsharded run. An unsharded run publishes
its own index and needs no merge.

The lookup is the same one the [suite index](https://variance-authority.dev/docs/sharing#looking-up-mainlines-record)
uses, and every shard of one build reads the same line, so they place alike. A
checkout with no share, or a line that holds no costs, places by file count.

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
exactly the case where there is no body to read it out of. It names the config's
`project`, so two configs gating one pull request keep a comment each. Exit `0`
means *this rendered*, never *the run was clean* — the verdict belongs to `run`,
which already decided it.

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
  `costs` from the share; without them each file is placed by count.
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
  checkout, `layMainline(root, mainline, instrumentation)` copies the record,
  which carries its cases, into the checkout's own layer, with that runs record
  as a seed that lists no run, so the run the job makes lands on them, as a cache
  restore would. `instrumentation` is the probes that run records under: a
  record written under other probes is not copied, because no run could be laid
  over it, and comes back as `passed`, which `mainlinePassedOver` prints. Pass
  `undefined` for a landing that lays no coverage. `env` stands in for
  `process.env` when the line is read, and `cacheRoot` for the cache. After the
  shards ran, `landSuite(cwd, shards, suite)` lands their records on
  `suite`'s record in the checkout, as `variance journeys <shards> --suite`
  does, and returns what the landing said without the reading, for a CI fan-in
  that folds the record for the jobs after it.
- `recordedExecutionFile(root, suite)` names the record `distill`, `covering`
  and `review` read for a suite, and refuses as `unrecorded` when no run kept
  its cases. A script that reads a record with the sense readers starts here,
  so its counts are the ones the CLI prints.
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

### Where a run spent its time

Each observation in the report carries `steps` beside `costMs`: every phase the
subject went through, in the order it ran, with its wall time in milliseconds.
The collector's phases come first under `collect.` (`collect.navigate`,
`collect.wait-for-fonts`, `collect.capture`), the run's own follow
(`inspect`, `settle`, `baseline`, `decode`, `compare`, `write`), and a painted
subject adds the renderer's under `render.` (`render.load`,
`render.screenshot`). A phase the subject skipped is absent, not zero: a settled
subject has no `decode`. A route read's `collect.transfer` is the remainder: the
read's time less the steps the page timed itself, so it holds the crossing from
the page and anything the page did not time. A settled route subject, with its
steps cut to five:

```json
{
  "subject": "docs/reference",
  "verdict": "unchanged",
  "costMs": 452.4,
  "steps": [
    { "step": "collect.navigate", "ms": 50.6 },
    { "step": "collect.capture", "ms": 63.5 },
    { "step": "collect.normalize", "ms": 53.3 },
    { "step": "inspect", "ms": 0.8 },
    { "step": "settle", "ms": 2 }
  ]
}
```

The report's `steps` sums each phase over the subjects that ran it and counts
them, and `workers` says how many worlds collected side by side. With more than
one, a phase's total is subject time, not wall time: it can exceed the run's
duration, and each span includes what the other worlds cost it. Timings are
part of no digest, so two runs that differ only in timing write the same
images, records and baselines.

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
| `timezoneId`, `locale` | the IANA timezone and BCP 47 language the collectors read in and the renderer paints in; `UTC` and `en-US` when unset, never the host's. Part of the render identity, so changing one names the moved pair as the cause of every change until it is accepted again |
| `concurrency` | how many subjects may be rendered and compared at once, split evenly across the worlds and rounded up, so at least one per world |
| `workers` | how many browser worlds one run collects in; half the machine's logical cores when unset, never more than a `concurrency` you set and never more than there are files. Each world collects one subject at a time; a world that finishes takes the next file from a shared queue, longest file first. A collector without `openWorker` collects in one world, and the run warns when you set `workers`. Set `1` when the server under test cannot take concurrent pages. The report records the worlds it used in `workers` |
| `intent` | the default `--intent` label |
| `suites` | each test suite the repository runs, and its kind: `unit`, `integration`, `e2e` or `visual`. Each suite records on its own. Read only from the file at the repository root, as the [execution record](https://variance-authority.dev/docs/execution-record#one-record-for-each-suite) page describes |
| `tiers` | line budgets, largest first, that `variance layers` places each package in by how much code it pulls in, and that a `maxTier` rule in a `.relations.json` names. Tier 0 is the first entry and has no limit. Read only from the file at the repository root; see [tiers](https://variance-authority.dev/docs/boundaries#tiers-say-how-much-code-a-package-pulls-in) |
| `typescript.tsconfig` | which `tsconfig` decides where an import resolves: `"auto"`, the default, reads the config that governs each file; a path from the repository root reads that config and the projects it references; `false` reads none, so no `paths` and no `customConditions`. `variance doctor` names the configs in the repository that add conditions, map `paths` or set `baseUrl`, and suggests `false` only when none does. Read only from the file at the repository root |
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

`variance share --suite <name> --format github` prints `commit=<sha>`, the
commit the mainline's record of that suite was made at, and `commit=` when the
mainline has none; the `record of "<name>":` line goes to stderr. A pull
request merged with that commit, rather than with the base tip, is measured
from the record alone:
[Sharing](https://variance-authority.dev/docs/sharing#a-pull-request-that-runs-the-mainlines-changes-too)
has the steps.

With a config, `--format github` also prints `project=<segment>`: the config's
`project` as one path segment that a git ref and an Actions artifact name both
take. Every UTF-8 byte but a letter, a digit, `_` or `-` is written as `%XX`,
so `@acme/web` stays one segment and `a b` stays apart from `a-b`, and a project
holding a lone surrogate, which has no UTF-8 bytes, is refused. The composite
action names its report page artifact and its images ref with it, and
`variance comment --marker` spells the project the same way.

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
variance comment --config variance.config.json --marker
```

That prints the invisible marker the rendered body embeds, and nothing else. It
names the config's `project`, so each config's poster finds its own comment.
Finding a previous comment by it and updating that comment — rather than adding
one per run — is the whole of the "one comment, updated in place" rule; on
Bitbucket that is a `GET` of
`/2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments`, a search for
the marker in `content.raw`, and a `PUT` to the one that has it or a `POST` if
none does. A docket rendered before the marker named its project carries
`<!-- variance-authority: pr-docket v1 -->`: the poster of the gate that wrote
it takes a comment carrying it over, when none carries its own marker, and keeps
an open pull request at one comment through the upgrade. A gate that never
commented before leaves it alone, because it is another gate's docket. The
composite action above does the same steps against GitHub's API, and adopts the
old marker the same way unless `adopt-unkeyed-comment` is `'false'`.

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

`--image-root` puts pictures in the comment: the leading cause's change on the
first screen, and each further cause's in the fold. The change is the
`change.png` a run writes beside a subject's diff: each of the largest changed
regions with the rows around it, before beside after, at one image pixel per
pixel. Each row sits level with the row it became, with striped filler opposite
rows only one side has. Every window is the same width, framed, under the
subject's name and a label per column: `Before` the baseline, `After` this run.
What changed is washed in red on the before and green on the after, and a blue
arrow between them runs beside rows that only moved; a blank gap or
plain box whose height changed is marked there too, with a line across it. A subject with no region to crop shows
its whole before and after instead. Give it
the address you published the report's directory under. The comment joins each
image path the report records to it, with every segment percent-encoded, so the
file `images/story%3Abutton.before.png` is asked for as
`images/story%253Abutton.before.png`. On GitHub, a commit's `raw` address works,
`https://github.com/<owner>/<repo>/raw/<sha>`, and the composite action's
`image-ref-prefix` input publishes one.

## Integration troubleshooting

| Symptom | What it means | Next check |
| --- | --- | --- |
| Exit `2` before any docket | The run failed operationally rather than finding a reviewable change. | Run `variance doctor` in the same environment; then inspect browser, collector, renderer, and store diagnostics. Do not suppress this with `|| true`. |
| Every subject is `new` after changing browser or renderer settings | The environment identity changed, so old and new images are intentionally partitioned. | Confirm the engine, viewport scale, fonts, and stabilization inputs. Establish new baselines only when the identity change was intended. |
| A planned subject is absent from the report | Coverage accounting failed; a complete run must account for observed, excluded, or failed subjects. | Inspect collector failures and, for shards, verify the subject globs cover the whole plan without overlap. |
| HTML report images are broken | Image paths are relative to the JSON report. | Upload or move the HTML report together with its report and image directory, or write it with `--embed-images` so it carries its pictures. |
| A ready selector times out | The collector opened the subject but its project-owned completion marker never appeared. | Check the collector module's id-to-selector map; do not replace the marker with an arbitrary sleep. |
| A clean pull request has no comment body | This is expected. `variance comment` emits an empty body for a clean report. | Keep the CI gate on `variance run`; let the posting integration delete or skip its prior comment. |
| A merged shard report is refused | The shards did not describe one compatible run or observed the same subject twice. | Align renderer identity, retention, and intent, then make the subject globs disjoint. |
| A change is green but reported as `ignored` | Differences existed and declarations absorbed all of them. | Read the ignore and sensitivity registers; `ignored` is intentionally distinct from `unchanged`. |

---

**[@variance-authority/cli](https://variance-authority.dev/reference/packages/cli)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · [GitHub](https://github.com/Variance-Authority/variance-authority/tree/main/packages/cli) · MIT
