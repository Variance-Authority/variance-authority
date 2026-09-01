<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/sense

> Which components and tests a source change reaches: test selection and impact analysis from a versioned index of a checkout.

**Requires:** a readable checkout for `scanRelations`, or source text plus a
file/module id for the pure readers and transform. Resolution of bare specifiers
also requires the checkout's installed dependencies and any `tsconfig.json` path
mapping they use.

Use this package when you need to answer any of these questions:

- Which files and components can a changed file reach?
- Which Vitest files, Storybook stories, or Playwright specs entered the source
  regions touched by a diff?
- Which execution regions did an instrumented module enter, and which test files
  entered each one?

It also ships the *query* behind a fourth question — which named tests reached a
function or line, and at what stack depth — without the data that answers it.
`coveringTests` reads an `ExecutionIndex` supplied by a collector that records
individual test cases and the call-stack depth of every crossing. The Vitest
integration here is not that collector and is not becoming one: it attributes
crossings to whole test files, which is the granularity that keeps probe
overhead low enough to leave instrumentation on. See
[Find tests that cover source](#find-tests-that-cover-source).

The package reads source and returns data. Its Vitest integration instruments
product source, attributes entered regions to completed test files, and writes
the coverage index used for selection. Vitest still collects and executes every
test inside each selected file.

Skip it if tests run under something other than Vitest 2, Storybook, or
Playwright, or if you need to exclude individual test cases rather than whole
files. Code instrumented in an adopter's own build reports through
[`@variance-authority/sense/journal`](#record-what-a-driven-page-executed), which
carries the same probes over a different transport; a *stringified* function is
still the exception, since text evaluated in another realm has lost the
generated declarations and throws at its first probe. `coveringTests` is the exception: it queries
execution data from any collector, independent of the runner — and independent
of whether this package produced it.

```bash
npm install --save-dev @variance-authority/sense
```
## Start with source selection

The main entrypoint walks the configured directories, follows resolvable module
and stylesheet references, and returns one `FileRecord` per file — that file's
resolved outgoing edges and content digest. Pass those records to
`@variance-authority/core`, which owns the graph and the selection rules.

Prerequisites are a readable checkout, installed dependencies for bare
specifiers, and any `tsconfig.json` path mappings used by the source.

```ts
import { movedBy, relationsOfFiles } from '@variance-authority/core';
import { scanRelations } from '@variance-authority/sense';

const records = await scanRelations({ root: '.', dirs: ['src'] });
const relations = relationsOfFiles(records);
const selection = movedBy(relations, ['src/tokens.css']);

console.log(selection.components); // components reached by the changed file
console.log(selection.opaque);     // files widened because their edges are unknown
```

`scanRelations` takes these selection options in addition to the resolver
settings from its type:

| option | default | use it when |
|---|---|---|
| `root` | required | naming the checkout; returned paths are relative to it |
| `dirs` | required | choosing the source directories to seed |
| `digests` | Git digests when available | supplying a digest map, or set `false` to read and hash files directly |
| `cache` | in-memory parse cache | reusing parsed module records between calls |
| `reuse` | off unless `digests` is available | reusing resolved `FileRecord`s; it is sound only with content and layout digests |

The resolver options (`conditionNames` and `tsconfig`) are accepted by the same
call and control how specifiers become file edges. Use the generated declaration
for their exact shapes and defaults.

`dirs` are seeds, not a hard boundary: an imported stylesheet outside `src`
still enters the graph. Edges into `node_modules`, a sibling package's built
output, or another path outside `root` are omitted — add package-level affected
seeds yourself from the workspace's project graph (for example, Nx or
Turborepo).

An unreadable or unresolved relative edge marks its file **opaque**: its true
edges are unknown, so the file stays in the selection instead of being dropped;
`selection.opaque` lists exactly these files. A missing bare package is
recorded without that widening, because it lies outside the repository's diff.

## Entrypoints

| import | Use it for | Requires |
|---|---|---|
| `@variance-authority/sense` | `scanRelations`, the binary source index, and Git content digests | a readable checkout for the scan; persistence is optional |
| `@variance-authority/sense/read` | `readModule` and `readStyle` when source text already comes from a VFS, editor, or bundler | a file id and source string |
| `@variance-authority/sense/instrument` | transforming one module to add execution-presence probes | a module id and source string |
| `@variance-authority/sense/vitest` | adding instrumentation, collection, and persistence to Vitest | Vitest 2 and product tests |
| `@variance-authority/sense/journal` | instrumenting an adopter's build and recording what a driven page executed | a Vite-compatible build, and a driver that can evaluate in the page |
| `@variance-authority/sense/journey` | carrying one execution across processes, so a service's crossings join the subject that caused them | a service running Node, its own instrumented build, and a driver that sets a cookie |
| `@variance-authority/sense/test-selection` | mapping a unified diff to test files, reading the recorded snapshot, and measuring test-file deviation | the coverage file a runner or journal seam wrote |
| `@variance-authority/sense/test-selection` (same import) | querying named-test reach with `coveringTests` | an execution index from a collector; this package ships no producer for one |

## Keep repeated scans cheap

The source index is optional. Put it outside the checkout; it is operational
state, not source. It stores parses and resolved records in one versioned
binary **generation**: a single consistent snapshot assembled by chaining
immutable segments together. Each save appends only changed rows and
tombstones; periodic compaction restores one globally interned segment.

```ts
import { openSourceIndex, scanRelations } from '@variance-authority/sense';

const source = await openSourceIndex('/var/cache/variance/source-index.bin');

await scanRelations({ root: '.', dirs: ['src'], cache: source.cache, reuse: source.reuse });
await source.save();
```

The parse section is keyed by content digest. The record section is additionally
keyed by the repository path layout and resolution settings, because resolution
can change while file bytes stay the same. `gitDigests` supplies the content
digests from Git when available; `scanRelations` calls it unless `digests: false`
or a caller-provided map is used.

## Instrument one module

`@variance-authority/sense/instrument` is a pure source transform:

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
names the exact input and `instrumentation` names the probe recipe. The
original line count is preserved; columns shift because the transform does not
print or source-map the file.

Test selection is added to a runner configuration or CI job; adopters do not
write an adapter or collector. It instruments modules after the runner’s
transform and records coverage at test-file granularity. Its selector returns
test files to run, never individual test cases or a replacement runner.

If a module cannot be parsed, `instrument` returns `undefined`. Check for that
before reading `result.blocks`: a missing result and an empty block list are
different facts, and only the caller can keep them apart. A function
stringified into a browser, worker, or other realm loses the generated runtime
declarations and throws at its first probe.

## Select Vitest files from a change

Wrap the existing configuration once. `withTestSelection` preserves configured
plugins, setup files, and reporters. Its default coverage path is under
`XDG_CACHE_HOME`, keyed by the configured repository root, rather than inside the
checkout. The saved file stores each path once and records **crossings** —
which test entered which probed block — as aligned typed-array sections linked
by CSR (compressed sparse row) offsets, the compact layout sparse matrices use
to skip empty cells. Only its small versioned section index is JSON.

```ts
import { defineConfig } from 'vitest/config';
import { withTestSelection } from '@variance-authority/sense/vitest';

export default withTestSelection(
  defineConfig({
    test: { include: ['src/**/*.test.ts'] },
  }),
);
```

The optional second argument accepts `root`, `coverageFile`, `include`, and
`preconditions`.
`root` defaults to the configuration root, then the current directory.
`coverageFile` overrides the cache path, including when CI needs a named artifact.
`include` receives each absolute module
path after Vitest transforms it; use it to restrict instrumentation to product
source. By default, JavaScript and TypeScript modules are included while test,
spec, dependency, and built-output files are excluded. `preconditions` names
additional files whose contents govern every test, such as runner configuration.
Configured setup files are included automatically.

Every run contributes coverage data. An observation is **complete** only when
every leaf task in its file passes; a focused, skipped, or failed run is
**partial** and cannot erase an earlier crossing recorded in the same
generation — a test file's current batch of crossings, tied to one fixed set of
preconditions. Each test-file observation records the identities of its own
source, configured setup, additional preconditions, and the instrumented
modules it entered. Changing a precondition starts a new generation for that
file: its inherited crossings are retired, and a partial new generation on its
own cannot justify excluding the file. A CI job can pass its unified diff to
the selector and hand the returned paths to Vitest:

```ts
import { readFile } from 'node:fs/promises';
import {
  selectTestFiles,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';

const diff = await readFile('change.diff', 'utf8');
const testFiles = await selectTestFiles(
  testCoverageFile(process.cwd()),
  diff,
);
```

Hand `testFiles` to Vitest as path filters — for example
`execFileSync('npx', ['vitest', 'run', ...testFiles], { stdio: 'inherit' })` —
since each returned path already matches Vitest's own file-path filter. A
module the instrumenter could not parse is recorded with `instrumented: false`;
selection then widens to the whole module, since it cannot attribute reach to
individual tests without that module's crossings.

The result is a code-unit-sorted list of test-file paths relative to the Vitest
root. It never names individual Vitest cases and does not replace the runner.
Storybook is the exception: because the product owns that execution surface, it
can select one story.

A changed file selects by how the **snapshot** — the persisted coverage file
`withTestSelection` writes — records it. A product module selects the tests
that entered the changed region. A test file selects itself: nothing enters a
test, so its own edit is the only thing that can run it. A precondition selects
every test it governs, which is what declaring one is for. A file the snapshot
never recorded selects nothing, and `narrowByExecution` returns it under
`unread` so a caller can tell that from *nothing entered it*.

The unit of a change is the **line**, in the coordinates of the diff's own base
revision, which is the side the snapshot is indexed by. A hunk header is not the
change: the context lines printed around an edit are unchanged, and charging
them selects the tests that entered the lines a reader was shown rather than the
lines that moved. Within a hunk, each changed line is answered by the narrowest
recorded region containing it, and the selection is the union over lines — one
commit that edits an import and a click handler selects everything the module
selects, not what the handler selects. A run of additions replacing a run of
removals is charged to the removed lines, however far the two counts differ; an
addition replacing nothing is charged to the regions on both sides of the gap it
opens. A line no region covers widens to the whole module. A deleted file is
read from its `--- a/` path, since its hunks are entirely old lines and the
snapshot still holds every crossing it had.

## Record what a driven page executed

A page cannot hold the names, spans, and digests that make a block ordinal mean
something — and the process that built the bundle is usually not the one that
later drives the page. So the two halves are written down separately and joined
by the driver: `testSelectionProbes()` instruments product source in the
adopter's own build and persists the block inventory, the page counts crossings,
and `recordExecution` merges drained journals into the same coverage index
the Vitest seam writes. Same probes, same ordinals, same file.

```ts
// vite.config.ts, or a Storybook `viteFinal`
import { testSelectionProbes } from '@variance-authority/sense/journal';

export default {
  plugins: [testSelectionProbes({ root: process.cwd(), label: 'preview' })],
};
```

`label` separates two builds over one repository — a Storybook preview and the
application a Playwright suite drives are different builds of overlapping source,
and one inventory over both would answer an ordinal with whichever built last.
Give the driver the same label.

The two supported drivers do the draining for you:

- `@variance-authority/storybook-collector` records with `tests: true`, and a
  story is its own owner, because this tool shows one story at a time.
- `@variance-authority/playwright-test` records with the `varianceExecution`
  fixture option, or `tests` on `createVariance`, and every observation in one
  spec file joins that file — the runner's unit of execution is the file, so a
  finer attribution is one no selector could spend.

`testSelectionProbes` takes `root`, `label`, `include`, and `modulesFile` — the
inventory path, which defaults to a repository-keyed file under
`XDG_CACHE_HOME`. `recordExecution` takes the same `root`, `label`,
`modulesFile`, and `coverageFile`, plus `subjects`: one entry per window the
driver closed, each an `owner`, the drained `journal`, optional `preconditions`
naming files whose identity the observation depended on, and `complete`, which is
false for a subject that did not finish and keeps it from ever justifying a skip.
`heads` names other builds the same run drove, whose inventories join this call.

Anything else drives it directly: evaluate `executionCollectorSource()` in the
page if the build does not hoist it, call `drainExecution(page)` to close a
subject's window, and hand the journals to `recordExecution`.

Recording refuses in one direction only. A missing inventory, an inventory from
another probe recipe, and a page with no collector each record **nothing** and
say why — costing the next run its full suite — because half a journal written
as though it were whole is the failure that silently skips a subject. Module-kind
blocks are attributed to *every* subject the run drained: a module initializes
once per page, for whichever subject happened to be first, and charging it to
that one subject would leave every other story that reads the same top-level
constant unselected. Concurrent workers merge under a lock on the index file, so
two processes cannot each write over the other's contribution.

## Follow one execution into a service

The section above records one realm. A suite that drives an application through
its own API executes product source in a second process, and nothing in the page
knows it happened — so a change to a route handler runs every spec, forever.

That process is not a realm. It outlives every subject, it answers several of
them at once, and nobody can evaluate inside it. One counter set in a server is
shared mutable state across concurrent logical flows, and draining it at request
boundaries does not rescue it: a streamed response flushes after its handler
returned, a floating promise settles two requests later, and a time window is not
a journey. The crossing goes to whoever was open at that moment, the subject that
caused it loses it, and the next diff to land there skips that subject silently.

So the key is a **journey**: one opaque id per execution of one subject, minted
by the driver, carried by a cookie, joined afterwards on the id alone. It is
distributed tracing in the vocabulary this repository already uses — the driver
is one participant among several, each reports what it entered under the id, and
the subject's *name* never leaves the driver.

The service wraps whatever it already has around a request:

```ts
import { collectJourneys } from '@variance-authority/sense/journey';

const journeys = collectJourneys({ head: 'api' });

export function handled<Result>(cookie: string | undefined, run: () => Result): Result {
  return journeys.enter(cookie, run);
}
```

`head` is the `label` that service's build gave `testSelectionProbes()` — an
ordinal means something only against the inventory that minted it — and it
defaults to `VARIANCE_AUTHORITY_HEAD`, as `enabled` defaults to whether
`VARIANCE_AUTHORITY_JOURNEYS` is set, so one `env` block configures a service
that names neither. **Told neither, `collectJourneys` installs nothing and
`enter` is the identity**, which is what lets the call above ship to production
rather than being conditional on a build flag.

`enter` takes the request's `Cookie` header, and where the account goes from
there is [`@variance-authority/wire`](../wire/README.md)'s business: the header
carries the execution and the way home together, so the same call serves a
service in another process and a server the suite started inside itself. Nothing
in the head writes a file. A request carrying neither is one the run did not
drive; its crossings join the process's rather than the nearest subject's.

A journey's scope ends when what the body returned *settles*, not when the body
returns. A handler that returns a promise is still inside its journey while that
promise is pending, which is the only arrangement under which the code after an
`await` is attributed at all. `flush` reports what has accumulated without ending
anything; `close` restores the global and reports the rest.

The driver mints and the driver joins, because it is the only participant holding
`journey -> subject`:

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

One `recordExecution` for the run, never one per head. Two calls naming the same
subjects are two runs as far as the merge is concerned, and the second retires
what the first wrote — so `joinObservations` folds the page's rows and every
head's into one row per owner, and `heads` names the labels whose inventories
that one call reads. Two builds of overlapping source can answer the same ordinal
differently; where their inventories disagree about a file, that file is recorded
as not instrumented, so unknown widens where a guess would skip.

`stitchJourneys` takes the `reports` this run was told, the `heads` it declares,
the `owners` map holding `journey -> subject`, and two carriers for the driver's
own knowledge: `preconditions`, the inputs each subject's observation depended
on, and `incomplete`, the subjects the runner already knows did not finish. A
subject the run failed contributes its crossings and can never justify an
exclusion.

`mintJourney` produces a UUID and nothing else. Same-origin is the whole of the
filter on who ever sees it, the browser enforces that, cookies ignore ports, and
a bare UUID has no character an engine encodes differently. Reports for journeys
no subject claimed are counted in `unclaimed` rather than attributed: that is
traffic this run did not drive, and a health check is not a subject. An account
a head could not deliver is counted on the next one it does deliver, and a head
that lost all of them is silent — which the section below answers.

### What a service pays, and what happens without one

Two facts about the setup, and they point in opposite directions.

**Most systems need none of it.** A Storybook preview and a Vitest file are each
one process, and the realm that executes is the realm that is watched. They
declare no heads, so nothing can be missing, and the `heads` list is empty by
default: no cookie is minted, nothing is listening, and no code path above
runs. This is machinery for a product that spans processes, and a product that
does not spans nothing to trace.

**A system that needs it must actually have it.** A head is extra setup — an
instrumented build for the service, an environment block, a line where requests
already pass — and extra setup is always extra: it can be forgotten, it can be
skipped in one CI job, and the service can fail to start. Absence is exactly what
the coverage ground already reads as *unknown*, so the two states this cannot be
allowed to confuse are **the head executed nothing** and **the head was not
watched**.

One report anywhere in the run settles it. A declared head that reported nothing
all run, or one reporting a different probe recipe, sets `complete` to false with
a `because` a report can print, and every subject in the run is recorded
incomplete — including the ones the page observed perfectly. The crossings are
still written and still queryable; what they lose is the right to justify a skip,
so `narrowByExecution` reports them under `entered` and leaves `whole` empty.

That is the deliberate trade. A run that was half-watched narrows nothing rather
than narrowing on the half that showed up, because a selector that skips a spec
on evidence a silent service never contradicted is the one failure this category
cannot detect afterwards.

## Read what a run recorded

`selectTestFiles` answers with paths and `deviationOfTests` with line counts.
Both derive their answer from the snapshot and discard the rest of it. To see the
regions themselves — which blocks a module has and which test files entered each
one — read the snapshot as its logical model:

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
  }
}
```

The snapshot is a binary artifact, so this is the only way to read the evidence
your own runs produced rather than the two summaries above. `mergeCoverage` from
`@variance-authority/sense/vitest` takes and returns this same shape, which is
how a job combines shard snapshots before querying them.

Crossings here name **test files** and carry no call-stack depth. That is the
recorded granularity, not a limit of this reader; see
[Where the index comes from](#where-the-index-comes-from).

## See where two observers parted

`journeyDivergences` answers a question no static reading of the same code can:
**one file, two observers, and not the same path through it.** Three stories
mount `CartCard`, one of them clicks Remove, and the `onClick` body is a region
the other two have never been inside — same file, same import graph, same props.

```ts
import { journeysApart, testCoverageFile } from '@variance-authority/sense/test-selection';

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
      entered  story:cart-card--removing
      missed   story:cart-card--item, story:cart-card--verbose

