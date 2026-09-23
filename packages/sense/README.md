<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/sense

> Which components and tests a source change reaches: test selection and impact analysis from a versioned index of a checkout.

Part of [Variance Authority](https://variance-authority.dev).

Use this package to cut a test run down to the files a diff can actually affect.
It adds probes to your product source while your tests run, records which test
file covered which region of which module, and later answers a unified diff with
the list of test files that provably did not go near it. Wrap your runner
configuration once; you get back a list of paths to skip and hand the rest to the
runner yourself.

It answers four questions:

- Which test files covered the source regions a diff touches, and which can you
  skip?
- How far did the change travel to reach each of those tests, so you can run the
  near ones first?
- Which files and components can a changed file reach, from a scan of the
  checkout alone?
- Which named test cases covered a given function or line — the query an editor
  or a coding agent asks.

The first three work today from a wrapped runner. The fourth needs a recording
made with `cases: true`, which every host this package reaches writes —
[what each one gives the recording](#what-each-host-gives-the-recording) is one
table.

Skip this package if your tests run somewhere it cannot instrument, or if you
need to exclude individual test cases rather than whole files: selection returns
test *files*, and the runner still collects and executes every case inside each
one.

```bash
npm install --save-dev @variance-authority/sense
```

Node 22.15 or newer. Vitest is the only declared peer dependency
(`^2.1.9`, optional) — install it yourself if you use the Vitest seam. The Jest
seam is built and tested against Jest 30 and declares no peer, so your own Jest
is the one that runs. Storybook and Playwright come from sibling packages
rather than from here, and are covered below.

## Cut a Vitest run down to a diff

Wrap the configuration once. `withTestSelection` keeps your plugins, setup
files, and reporters, and adds instrumentation, collection, and persistence.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { withTestSelection } from '@variance-authority/sense/vitest';

export default withTestSelection(
  defineConfig({
    test: { include: ['src/**/*.test.ts'] },
  }),
);
```

Run the suite once as you normally would. That run writes a **snapshot**: a
binary record of which test file covered which probed region of which module.
Then ask it what a diff can skip:

```ts
// select.ts, in a package with "type": "module".
// Run it with your own TypeScript runner, or drop the types and run it as .mjs.
import { readFile } from 'node:fs/promises';
import {
  changedLines,
  narrowByExecution,
  testCoverageFile,
  textAtRecording,
} from '@variance-authority/sense/test-selection';

const root = process.cwd();
const diff = await readFile('change.diff', 'utf8');

const { whole, entered, unread, stale } = await narrowByExecution(
  testCoverageFile(root),
  diff,
  { sourceAt: textAtRecording(root, changedLines(diff).keys()) },
);

const reached = new Set(entered);
const skip = unread.length > 0 ? [] : whole.filter((test) => !reached.has(test));

console.log(skip.join('\n'));
```

Produce `change.diff` with `git diff <base> HEAD > change.diff`, or any unified
diff over the same checkout. Hand the runner every test file it would have run
**except** `skip`.

Ask for the skip list rather than the run list. A snapshot can only ever justify
*exclusions*: a run list has to be right about every test that exists, while a
skip list only has to be right about the tests it names, and a test it wrongly
leaves out of the skip list costs a test run rather than a missed regression. A
missing snapshot, a snapshot from another machine, and a first run all leave
`whole` empty, so `skip` is empty, so the suite runs.

### What each field means

- `whole` — the tests whose observation was complete. A test in `whole` and not
  in `entered` is one the record positively proves this diff did not reach.
- `entered` — the tests the diff reached. Never read an empty `entered` as "run
  nothing": *this diff reached nobody* and *this snapshot recorded nobody* are
  opposite facts, and `whole` is the only thing that separates them.
- `unread` — changed paths the record says nothing about. Non-empty means the
  snapshot was never asked about some changed path, so it cannot have charged
  anyone for covering it. Clear the skip list and name the paths, so the
  operator knows the suite widened and why. The guard in the sample above is
  this, and it is not optional.
- `stale` — modules whose text on disk no longer matches what their rows were
  recorded over. A report rather than work: a stale module is already charged
  whole inside `entered`. It comes back empty unless you pass `sourceAt`,
  because nothing looked — which reads exactly like frames that agree.
- `because` — one entry per selected test, in the order of `entered`, listing
  every reason it is there: a `region` (file, name, path and lines of the
  innermost recorded block a changed line fell in), a `precondition` by name, or
  an `importer` with the trail from the changed file to the file the test was
  found through. Print it beside each path a watch loop runs.

`selectTestFiles` returns `entered` alone, for a caller that has established the
second half some other way.

## Where the snapshot lives, and when it is rebuilt

`withTestSelection` writes outside your checkout by default: the coverage data
a run records is operational state rather than source.

```text
${XDG_CACHE_HOME:-~/.cache}/variance-authority/test-selection/<digest>/coverage.bin
```

`<digest>` is taken from the checkout's absolute path, so two checkouts never
share bytes. `testCoverageFile(root)` returns that path, and
`sourceIndexPath(root)` the scan cache beside it. A git worktree gets
`.work/<its own digest>/` beneath the primary checkout's directory: it reads
both layers and writes only its own, so a worktree cut this morning inherits
what the repository already recorded. Pass `coverageFile` in the options to put
it somewhere you name instead — a CI job that uploads the file as an artifact
wants that.

**Built** as a side effect of a wrapped run: every test file writes a journal,
the reporter folds them when the run completes, and the result is landed over
whatever was there before. There is no separate build step and no `test:since`
command — this package records evidence and answers questions about it; the
caller owns the inventory of current test files and the dispatch.

**Cached in CI** by caching `~/.cache/variance-authority` whole and restoring it
to the same absolute checkout path it was written from. Nothing about the branch
or the commit belongs in the key for correctness, but vary the key anyway so
each job writes a new entry and starts from the newest one that exists.
[The source index](https://variance-authority.dev/docs/source-index) gives the
worked cache configuration; the same rules and the same directory cover the
snapshot.

**Retired** per test file rather than wholesale. Each test-file observation
records the identities of its own source, its configured setup, and any
additional preconditions. Changing one of those starts a new **generation** for
that file — its current batch of crossings against one fixed set of
preconditions — and the inherited crossings are retired. An inherited module
whose text on disk no longer matches its rows has rows no diff can be placed
in, so every test that covered it is marked partial and runs at the next
selection. An observation is complete only when every leaf task in its file
passes; a focused, skipped, or failed run is partial, contributes its
crossings, and can never justify a skip.

**Invalidated whole** only by being unreadable: a missing, corrupt, or
foreign-layout snapshot is treated as absent, which costs a full suite and
cannot produce a wrong skip. Delete the digest directory to force that.

## What selects what

A changed file selects by how the snapshot records it.

- **A product module** selects the tests that covered the changed region.
- **A test file** selects itself: nothing covers a test, so its own edit is the
  only thing that can run it.
- **A precondition** selects every test it governs, which is what declaring one
  is for. Declare a fixture the tests read with `fs`, or a script they spawn —
  anything an import graph cannot see.
- **A module with probes and no crossings** answers: the build read it and
  nobody covered it.
- **A module with no row at all** is `unread`. Nothing loaded it, every test
  that imports it mocked it, or it sits outside what the run instrumented — and
  the record cannot say which.
- **A stylesheet, image, or JSON file** can take no probe, so it never has a
  row. Pass `relations` to answer it through the graph instead (below).

The unit of a change is the **line**, in the coordinates of the diff's own base
revision. A hunk header is not the change: the context lines printed around an
edit are unchanged, and charging them selects the tests that covered the lines a
reader was shown. Each changed line is answered by the narrowest recorded region
containing it, and the selection is the union over lines, so one commit that
edits an import and a click handler selects everything the module selects. A
line that opens or closes the narrowest region charges the enclosing region too,
out to the first region that contains the line in its interior. A line no region
covers widens to the whole module. A deleted file is read from its `--- a/`
path, and a renamed file's hunks under its old name.

A module the instrumenter could not parse is recorded with
`instrumented: false`; selection widens to every test that loaded it, each of
which treats the module as a precondition.

### Answer a stylesheet through the import graph

`narrowByExecution(file, diff, { relations })` walks from the changed file
through `asset` edges — the kind the scan gives an import of anything that is
not a module — through the stylesheets that import the stylesheet, to the
modules that import those, and no further. Build `relations` with
[the scan](#scan-the-checkout-for-the-file-graph).

Every chain the walk follows has to end at something the record measured before
the file is answered; one chain ending at a module the record never saw leaves
the file `unread` whatever the other chains selected. The graph may add to a
selection and may never close a question it did not answer. A file whose own
edges the scan could not read may reach the asset by an edge nobody saw, so its
tests are selected and only selected.

A snapshot that stores a file under another name — the built twin a sibling
package's tests loaded — is looked up under every name `knownAs` returns for it.

### Options on the Vitest seam

The optional second argument accepts `root`, `coverageFile`, `include`,
`preconditions`, `mode`, `cases`, `continuations`, and `executionFile`.

| option | default | use it when |
|---|---|---|
| `root` | the configuration root, then the current directory | the repository root is not where Vitest thinks it is |
| `coverageFile` | the cache path above | CI needs a named artifact |
| `include` | JavaScript and TypeScript modules, less test, spec, dependency and built-output files | restricting instrumentation to product source; it receives each absolute module path after Vitest transforms it |
| `preconditions` | the configured setup files | naming additional files whose contents govern every test, such as runner configuration |
| `mode` | `'presence'` | `'entries'` records module and function entries only, and nothing inside them |
| `cases` | off | you want per-test-case crossings as well ([below](#record-which-case-covered-a-region)) |
| `continuations` | off | a case's work outlives it, or the suite is deliberately concurrent ([below](#record-which-case-covered-a-region)) |
| `executionFile` | `<coverageFile>.cases.bin` | choosing where the per-case recording goes; a name ending `.json` writes JSON instead |

Configured setup files become preconditions automatically, and the runtime's own
setup file is placed ahead of them so a setup file that loads an instrumented
module finds the counter factory it needs. A setup entry that names a package
rather than a file is not a precondition, since no diff mentions it.

Under `isolate: false` a run still records every file that consumed a module as
having covered it. A file consumes a module by running something in it: a module
of nothing but constants, evaluated once for an earlier file and only read by the
next, is recorded for the file that evaluated it and not for the reader.

Each file's setup snapshots every counter before its first test runs, so a
region already covered by then is recorded as **loaded** by that file as well as
crossed by it — a function that ran because the module was imported rather than
because a test called it. `loadedBy` on the block is where you find it.

**A configuration with `projects` needs the wrap in two places.** A Vitest
project inherits neither plugins nor setup files from the configuration around
it, so wrap each project *and* keep one wrap at the root for the reporter that
folds the run. A root-only wrap is the shape that looks right and records
nothing: the reporter runs, the file is written, and it says every test reaches
no source. That run says so on the way out —
`instrumented 0 modules across N test file(s)`.

## Record Jest journeys without selecting tests

`withJourneyCoverage` records the source regions entered by each named Jest
test. Jest seals the journals when its run ends and neither reads nor writes a
test-selection snapshot. A separate command folds those journals into the
artifact after Jest has reported whether the tests passed.

Install the CLI beside Sense for that post-run command:

```bash
npm install --save-dev @variance-authority/sense @variance-authority/cli
```

```js
// jest.config.mjs
import { withJourneyCoverage } from '@variance-authority/sense/jest';

export default withJourneyCoverage(
  {
    testEnvironment: 'jsdom',
    transform: { '\\.[jt]sx?$': '@swc/jest' },
  },
  { journeyFile: '.variance-authority/journeys.bin' },
);
```

`journeyFile` is required. Finalize it in a CI step that runs after the Jest step
whether Jest passed or failed:

```bash
yarn exec variance journeys finalize .variance-authority/journeys.bin
```

Until that command succeeds, the journals and their manifest remain in
`.variance-authority/journeys.bin.pending`. A failed finalization leaves them
there for another attempt. A successful one writes the artifact and removes the
pending directory.

Give every CI shard a different path and publish each finalized file
independently. The other options are `root`, `preconditions`, `mode`, and
`continuations`; they have the same meanings as on the selection seam below.

After downloading the artifacts, assemble them locally. The native fold reads
the interned sets directly rather than expanding one JavaScript object per test
and region. Assembly is order-independent, deduplicates a repeated test
identity, and refuses artifacts whose region inventories disagree.

```bash
yarn exec variance journeys stitch \
  shard-0.bin shard-1.bin shard-2.bin \
  --into journeys.bin
```

## Cut a Jest run down to a diff

Wrap the configuration once. Each `transform` entry is wrapped so your own
transformer — `@swc/jest`, `ts-jest`, `babel-jest`, any module with Jest's
transformer shape — still runs first, on its own pattern with its own options,
and the probes land on what it produced. `setupFiles` keep their order and gain
the counter factory at the start; `setupFilesAfterEnv` gain the journal writer
at the end; reporters gain one at the end, and a configuration with no reporters
keeps Jest's default.

```js
// jest.config.mjs
import { withTestSelection } from '@variance-authority/sense/jest';

export default withTestSelection({
  testEnvironment: 'jsdom',
  transform: {
    '\\.[jt]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript', tsx: true } } }],
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
});
```

The second argument accepts `root`, `coverageFile`, `preconditions`, `mode`,
`cases`, `continuations`, and `executionFile`, with the meanings above. There is no `include`: product source is every
JavaScript and TypeScript module the configuration's `testMatch` or `testRegex`
does not name, less dependencies and built output. A setup entry that names a
package — `dotenv/config` — is left alone. A configuration with `projects` is
instrumented project by project, each keeping its own transform and setup files,
with one reporter for the run; a project named by path rather than spelled
inline is refused, because its transform cannot be wrapped from here.

Jest transforms inside the workers it forks and keeps the transformed text on
disk under a content key. The probes ride that cache, and the record of what
those probes mean is stored under the same key inside Jest's `cacheDirectory`,
so `jest --clearCache` discards both halves together. Each test file writes one
journal from `afterAll`; nothing crosses the worker channel.

A Jest worker runs many test files, and each of them loads modules with probes
in them, so a recorded run needs more memory per worker than a plain one while
its wall clock stays close. If a recorded run starts to time out where the plain
one does not, compare peak memory first. Under Jest 30 on Node 24 or newer, run
with `NODE_OPTIONS=--no-async-context-frame` before anything else: with Node's
default `AsyncLocalStorage`, Jest 30 keeps the memory of each finished test file
until the worker's heap is close to its limit, with or without the recorder, and
the flag releases it. Then lower `maxWorkers` or set `workerIdleMemoryLimit` so
Jest restarts a worker once it passes that size.

Selection is the same call as for Vitest. `narrowByExecution` returns paths
relative to the Jest root, and each remaining path is a pattern Jest accepts on
its command line — `jest test/alpha.case.ts test/beta.case.ts`. The snapshot is
one file, so a repository whose unit tests run under Jest and whose pages are
driven by Playwright selects from one index.

To assemble a Jest configuration by hand instead, `withTestSelection` names four
modules by path, and you can name them yourself:
`@variance-authority/sense/jest-transform`,
`@variance-authority/sense/jest-globals`,
`@variance-authority/sense/jest-setup`, and
`@variance-authority/sense/jest-reporter`.

## Cut an Rstest run down to a diff

Rstest builds the suite with Rspack and runs what it built, so the recording
half is a loader rather than a plugin. Wrap the configuration once and the rule
is appended to `tools.rspack` rather than replacing it, `setupFiles` keep their
order and gain the counter factory at the start, and `reporters` gain one at the
end.

```ts
// rstest.config.ts
import { defineConfig } from '@rstest/core';
import { withTestSelection } from '@variance-authority/sense/rstest';

export default defineConfig(withTestSelection({
  globals: true,
  setupFiles: ['./test/setup.ts'],
}));
```

The second argument accepts `root`, `coverageFile`, `include`, `preconditions`,
`mode`, `cases`, `continuations`, and `executionFile`, with the meanings above. The loader runs
at `enforce: 'post'`, after SWC, and reads the block extents back through the
map the bundler already made, so the lines a record carries are the ones you
edited rather than the ones the transpiler emitted.

`cases` needs nothing from the configuration. Rstest has no runner option, so
the per-case bracket goes around `it` and `test` themselves — on the realm when
`globals: true` puts them there, and on `globalThis['@rstest/core']`, which is
where Rstest assigns its API and what Rspack compiles an import of that external
to. A suite that imports its registrars and a suite that takes the injected ones
are recorded the same way, and a suite that mixes the two is too.

A configuration with `projects` describes the run rather than a suite: wrap each
project *and* keep one wrap at the root, the same shape a Vitest `projects`
layout needs.

To assemble a configuration by hand instead, `withTestSelection` names one
module by path, and you can name it yourself:
`@variance-authority/sense/rstest-loader`.

## Record what a driven page executed

A Storybook preview or a Playwright-driven application is built by one process
and driven by another, so the two halves are written down separately and joined
by the driver. `testSelectionProbes()` instruments product source in your own
build and writes each module's block record down; the page counts crossings; and
`recordExecution` merges the drained journals into the same snapshot the Vitest
seam writes. Same probes, same ordinals, same file.

```ts
// vite.config.ts, or a Storybook `viteFinal`
import { testSelectionProbes } from '@variance-authority/sense/journal';