The pool per module is whoever entered a region with source of its own, which is
not whoever loaded the file: a module root is crossed on import, so every subject
in a bundle crosses every module in it. `observers` narrows further to the
subjects a run actually painted — the snapshot accumulates, and without it a
subject deleted two commits ago stays a party to every parting it was recorded
in. An observation recorded `complete: false` is dropped from the pool rather
than counted as having missed, for the reason `narrowByExecution` states.

`unentered` is the weaker sibling finding: regions with source of their own that
**no** observer entered. Not *these two renders disagree* but *this run never
went here at all*.

## Measure test-file deviation

Deviation compares what a test file can statically reach with what it enters in
a complete instrumented run. Scan both product and test directories, then join
those records to the coverage snapshot:

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

`root` resolves the repository-relative paths in the snapshot. `records` is the
base Sense scan and must include each test file whose deviation is measured.

Each `tests` row is one test file, not one `it` block. `baseline` counts the
non-blank lines in JavaScript and TypeScript modules reachable from that test
file; the test file itself is not part of its baseline. `slice` counts lines
owned by the narrowest entered source regions. The row's `sensitivity` is
`slice.loc / baseline.loc`, and `deviation` is `1 - sensitivity`.

`coverage` is the union of every slice, and `coverageRatio` compares that union
with the union of every baseline. Shared modules and lines count once.
Suite-level `sensitivity` is the arithmetic mean of the per-test ratios, so a
large test file does not outweigh a small one. A missing test-file node or an
opaque dependency leaves that row's `baseline`, `sensitivity`, and `deviation`
absent — check for `undefined` rather than treating a missing value as `0`. If
any row is indeterminate, the suite baseline, coverage ratio, and sensitivity
are absent too.