export default {
  plugins: [testSelectionProbes({ root: process.cwd(), label: 'preview' })],
};
```

`label` separates two builds over one repository: a Storybook preview and the
application a Playwright suite drives are different builds of overlapping
source, and one store over both would answer an ordinal with whichever built
last. Give the driver the same label. `testSelectionProbes` also takes `include`
and `cacheRoot` — where the label's store lives, defaulting to the cache root
above.

A module reports the id it was instrumented under, and that id is the digest of
its repository-relative path. Nothing allocates it and no build has to have
ended for it to mean something: transform ten files of a large tree, in any
order, and the ten records that land are the only ones that had to move.

Two sibling packages do the draining for you, and each installs separately:

```bash
npm install --save-dev @variance-authority/storybook-collector
npm install --save-dev @variance-authority/playwright-test @playwright/test
```

- [`@variance-authority/storybook-collector`](https://variance-authority.dev/reference/packages/storybook-collector)
  records with `tests: true`. A story is its own owner, because it shows one
  story at a time. It declares no Storybook version and drives the built preview
  through Playwright.
- [`@variance-authority/playwright-test`](https://variance-authority.dev/reference/packages/playwright-test)
  records with the `varianceExecution` fixture option, or `tests` on
  `createVariance`. It requires `@playwright/test >=1.49 <2`. Every observation
  in one spec file joins that file, because the runner's unit of execution is
  the file.

To drive it yourself: evaluate `executionCollectorSource()` in the page if the
build does not hoist it, call `drainExecution(page)` to close one **subject**'s
window — one named UI state you asked for and can ask for again, such as
`cart/empty` — and hand the journals to `recordExecution`. It takes the same
`root`, `label`, and `cacheRoot`, plus `coverageFile` and `subjects`: one entry
per window the driver closed, each an `owner`, the drained `journal`, optional
`preconditions`, and `complete`, which is false for a subject that did not
finish and keeps it from ever justifying a skip. `heads` names other builds the
same run drove, whose stores join this call. `commit` overrides where the
recording stands, which otherwise reads the checkout's `HEAD`.

Recording refuses in one direction only. A run whose reported modules no store
can identify, a record from another probe recipe, and a page with no collector
each record **nothing** and say why — costing the next run its full suite —
because half a journal written as though it were whole is the failure that
silently skips a subject. Every region covered while a module was evaluating is
attributed to *every* subject the run drained: a module initializes once per
page, for whichever subject happened to be first. Concurrent workers merge under
a lock on the index file.

## Follow one execution into a service

Skip this unless your suite drives an application through its own API. A page
and a Vitest file are each one process, and the realm that executes is the realm
that is watched; a product that does not span processes has nothing to trace.

When it does, product source executes in a second process and nothing in the
page knows it happened, so a change to a route handler runs every spec forever.
A server cannot simply be counted: it outlives every subject and answers several
at once, and draining at request boundaries does not rescue it — a streamed
response flushes after its handler returned, and a floating promise settles two
requests later.

So the key is a **journey**: one opaque id per execution of one subject, minted
by the driver, carried by a cookie, joined afterwards on the id alone. Each
participant reports what it covered under that id, and the subject's *name*
never leaves the driver.

The service wraps whatever it already has around a request:

```ts
import { collectJourneys } from '@variance-authority/sense/journey';

const journeys = collectJourneys({ head: 'api' });

export function handled<Result>(cookie: string | undefined, run: () => Result): Result {
  return journeys.enter(cookie, run);
}
```

`head` is the `label` that service's build gave `testSelectionProbes()`, and
defaults to `VARIANCE_AUTHORITY_HEAD`; `enabled` defaults to whether
`VARIANCE_AUTHORITY_JOURNEYS` is set, so one `env` block configures a service
that names neither. Told neither, `collectJourneys` installs nothing and `enter`
is the identity, so the call above ships to production unconditionally.

`enter` takes the request's `Cookie` header;
[`@variance-authority/wire`](https://variance-authority.dev/reference/packages/wire)
handles where the account goes from there. Nothing in the head writes a file. A
request carrying no journey is one the run did not drive; its crossings join the
process's rather than the nearest subject's.

A journey's scope ends when what the body returned *settles*, not when the body
returns, which is the only arrangement under which the code after an `await` is
attributed at all. `flush` reports what has accumulated without ending anything;
`close` restores the global and reports the rest.

The driver mints the id and the driver joins the reports, because it is the only
participant that knows `journey -> subject`:

```ts
import { joinObservations, recordExecution } from '@variance-authority/sense/journal';
import {
  journeyReportFrom,
  mintJourney,
  stitchJourneys,
  type JourneyReport,
} from '@variance-authority/sense/journey';
import { listen } from '@variance-authority/wire/listen';

const reports: JourneyReport[] = [];
const wire = await listen();
wire.on('journeys', (journey, body) => {
  const report = journey === undefined ? undefined : journeyReportFrom(journey, body);
  if (report !== undefined) reports.push(report);
});

const owners = new Map<string, string>();
const journey = mintJourney(); // one per attempt: a flake and its retry are two
owners.set(journey, 'checkout.spec.ts');
// Drive the subject with `wire.addressFor(journey)` on the return cookie.

const stitched = stitchJourneys({ reports, heads: ['api'], owners });

await recordExecution({
  root: process.cwd(),
  subjects: joinObservations([...stitched.heads.values()]),
  heads: [...stitched.heads.keys()],
});
```

One `recordExecution` for the run, never one per head: two calls naming the same
subjects are two runs as far as the merge is concerned, and the second retires
what the first wrote. `joinObservations` folds the page's rows and every head's
into one row per owner. Where two stores disagree about a module, that module is
recorded as not instrumented, so unknown widens where a guess would skip.

`stitchJourneys` takes `reports`, the `heads` this run declares, the `owners`
map, and two fields for the driver's own knowledge: `preconditions` and
`incomplete`, the subjects the runner already knows did not finish. Reports for
journeys no subject claimed are counted in `unclaimed` rather than attributed —
a health check is not a subject. `mintJourney` produces a UUID and nothing else.

**A declared head must actually report.** A head is extra setup, and extra setup
can be forgotten, skipped in one CI job, or fail to start. *The head executed
nothing* and *the head was not watched* are the two states this cannot confuse,
so a declared head that reported nothing all run, or one reporting a different
probe recipe, sets `complete` to false with a `because` you can print, and every
subject in the run is recorded incomplete — including the ones the page observed
perfectly. The crossings are still written and still queryable; what they lose is
the right to justify a skip, so `narrowByExecution` reports them under `entered`
and leaves `whole` empty. A run that was half-watched narrows nothing rather than
narrowing on the half that showed up.

## Run the near tests first

After a change to a shared module most of the recorded suite can be selected.
Distance answers which to run first: for each selected path, the shortest import
path from the change to it, counted only through the modules that test actually
covered.

```ts
import {
  distanceByExecution,
  indexFaces,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';

// `relations` comes from the scan below; `diff` is the same unified diff.
const { narrowing, distances } = await distanceByExecution(
  testCoverageFile(process.cwd()),
  diff,
  { relations, faces: indexFaces(relations) },
);
```

An excerpt: `relations` and `diff` are the two values the samples above and
below produce. Without `relations` nothing can be placed. `knownAs` gives every
name one module goes by, so a built copy in the graph and a source file in the
record count as the same module. `faces` says where a unit's public entry point
is; without it, every file reads as its own entry point.

Restricting the walk to covered modules is what makes the number worth reading:
a shortest path over the graph alone can run through a module the test never
loaded — a helper behind a branch nobody took. `distanceFromView` is the same
reading over a snapshot you already opened, and `nearestFirst` is the comparison
both sort by.

Each `TestDistance` has a `bearing`. Four of them include a hop count and two
do not:

- `precondition` — the change is the test's own source. Zero hops, and the only
  zero there is.
- `direct` and `transitive` — one hop and more, every hop landing on a module's
  public entry point.
- `reach-through` — a hop that landed inside a unit instead. The change
  travelled past an interface somebody wrote, and the fix is at the importing
  line rather than near the failure.
- `unexplained` — the change reached this test along no chain of imports it
  executed, with the rest of that run accounted for. A registry, a singleton, a
  patched prototype, a module-level assignment two files agree about and nothing
  declares.
- `unmeasured` — the graph could not answer. It sets `because`, naming the
  gap: a built artifact the scan does not read, a directory it was not pointed
  at, a file whose imports nothing could enumerate.

`reach-through` and `unexplained` are findings with an address, and neither
needs a red test to be worth reading. `unmeasured` is the opposite of a finding:
a walk that was never possible must not print as a walk that failed, or every
unscanned directory becomes an accusation. Pass `enumerated` — whether the graph
read what a file imports, which only whoever built the graph knows — and a dead
end there is reported as the hole it is.

A *unit* is a directory whose contents are meant to be reached through one file.
That is a convention rather than a fact about the filesystem, so you supply it.
`indexFaces` reads the one this repository and most others keep — a directory
with an `index` module — and `eitherFace` stacks your own provider in front of
it.

### Take one range of hop counts at a time

`atDistance` partitions the `TestDistance` values you give it. It does not
discover current test files and does not run them:

```ts
import { atDistance, distanceRange, remaining } from '@variance-authority/sense/test-selection';

// `distances` is the array `distanceByExecution` returned above.
const { from, to } = distanceRange('0-2') ?? { from: 0, to: Number.MAX_SAFE_INTEGER };
const running = atDistance(distances, from, to);
const later = remaining(distances, from, to);
```

The range is hop counts. `0-2` is every measured test no more than two imports
from the change: if the nearest test is five hops away it returns nothing, and
`3-` returns the rest. `distanceRange` reads `2`, `0-2`, and `3-` (*three and
beyond*, which is what a last leg asks for and cannot spell in advance), and
returns nothing for anything else, so you report the typo rather than quietly
running one distance.

Start a near range at `0` rather than `1`. Zero is a distance and a common one
in an edit loop: a test whose own source you just changed.

A test nobody could place runs with the range that has no end. So `0-2`
then `3-` runs every placed file exactly once, and no near range is made
expensive by everything nobody could place. A current test file that is not
represented in `distances` remains outside both arrays; keep it selected and
run it in your final leg.

`remaining` names which paths a range left behind. Every range is a smaller
claim than the snapshot selection, which is already a smaller claim than the
suite: a green `0-2` says the nearest tests pass and says nothing about four
hops. `groupByDistance` reports the whole reading as one group per hop count.

**Distance places a selection; it does not build a workload.** A runnable
workload has one more input: the current inventory from every test host. Compute
the skip list, clear it when `unread` is non-empty, subtract only that skip list
from the current inventory, and keep the host identity needed to dispatch every
remaining path.

## Scan the checkout for the file graph

`scanRelations` walks the configured directories, follows resolvable module and
stylesheet references, and returns one `FileRecord` per file: that file's
resolved outgoing edges and content digest. Hand those records to
`@variance-authority/core`, which owns the graph and the selection rules — a
separate package, so install it too:

```bash
npm install --save-dev @variance-authority/sense @variance-authority/core
```

```ts
import { movedBy, relationsOfFiles } from '@variance-authority/core/relate';
import { scanRelations } from '@variance-authority/sense';

const records = await scanRelations({ root: '.', dirs: ['src'] });
const relations = relationsOfFiles(records);
const selection = movedBy(relations, ['src/tokens.css']);

console.log(selection.components); // components reached by the changed file
console.log(selection.opaque);     // files widened because their edges are unknown
```

You need a readable checkout, installed dependencies for bare specifiers, and
any `tsconfig.json` path mappings the source uses. Resolving a bare specifier is
the one step that needs them; the pure readers in
`@variance-authority/sense/read` take source text plus a file id instead and
never touch a disk.

| option | default | use it when |
|---|---|---|
| `root` | required | naming the checkout; returned paths are relative to it |
| `dirs` | required | choosing the source directories to seed |
| `before` | absent | naming individual files the run rests on that nothing imports — a `vitest.config.ts`, the setup it loads — so the harness and everything below it become ordinary nodes; a path that is not there, or that this cannot parse, is skipped |
| `digests` | Git digests when available | supplying a digest map, or set `false` to read and hash files directly |
| `changed` | absent | supplying the complete scan-root-relative file list already known to have changed; present, including empty, skips `git status` |
| `cache` | in-memory parse cache | reusing parsed module records between calls |
| `reuse` | off unless `digests` is available | reusing resolved `FileRecord`s; sound only with content and layout digests |
| `largestFile` | one megabyte | reading source files larger than that; anything over the cap is recorded opaque instead of parsed |
| `indexed` | absent | receiving each cached parse with the resolved target corresponding to every request |

`conditionNames` and `tsconfig` are accepted by the same call and control how
specifiers become file edges; the generated declaration states their exact
shapes.

`dirs` are seeds, not a hard boundary: an imported stylesheet outside `src`
still joins the graph. Edges into a sibling package's built output, or another
path outside `root`, are omitted. An import of an installed package is not
omitted: it is recorded as an edge to a **package node** named the way the
source imports it — `@mui/material`, never a version and never a resolution —
so a dependency bump can be seeded by name. Which copy a resolver handed any
one importer is not recorded, because answering that means reproducing the
resolver, and a selector that guessed would skip on the guess.
[Read the install](#read-which-packages-the-install-changed) to find out
which names to seed.

A file over `largestFile` is marked opaque rather than parsed, because a file
that size is nearly always generated output and a single one of them can cost a
scan hundreds of megabytes. Raise it when you mean to read one anyway.

An unreadable or unresolved relative edge marks its file **opaque**: its true
edges are unknown, so the file stays in the selection instead of being dropped,
and `selection.opaque` lists exactly these files. A bare specifier that resolves
to nothing on disk is recorded as a package edge without that widening: the name
is what a bump is seeded by, and whether the package is installed here decides
nothing about which files import it.

### Keep repeated scans cheap

The source index caches parses and resolved records between scans. It is
optional: a missing or corrupt one behaves as empty, saving scan work and never
changing scan evidence.

```ts
import { openSourceIndex, scanRelations, sourceIndexPath } from '@variance-authority/sense';

const source = await openSourceIndex(sourceIndexPath(process.cwd()));

await scanRelations({ root: '.', dirs: ['src'], cache: source.cache, reuse: source.reuse });
await source.save();
```

`sourceIndexPath(root)` puts it beside the coverage snapshot under your cache
root — the same directory, the same worktree layering, cached in CI the same
way. See [the source index](https://variance-authority.dev/docs/source-index)
for the on-disk layout and the cache recipe. The parse section is keyed by
content digest; the record section additionally by the repository path layout
and resolution settings, because resolution can change while file bytes stay the
same. `gitDigests` supplies content digests from Git when available, and
`scanRelations` calls it unless `digests: false` or a caller-provided map is
used.

When an editor, watcher or orchestrator already knows the changed files, pass
them as `changed`. Sense still reads the committed path set, hashes those paths
from disk and treats a missing path as deleted, but it does not run `git status`
to rediscover the same answer. The list is authoritative: include additions and
deletions, and include both the old and new path of a rename. An empty list means
the caller knows the working tree is unchanged.

`parsed` hands you each file's parse as the scan settles it — the
repository-relative path and what the bytes said, once per file, reused records
included. A caller that wants a different reading of the same bytes otherwise
has to walk and parse the tree a second time; handed this, that second reading
of an unchanged tree costs a map lookup per file. The value is the cached parse
itself rather than a copy, so treat it as read-only.

`indexed` is the path-dependent companion: it receives the same parse and one
resolved target per request, in request order. Use it when a consumer needs to
follow named re-exports without resolving the same specifiers again.

```ts
// An excerpt of the call above: `source` is the opened index, and `exports` is
// whatever map you are filling.
await scanRelations({
  root: '.',
  dirs: ['src'],
  cache: source.cache,
  reuse: source.reuse,
  parsed: (file, parse) => { exports.set(file, parse.exports); },
});
```

## Read which packages the install changed

`@variance-authority/sense/lock` turns lockfile text into the two facts a
selector needs: which packages are not the packages that were there, and which
package rests on which. Text in, data out, no file system — you supply the two
revisions you want compared, and the git in that sentence is yours.

```ts
import { changedPackages, packageRelations, readLockfile } from '@variance-authority/sense/lock';

const before = readLockfile('yarn.lock', atBase);
const after = readLockfile('yarn.lock', atHead);

changedPackages(before, after); // ['jsdom', 'whatwg-url']
packageRelations(after);        // [['jest-environment-jsdom', 'jsdom'], …]
```

Feed `packageRelations` to the graph as `depends`, and the changed names to
the selector as seeds:

```ts
const relations = relationsOfFiles(records, { depends: packageRelations(after) });
const selection = movedBy(relations, changedPackages(before, after));
```

A bump then reaches your code by the same backwards walk an edited file takes,
and stops at the files that import the thing: a transitive `jsdom` bump arrives
at whoever imports `jest-environment-jsdom`, and nowhere else. A `type` import
is not walked, so `import type { Theme } from '@mui/material'` selects nothing
on a `@mui/material` bump — the import is erased before anything runs.

`LOCKFILES` is the names to look for, in the order to look: a repository with
two has switched managers and not finished. `readLockfile` takes a path or a
bare name and reads its last segment. `packageNameOf` is the descriptor rule the
formats agree on, exported because a caller reading its own manifests needs the
same one.

**The lockfile is a source read at two revisions, never a changed path.** Those
are different claims and only one of them is useful. In a diff, a lockfile is
one of the most expensive paths there is: a workspace version bump rewrites
hundreds of its lines and moves no installed byte, so a selector that treats it
as a changed file repaints the whole suite for nothing. The difference between
two reads of it says exactly what arrived. Drop the lockfile and every
`package.json` from your changed-file list once you have compared the two —
`package.json` is the request and the lockfile is the answer, and counting
either again widens for the very thing it just explained.

`readLockfile` throws `Unreadable` with a sentence naming what stopped it — a
format version this build does not read, a YAML construct it will not guess at.
Catch it and observe everything: a dependency bump is invisible without the
comparison, and invisible is the one thing a selector may not treat as *nothing
happened*. Nothing here reads `node_modules`, so pnpm's store and Yarn PnP cost
it nothing.

| reader | format |
|---|---|
| `yarn.lock` | Yarn classic (v1) and Yarn Berry (`__metadata.version` 4 through 8) |
| `pnpm-lock.yaml` | pnpm lockfile 5.x, 6.x, 9.x |
| `package-lock.json`, `npm-shrinkwrap.json` | npm lockfile 2 and 3 |

Workspace entries are excluded by every reader. A workspace package is your own
source, and your own source arrives as changed files.

## Correct what a file's text claims to import

The scan writes down what a file's text says. A test that calls
`vi.mock('./api')` imports `./api` by the letter and runs none of it; a Relay
component that calls `jsresource('./panel')` names a module in a notation no
parser reads and runs all of it.

`@variance-authority/sense/taint` is the second table of imports that corrects
both — per file, what is subtracted and what is added, joined onto the records
after the scan. The word is not dataflow taint analysis: nothing here tracks
values, and a *taint* is only an overlay on the import graph. The records, the
parse cache and the record cache are left as they were read, so the same scan
can be viewed under several taints, or none.

```ts
import { scanRelations } from '@variance-authority/sense';
import { mockTaint, taintFile, taintRecords } from '@variance-authority/sense/taint';
import { movedBy, relationsOfFiles } from '@variance-authority/core/relate';

const records = await scanRelations({ root: '.', dirs: ['src'] });
const tainted = await taintRecords(records, [mockTaint(), await taintFile('variance.taint.json')], { root: '.' });
const relations = relationsOfFiles(tainted.records, { shadows: tainted.shadows });

movedBy(relations, ['src/api.ts']).files; // no test that mocks `./api`
```

The two halves land in different places. A `+` is one more import the file
makes: an edge on its record, resolved the way the scan resolves any other, and
reported in `tainted.additions`. A `-` is not one edge fewer. `vi.mock('./api')`
replaces `api.ts` for the whole of that test's run — for the test, for the
component it imports, for anything under it — so it is the module taken out of
the graph as seen from that file, at every level. It lands in `tainted.shadows`,
keyed by file, and a graph built with that table applies it to every walk: a
file is moved by a change only when some trail from the change arrives without
crossing one of its shadows, and what is reached only through such a file goes
with it. `movedBy` names the files it left out this way in `shadowed`.

An addition can name a file outside the directories the scan walked. That file
comes back as a record of its own, marked `unknown` rather than given an empty
edge list: nobody read it, so it widens a selection instead of narrowing one.
Point the scan at its directory to have it read.

Every shadow and every addition keeps the name of whoever said it.
`tainted.shadowedBy` is the file, the file it never reaches, and the taints that
named it; `tainted.addedBy` is the same for additions. Two taints that shadow
one module are both credited, so a test left out of a selection can be traced to
a hand-written table or to the mock reader.

`mockTaint` reads `vi.mock`, `jest.mock` and `sb.mock` calls off test, spec,
story and setup files and shadows the mocked module. Nothing is shadowed when
the factory loads the real module through `importActual`, `requireActual` or
`importOriginal`, when the factory is written somewhere this cannot read,
when the mock is a `doMock` the static imports above it have already evaluated
past, and when the specifier is not a string literal. Pass `callers` to name
other mocking objects and `files` to widen which files are read.

`taintFile` reads a JSON table you keep beside the repository, keyed by file
path with `-` and `+` rows, and `taintTable` builds the same taint from a table
already in memory:

```json
{
  "src/cart.test.ts": { "-": ["./api"] },
  "src/panel.tsx": { "+": ["./panel.relay", "./panel.css"] }
}
```

For framework calls that name modules as string arguments, `moduleCallsTaint`
parses only a caller-supplied candidate set. The set is required: finding a rare
convention must not open every module merely to run a text check. Bootstrap it
with the repository's text search, then maintain it from editor, watcher or
changed-file events.

```ts
import { moduleCallsTaint } from '@variance-authority/sense/taint';

const loaders = moduleCallsTaint({
  name: 'application-loaders-v1',
  files: new Set(['src/routes/orders.entrypoint.tsx']),
  calls: { JSResourceForUserVisible: 0, importCond: [1, 2] },
});
```

`name` is the cache and report identity; change it when the rule changes so an
old answer cannot be reused under new semantics. `calls` maps each exact callee
identifier to the zero-based argument position, or positions, that contain
module specifiers. `files` is the candidate set and is never widened by Sense.

Only literal strings and templates without substitutions become additions. A
callback containing `import()` is left alone because the native module parser
already records it. Call names and argument positions belong to the consumer;
Sense ships no framework vocabulary.

Under more than one taint the subtractions are unioned and so are the additions,
and the two never contend: an edge one taint adds to a file another taint
shadows is an edge into a node the file's run never covers, and the shadow
wins, the way the mock wins at runtime.

Hand `taintRecords` the `cache` the scan used, so an unchanged file is not
opened or parsed a second time — a reader's answer is a fact about the file's
bytes, kept under a digest over those bytes and the reader's name:

```ts
const source = await openSourceIndex(sourceIndexPath(process.cwd()));
const records = await scanRelations({ root: '.', dirs: ['src'], cache: source.cache, reuse: source.reuse });
const tainted = await taintRecords(records, [mockTaint()], { root: '.', cache: source.cache });
await source.save();
```

### Check a taint against the record

A taint says what a file's run reaches; a coverage record says what it did.
Where both exist, `auditTaints` compares one with the other and names every
disagreement as a coordinate to look at:

```ts
import { auditTaints } from '@variance-authority/sense/taint';
import { readTestCoverage, testCoverageFile } from '@variance-authority/sense/test-selection';

// `relations` and `tainted` come from the sample above.
const coverage = await readTestCoverage(testCoverageFile(process.cwd()));
for (const { test, module, kind } of auditTaints(coverage, relations, tainted)) {
  console.log(`${test} ${kind} ${module}`);
}
```

`shadowed-but-entered` is a module the test shadows and the record says it
covered: the taint is wrong about that mock, or the mock did not take.
`reachable-but-not-entered` is a module the test reaches on the graph past its
shadows and nobody covered for it: an import the run never loaded, or a mock no
taint knows about yet. `added-but-not-entered` is an addition the record never
saw the test in. Only an instrumented module testifies, and only a complete
observation testifies to absence. Where a taint said the thing the record
disagrees with, the deviation names its `taints` — the table or reader to go
and correct. Pass `knownAs` when the record lists a module under a built name.

## Read the record yourself

`selectTestFiles` answers with paths and `deviationOfTests` with line counts;
both discard the rest of the snapshot. To see the regions themselves — which
blocks a module has and which test files covered each one — read the snapshot as
its logical model:

```ts
import {
  readTestCoverage,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';

const coverage = await readTestCoverage(testCoverageFile(process.cwd()));

for (const module of coverage.modules) {
  // Recorded as unknown. Widen to the whole module rather than reading blocks
  // that were never collected.
  if (!module.instrumented) continue;

  for (const block of module.blocks) {
    console.log(module.file, block.kind, block.startLine, block.endLine, block.testFiles);
    if (block.loadedBy !== undefined) console.log('  loaded by', block.loadedBy);
  }
}
```

The snapshot is a binary artifact, so this is the only way to read the evidence
your own runs produced rather than the two summaries above. `writeTestCoverage`
is the other direction — the same shape, landed whole under a rename, where
`readTestCoverage` and every runner seam will find it.

Crossings here name **test files** and record no call-stack depth. That is the
recorded granularity, not a limit of this reader; see
[Record which case covered a region](#record-which-case-covered-a-region).

The snapshot also notes the commit it was recorded at.
`readTestCoverage(file)` hands it back under `commit`, so a caller can
`git diff <commit> HEAD` for the distance from the recording to the working
tree. A recording made outside a checkout has no commit, and an index that
cannot say where it is has nothing to diff against, so a caller with one runs
the suite it would have run anyway.

## Fold shards into one snapshot

A suite too large for one machine runs across N jobs and ends with N snapshots,
each a whole observation of its own test files and a partial one of every module
they share. Every question is about the suite, and no shard can answer it.
`foldTestCoverage` is the union the unsharded run would have written, and it is
the same union in any order:

```ts
import {
  foldTestCoverage,
  mergeCoverage,
  readTestCoverage,
  testCoverageFile,
  writeTestCoverage,
} from '@variance-authority/sense/test-selection';

const shards = await Promise.all(
  ['shard-1/coverage.bin', 'shard-2/coverage.bin'].map(async (path) => ({
    path,
    coverage: await readTestCoverage(path),
  })),
);

const suite = foldTestCoverage(shards);

const file = testCoverageFile(process.cwd());
const previous = await readTestCoverage(file).catch(() => undefined);
await writeTestCoverage(file, mergeCoverage(previous, suite));
```

Record each shard through the ordinary seams with `coverageFile` pointing at
that job's artifact, then fold the artifacts in a job of their own.

Folding refuses by name, on one rule: the result must not be able to say
anything one run could not. Shards recorded under different probe recipes or at
different commits were not one run — and *absent* is a value there, so a shard
recorded outside a checkout does not fold under a commit it never named. A test
file two shards both recorded is a split that overlapped, and a module two
shards built from different source has regions that do not name each other.
Where the shards disagree, unknown wins: a module one shard could not
instrument is unread in the fold.

A fold is a fan-in and `mergeCoverage` is a layer; they are not interchangeable.
A layer positions the result where the newer side stands and retires what that
side re-recorded whole, which is what landing a run over a baseline means and
would make a fold depend on the order its shards were named in. A test the newer
side did not run is kept as it was, unless a region it covered was rewritten
underneath it: then it is kept incomplete and runs at the next selection.

## Instrument one module

`@variance-authority/sense/instrument` is a pure source transform, for a build
that is neither of the seams above:

```ts
import { instrument } from '@variance-authority/sense/instrument';

const sourceText = 'export const price = (n: number) => (n > 0 ? n : 0);';
const moduleId = 'src/price.ts';
const result = instrument(sourceText, moduleId);
if (result === undefined) {
  // The parser could not establish a safe tree. Keep the module uninstrumented.
} else {
  const transformedSource = result.code;
  const regions = result.blocks;
}
```

The transform inserts one-line probes at module, function, branch, continuation,
loop, `switch`, handler, and `await` boundaries. Each probe marks entry into one
**arrival region**: a stretch of code reachable under exactly one guard, such as
an `if` body or a `catch`. `result.blocks` gives each probe's ordinal, source
range, own-source digest, and the ordinal of its enclosing arrival region. A
guard belongs to the region before its outcomes, so editing the guard changes
that region's digest while an edit inside one outcome does not. `sourceDigest`
names the exact input and `instrumentation` names the probe recipe. The original
line count is preserved; columns shift, because the transform does not print or
source-map the file.

A probe is one counter increment, and the transform is paid once per changed
file rather than once per test — about 0.14 ms a module, two fifths of that
already the platform's
([the execution record](https://variance-authority.dev/docs/execution-record)).
Digests come from `node:crypto`, and the parsed tree crosses out of `oxc`
without a JSON round trip on any 64-bit little-endian host; where that transfer
is unavailable the same tree arrives more slowly and the records are identical.

If a module cannot be parsed, `instrument` returns `undefined`. Check for that
before reading `result.blocks`: a missing result and an empty block list are
different facts, and only the caller can keep them apart. A function stringified
into a browser, worker, or other realm loses the generated runtime declarations
and throws at its first probe.

The fourth argument picks the recipe. `{ mode: 'entries' }` places a probe at
the module and at every function body and nothing inside them — no branch, loop,
handler or `await` — so a run pays one probe per function rather than one per
decision. A function has the same name and path under either mode; what changes
is how many regions there are. The two recipes number regions differently, so
each reports under its own `instrumentation` id: `instrumentationId(mode)` gives
it and `instrumentModeOf(id)` reads it back, and nothing that reads one recipe's
records, journals or snapshot accepts the other's.

## See where two observers parted

`journeysApart` answers a question no static reading of the same code can: one
file, two observers, and not the same path through it. Three stories mount
`CartCard`, one of them clicks Remove, and the `onClick` body is a region the
other two have never been inside — same file, same import graph, same props.

```ts
import { journeysApart, testCoverageFile } from '@variance-authority/sense/test-selection';

// `subjectsThisRunPainted` is the list of subject ids your driver just recorded.
const apart = await journeysApart(testCoverageFile(process.cwd()), {
  observers: subjectsThisRunPainted,
});

for (const module of apart) {
  for (const region of module.parted) {
    console.log(module.file, region.name, region.startLine, region.entered, region.missed);
  }
}
```

    app/src/components/CartCard.tsx  CartCard/onClick  51
      covered  story:cart-card--removing
      missed   story:cart-card--item, story:cart-card--verbose

The pool per module is whoever covered a region with source of its own, which is
not whoever loaded the file: a module root is crossed on import, so every
subject in a bundle crosses every module in it. `observers` narrows further to
the subjects a run actually painted — the snapshot accumulates, and without it a
subject deleted two commits ago stays a party to every parting it was recorded
in. An observation recorded `complete: false` is dropped from the pool rather
than counted as having missed.

`unentered` is the weaker sibling finding: regions with source of their own that
**no** observer covered. Not *these two renders disagree* but *this run never
went here at all*.

## Measure test-file deviation

Deviation compares what a test file can statically reach with what it covers in
a complete instrumented run. Scan both product and test directories, then join
those records to the snapshot:

```ts
import { scanRelations } from '@variance-authority/sense';
import {
  deviationOfTests,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';

const root = process.cwd();
const records = await scanRelations({ root, dirs: ['src', 'test'] });
const variation = await deviationOfTests(testCoverageFile(root), { root, records });

console.log(variation.coverage);
console.log(variation.sensitivity);
console.log(variation.tests);
```

`records` must include each test file whose deviation is measured.

Each `tests` row is one test file, not one `it` block. `baseline` counts the
non-blank lines in JavaScript and TypeScript modules reachable from that test
file, excluding the test file itself. `slice` counts lines owned by the
narrowest covered source regions. The row's `sensitivity` is
`slice.loc / baseline.loc`, and `deviation` is `1 - sensitivity`.

`coverage` is the union of every slice, and `coverageRatio` compares that union
with the union of every baseline; shared modules and lines count once.
Suite-level `sensitivity` is the arithmetic mean of the per-test ratios, so a
large test file does not outweigh a small one. A missing test-file node or an
opaque dependency leaves that row's `baseline`, `sensitivity`, and `deviation`
absent — check for `undefined` rather than treating a missing value as `0`. If
any row is indeterminate, the suite baseline, coverage ratio, and sensitivity
are absent too.

## Find the tests that cover a line

`coveringTests` is the point query for coding agents, editors, and navigation
integrations. It takes an `ExecutionIndex` plus a source line or function, and
returns individual test identities ordered by their shortest observed call-stack
depth. `coveringTestsInFile` answers the whole indexed file in one operation:

The query identifies the tests that crossed a line; [on
testing](https://variance-authority.dev/docs/on-testing) explains why this
evidence cannot decide whether any of them is redundant.

```ts
import {
  coveringTests,
  coveringTestsInFile,
  type ExecutionIndex,
} from '@variance-authority/sense/test-selection';

const index: ExecutionIndex = {
  tests: [{ id: 'cart/staff', file: 'test/cart.test.ts', name: 'applies the staff discount' }],
  modules: [{
    file: 'src/cart/total.ts',
    blocks: [{
      kind: 'function',
      name: 'priceOf',
      path: 'entry',
      startLine: 10,
      endLine: 18,
      source: true,
      crossings: [{ test: 0, distance: 2 }],
    }],
  }],
};

const nearest = coveringTests(index, {
  file: 'src/cart/total.ts',
  function: 'priceOf',
});

const decorations = coveringTestsInFile(index, 'src/cart/total.ts');
```

The index above is written out by hand so the sample runs on its own. In
practice it comes from a recording — see below, or from an editor's test runner,
a debugger, or a language server. `@variance-authority/mcp` puts the same query
in front of an agent over MCP and asks exactly this of its caller.

A line resolves to the innermost real source region containing it, so tests that
only covered an enclosing function do not leak into a branch-line answer. A
function lookup matches its exact indexed name. Repeated observations of one
test collapse to the minimum distance. `id` distinguishes tests with the same
file and name. The bulk result groups adjacent lines with identical tests and
distances into inclusive ranges; an indexed but unreached range has an empty
`tests` list, while lines absent from the instrumented source regions have no
range. Missing source returns no claim; an invalid test reference or distance
throws.

Every seam here writes an `ExecutionIndex` when it is asked for one. Without
`cases: true` a crossing joins the whole test file, which is the granularity
selection spends.

### Record which case covered a region

Pass `cases: true` to `withTestSelection` — any seam — and the run writes an
`ExecutionIndex` beside its snapshot. The snapshot itself is byte-identical
either way, so CI reads the same file whichever you choose:

```ts
// vitest.config.ts, with the two imports of the first sample.
export default withTestSelection(
  defineConfig({ test: { include: ['src/**/*.test.ts'] } }),
  { cases: true, executionFile: '.variance-authority/cases.bin' },
);
```

```ts
import { readFile } from 'node:fs/promises';
import {
  coveringTests,
  decodeExecutionIndex,
} from '@variance-authority/sense/test-selection';

const index = decodeExecutionIndex(await readFile('.variance-authority/cases.bin'));
const walked = coveringTests(index, { file: 'src/cart/total.ts', line: 14 });
```

The index is the same relation the snapshot holds, asked at case granularity
rather than file granularity, so it grows with cases times regions. Written as
columns it is under a megabyte for a suite whose JSON spelling of the same
relation is twenty-seven. Name the file `.json` and you get that JSON, for a
reader that has to have it:

```ts
{ cases: true, executionFile: '.variance-authority/cases.json' }
```

Each entry in `index.tests` is keyed by the case's **coordinate**: the
project-relative test file, then the describe path and the test name, joined by
` > `.

```text
test/checkout.test.tsx > checkout > submits
```

A name is the coordinate, so the identity is the name and not the runner's
positional id, which changes the moment a case is inserted above it. Two cases
in one file may share a coordinate; the repeat is numbered, so the second reads
`<coordinate>#1`. Any other producer of an `ExecutionIndex` — and anything
joining against one, such as an Eyes journal read by `variance distill` — has to
key the same test by the same string.

A case owns a crossing when the probe fired while that case was the one
running, not inside a start-and-stop bracket around it. A suite runs its cases
one at a time, so by default *the case running now* is a variable: the case
that a crossing joins is a single read, and recording per case costs what
recording per file costs. Two cases open at once cannot both be that variable,
so the second one is refused with an error naming both.

Pass `continuations: true` and each case gets an asynchronous scope instead.
Work a case started and did not await is then charged to the case that started
it however late it settles, several cases may be in flight at once, and
`test.concurrent` and `describe.concurrent` record as the separate cases they
are rather than each being credited with what the others did. Reading which
continuation is running costs 4.7 nanoseconds a crossing over the variable —
6.3 ns against 1.6, of which 5.5 is `getStore()` itself. A microbenchmark
separates the two modes on that; a suite does not. Over zod's 5,656 cases —
ten interleaved repetitions of each arm — the crossing count predicts 0.2% and
the runs do not resolve it. The case axis as a whole spends 6.1% more time
inside the tests than the same run recorded per file, 3.5% on TanStack Query,
and instrumenting at all costs 6.9% and 4.0% on those two suites.

On Node 22 and 23 the async context is kept in a linked list rather than a
frame; `--no-async-context-frame` on a newer runtime reproduces it and reads
8.4 ns a crossing, 44% above the frame.

The mode also answers a question of its own. A crossing that arrives after its
case has settled is that case still working, and the file prints the cases that
did it when it finishes:

```text
variance-authority: work outlived its case in test/checkout.test.tsx:
  checkout > submits
```

Those are the tests that are still running when the next one starts — the ones
that break their neighbours. Without `continuations`, a case that returns
before its work does simply leaves that work in the ambient bucket, which every
case in the file is credited with: over-inclusive, which is the safe direction,
and silent. Turn the mode on to stop it being silent.

Under Jest the scope comes from the runner rather than from the realm. Jest
exposes no hook that wraps a case, so the seam registers a jest-circus event
handler and replaces the body on the case object the runner is about to call.
Which registrar declared the case does not come into it: a file that imported
`it` from `@jest/globals` — what `injectGlobals: false` forces, and what any
file may do regardless — is bracketed like any other. The realm's `test` and
`it` are wrapped as well, for a project that replaced the runner. A
`test.concurrent` case is named by its declared name rather than the resolved
one, because its body starts outside the runner's own bracket.

Every crossing has `distance: 0`: the recording says which case covered a
region, not how it got there, so every answer is ordered by identity rather
than by depth. Anything a file covered before its first case — imports, `beforeAll`,
top-level evaluation — is credited to every case in that file.

**Turn cases on for a local loop, not for the repository index.** The case axis
grows the relation by roughly the number of cases that share a file, and the
growth does not compress away, because two regions of one module are covered by
*different* subsets of cases — which is exactly the information being bought.
Recording 4,011 cases over 364 test files of this repository produced 28.8 MB of
the JSON above against a 681 KB snapshot. So it is the right axis for a coding
agent asking which five of two hundred cases walked the branch you just changed,
and the wrong one for the index CI reads to select files over every region there
is.

### Ask the index about a diff

`coveringChange` joins changed lines to the cases that went there, and
`formatCoveringChange` writes that join the way both this project's surfaces
write it. Pass the changed lines rather than the diff: `changedLines` is already
the one parse of it the file-grain selector uses, and two parses of one diff
disagree exactly at the renamed and binary paths a review is least able to
check.

```ts
import {
  changedLines,
  coveringChange,
  formatCoveringChange,
} from '@variance-authority/sense/test-selection';

const changed = coveringChange(index, changedLines(patch));
console.log(formatCoveringChange(changed, { from: '.variance-authority/cases.bin' }));
```

Every changed file comes back, silent ones included — a reader that dropped them
would print a confident report about the half of the change it happened to have
measured. `recorded` separates the index being silent about a file from the
index saying nobody covered it, and `cases` answers a changed **test** file with
the cases it declares, since the run instruments what the tests import rather
than the tests themselves. Within a region, `tests` called in and `passengers`
were only present while the module evaluated.

The formatter takes what the caller can honestly say about provenance — the ref
the diff was taken against, the file the index was read from, the commit it
stands at — and prints nothing for a field it is not given. It lives here rather
than in either caller because the CLI's `variance covering --since` and the MCP
tool `variance_changed_tests` both print it, and a reading with two renderers
has two answers.

## What each host gives the recording

Every seam records the same three things — which regions the transform cut,
which of them an observer covered, and whether that observation was whole — into
one snapshot format. What differs is the unit an observation is attributed to,
which is whatever the host schedules, and where the per-case bracket goes.

| Host | A crossing joins | The bracket `cases: true` installs |
|---|---|---|
| Vitest | the test file | the case the runner is running, or its asynchronous scope under `continuations` |
| Jest | the test file | the body of every case the runner announces, whichever registrar declared it, plus `it` and `test` on the realm |
| Rstest | the test file | `it` and `test` on the realm and on `globalThis['@rstest/core']`, so an importing suite and a `globals: true` suite record alike |
| Playwright | the spec file | the test, which is already the window the driver closes |
| Storybook | the story | the story, which is already the subject the preview shows |

None of the five asks the project to turn on a runner option to buy the case
axis, and each writes the index beside the snapshot it was already writing.

Two answers are properties of the record rather than of a host, so they read the
same under all five. A run that transforms nothing because every module came
from a warm cache still attributes what its tests covered: what a region means
is stored per module under a content key, and a run joins those records rather
than producing them. And an observation that did not finish is dropped from the
pool rather than counted as a miss, so nothing a host retries or interrupts can
justify a skip.

## Entrypoints

| import | Use it for | Requires |
|---|---|---|
| `@variance-authority/sense/vitest` | adding instrumentation, collection, and persistence to Vitest | Vitest `^2.1.9` and product tests |
| `@variance-authority/sense/jest` | the same around the transformer your project already uses | Jest 30 and product tests |
| `@variance-authority/sense/jest-transform`, `/jest-globals`, `/jest-setup`, `/jest-reporter` | the four modules `withTestSelection` names by path, for a configuration assembled by hand | Jest 30 |
| `@variance-authority/sense/rstest` | the same as an Rspack loader and a reporter, for a suite Rstest bundles | Rstest `^0.12.0` and product tests |
| `@variance-authority/sense/rstest-loader` | the loader `withTestSelection` names by path, for a configuration assembled by hand | Rstest `^0.12.0` |
| `@variance-authority/sense/test-selection` | selecting from a diff, placing a selection by distance, reading, folding and writing the snapshot, measuring deviation, and `coveringTests` | the snapshot a runner or journal seam wrote; an import graph for the distance and asset walks |
| `@variance-authority/sense` | `scanRelations`, the source index, and Git content digests | a readable checkout for the scan; persistence is optional |
| `@variance-authority/sense/read` | `readModule` and `readStyle` when source text already comes from a VFS, editor, or bundler | a file id and source string |
| `@variance-authority/sense/lock` | reading which packages an install changed between two revisions, and how they rest on each other | the lockfile's text at both revisions; nothing else, and no `node_modules` |
| `@variance-authority/sense/taint` | joining a second table of imports onto scanned records, and auditing it against the record | the records, and a table or a reader that produces the diff |
| `@variance-authority/sense/instrument` | transforming one module to add execution-presence probes | a module id and source string |
| `@variance-authority/sense/journal` | instrumenting your own build and recording what a driven page executed | a Vite-compatible build, and a driver that can evaluate in the page |
| `@variance-authority/sense/journey` | carrying one execution across processes, so a service's crossings join the subject that caused them | a service running Node, its own instrumented build, and a driver that sets a cookie |

## Related contracts

- [`docs/source-structures.md`](https://variance-authority.dev/docs/source-structures) and [`docs/execution-record.md`](https://variance-authority.dev/docs/execution-record) are the references for the structures this package reads and writes: primary keys, lookups, traces, and their costs.
- [`docs/source-index.md`](https://variance-authority.dev/docs/source-index) is the on-disk layout of the scan cache and the CI caching recipe.
- [`@variance-authority/core`](https://variance-authority.dev/reference/packages/core) turns records into relations and answers selection questions.

---

**[@variance-authority/sense](https://variance-authority.dev/reference/packages/sense)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