## Measure what the probes cost

Instrumentation is only worth having while it stays cheap. The probe overhead
`o` — an instrumented run divided by an uninstrumented one — is measured on the
deployment machine over this package's own `scanRelations`:

```bash
node node_modules/@variance-authority/sense/scripts/overhead.mjs
```

Two arms differ only in how much of the clock is spent inside instrumented
JavaScript: a cold arm dominated by the native parser, and a warm arm over a
populated parse cache where nearly every millisecond carries probes. The warm
arm is the closer bound.

## Find tests that cover source

`coveringTests` is the runner-independent point query for coding agents,
editors, and navigation integrations. It takes an `ExecutionIndex` plus a source
line or function, and returns individual test identities ordered by their
shortest observed call-stack depth. `coveringTestsInFile` answers the whole
indexed file in one operation:

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

A line resolves to the innermost real source region containing it, so tests that
only entered an enclosing function do not leak into a branch-line answer. A
function lookup matches its exact indexed name. Repeated observations of one
test collapse to the minimum distance. `id` distinguishes tests with the same
file and name. The bulk result groups adjacent lines with identical tests and
distances into inclusive ranges; an indexed but unreached range has an empty
`tests` list, while lines absent from the instrumented source regions have no
range. Missing source returns no claim; an invalid test reference or distance
throws.

### Where the index comes from

This package ships the query and no producer for it. An `ExecutionIndex` names
individual test cases and records the call-stack distance of every crossing; the
snapshot `withTestSelection` writes does neither, so it cannot be converted into
one. Both absences are deliberate. Attributing crossings to cases rather than
files would make the selector exclude individual tests, which it refuses to do,
and capturing a stack at every probe would cost far more than the overhead
budget instrumentation is kept inside.

Supply the index from a collector that already holds per-case data — an editor's
test runner, a debugger, a language server — or record it yourself.
`@variance-authority/mcp` puts the same query in front of an agent over MCP and
asks exactly this of its caller.

## Related contracts

- `@variance-authority/core` turns records into relations and answers selection questions.
