<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/sense

> Which components and tests a source change reaches: test selection and impact analysis from a versioned index of a checkout.

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

Skip it if tests run under something other than Vitest 2, Jest 30, Storybook,
or Playwright, or if you need to exclude individual test cases rather than whole
files. Code instrumented in an adopter's own build reports through
[`@variance-authority/sense/journal`](#record-what-a-driven-page-executed), which
carries the same probes over a different transport; a *stringified* function is
the one case that cannot work, since text evaluated in another realm has lost
the generated declarations and throws at its first probe. `coveringTests` stands
apart from all of this: it queries execution data from any collector,
independent of the runner — and independent of whether this package produced
it.

```bash
npm install --save-dev @variance-authority/sense
```

`scanRelations` reads a checkout. The pure readers and the transform take source
text plus a file or module id instead, and never look at a disk. Resolving a bare
specifier is the one step that needs the checkout's installed dependencies, and
any `tsconfig.json` path mapping they use.
## Start with source selection

The main entrypoint walks the configured directories, follows resolvable module
and stylesheet references, and returns one `FileRecord` per file — that file's
resolved outgoing edges and content digest. Pass those records to
`@variance-authority/core`, which owns the graph and the selection rules.

Prerequisites are a readable checkout, installed dependencies for bare
specifiers, and any `tsconfig.json` path mappings used by the source.

```ts
import { movedBy, relationsOfFiles } from '@variance-authority/core/relate';
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

## Say what a file really imports

The scan writes down what a file's text says. A test that calls
`vi.mock('./api')` imports `./api` by the letter and runs none of it; a Relay
component that calls `jsresource('./panel')` names a module in a notation no
parser reads and runs all of it. A **taint** is a second table of imports —
per file, what is subtracted and what is added — joined onto the records after
the scan. The records, the parse cache and the record cache are left as they
were read, so the same scan can be viewed under several taints, or none.

```ts
import { scanRelations } from '@variance-authority/sense';
import { mockTaint, taintFile, taintRecords } from '@variance-authority/sense/taint';
import { movedBy, relationsOfFiles } from '@variance-authority/core/relate';

const records = await scanRelations({ root: '.', dirs: ['src'] });
const tainted = await taintRecords(records, [mockTaint(), await taintFile('variance.taint.json')], { root: '.' });
const relations = relationsOfFiles(tainted.records, { shadows: tainted.shadows });

movedBy(relations, ['src/api.ts']).files; // no test that mocks `./api`
```

The two halves land in different places, because they are facts of different
shape. A `+` is one more import the file makes: an edge on its record, resolved
the way the scan resolves any other, and reported in `tainted.additions`. A `-`
is not one edge fewer. `vi.mock('./api')` replaces `api.ts` for the whole of
that test's run — for the test, for the component it imports, for anything
under it — so it is the module taken out of the graph as seen from that file, at
every level. It lands in `tainted.shadows`, keyed by file, and a graph built
with that table carries it into every walk: a file is moved by a change only
when some trail from the change arrives without crossing one of its shadows, and
what is reached only through such a file goes with it. `movedBy` names the files
it left out this way in `shadowed`. The records themselves are not cut, so a
file no taint adds to comes back as the same object.

An addition can name a file outside the directories the scan walked. That file
comes back as a record of its own, carrying `unknown` rather than an empty edge
list: nobody read it, so its imports are unavailable and it widens a selection
instead of narrowing one. Point the scan at its directory to have it read.

Every shadow and every addition keeps the name of whoever said it.
`tainted.shadowedBy` is the file, the file it never reaches, and the taints that
named it; `tainted.addedBy` is the same for additions. Two taints that shadow
one module are both credited, so a test left out of a selection can be traced to
a hand-written table or to the mock reader.

`mockTaint` reads `vi.mock`, `jest.mock` and `sb.mock` calls off test, spec,
story and setup files and shadows the mocked module. Nothing is shadowed when the
factory reaches for the real module through `importActual`, `requireActual` or
`importOriginal`, when the factory is written somewhere this cannot read, when
the mock is a `doMock` that the static imports above it have already evaluated
past, and when the specifier is not a string literal. Pass `callers` to name
other mocking objects and `files` to widen which files are read. `taintFile`
reads a JSON table you keep beside the repository, keyed by file path with `-`
and `+` rows, and `taintTable` builds the same taint from a table already in
memory:

```json
{
  "src/cart.test.ts": { "-": ["./api"] },
  "src/panel.tsx": { "+": ["./panel.relay", "./panel.css"] }
}
```

Under more than one taint the subtractions are unioned and so are the
additions, and the two never contend: an edge one taint adds to a file another
taint shadows is an edge into a node the file's run never enters, and the shadow
holds, the way the mock holds at runtime. The `taints` option of the CLI's
`source` section names the tables, and its mock reader is on whenever the graph
is.

A reader opens files, and that is the cost worth removing on a repository the
size of a monorepo. Hand `taintRecords` the `cache` the scan used — a reader's
answer is a fact about the file's bytes, so it is kept under a digest over those
bytes and the reader's name, and an unchanged file is answered without being
opened or parsed a second time:

```ts
const source = await openSourceIndex('.variance/source-index.bin');
const records = await scanRelations({ root: '.', dirs: ['src'], cache: source.cache, reuse: source.reuse });
const tainted = await taintRecords(records, [mockTaint()], { root: '.', cache: source.cache });
await source.save();
```

### Hold the taints against a record

A taint says what a file's run reaches; a coverage record says what it did.
Where both exist, `auditTaints` holds one against the other and names every
disagreement as a coordinate to look at:

```ts
import { auditTaints } from '@variance-authority/sense/taint';
import { readTestCoverage } from '@variance-authority/sense/test-selection';

const coverage = await readTestCoverage('.variance/test-coverage.bin');
for (const { test, module, kind } of auditTaints(coverage, relations, tainted)) {
  console.log(`${test} ${kind} ${module}`);
}
```

`shadowed-but-entered` is a module the test shadows and the record says it
entered: the taint is wrong about that mock, or the mock did not take.
`reachable-but-not-entered` is a module the test reaches on the graph past its
shadows and nobody entered for it: an import the run never loaded, or a mock no
taint knows about yet. `added-but-not-entered` is an addition the record never
saw the test in. Only an instrumented module testifies, and only a complete
observation testifies to absence. Where a taint said the thing the record
disagrees with, the deviation carries its `taints` — the table or reader to go
and correct. Pass `knownAs` when the record holds a module under a built name.

## Entrypoints

| import | Use it for | Requires |
|---|---|---|
| `@variance-authority/sense` | `scanRelations`, the binary source index, and Git content digests | a readable checkout for the scan; persistence is optional |
| `@variance-authority/sense/read` | `readModule` and `readStyle` when source text already comes from a VFS, editor, or bundler | a file id and source string |
| `@variance-authority/sense/taint` | joining a second table of imports — mocks shadowed, framework notations added — onto scanned records, and auditing it against a record | the records, and a table or a reader that produces the diff |
| `@variance-authority/sense/instrument` | transforming one module to add execution-presence probes | a module id and source string |
| `@variance-authority/sense/vitest` | adding instrumentation, collection, and persistence to Vitest | Vitest 2 and product tests |
| `@variance-authority/sense/jest` | adding instrumentation, collection, and persistence to Jest, around the transformer the project already uses | Jest 30 and product tests |
| `@variance-authority/sense/jest-transform`, `@variance-authority/sense/jest-globals`, `@variance-authority/sense/jest-setup`, `@variance-authority/sense/jest-reporter` | the four modules `withTestSelection` names by path, for a configuration assembled by hand | Jest 30 |
| `@variance-authority/sense/journal` | instrumenting an adopter's build and recording what a driven page executed | a Vite-compatible build, and a driver that can evaluate in the page |
| `@variance-authority/sense/journey` | carrying one execution across processes, so a service's crossings join the subject that caused them | a service running Node, its own instrumented build, and a driver that sets a cookie |
| `@variance-authority/sense/test-selection` | mapping a unified diff to test files, reading, folding, and writing the recorded snapshot, and measuring test-file deviation | the coverage file a runner or journal seam wrote |
| `@variance-authority/sense/test-selection` (same import) | placing a selection by how far the change travelled, and cutting it into bands a loop can run one leg at a time | the same coverage file, and an import graph to walk |
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

`parsed` hands each file's parse to you as the scan settles it — the
repository-relative path and what the bytes said, once per file, reused records
included. A caller that wants a different reading of the same bytes (which names
one file imports, where each specifier is written, what it exports) otherwise
has to walk and parse the tree a second time; handed this, that second reading
of an unchanged tree costs a map lookup per file. The value is the cached parse
itself rather than a copy, so treat it as read-only.

```ts
await scanRelations({
  root: '.',
  dirs: ['src'],
  cache: source.cache,
  reuse: source.reuse,
  parsed: (file, parse) => { exports.set(file, parse.exports); },
});
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
write an adapter or collector. It instruments modules after the runner's
transform and records coverage at test-file granularity. Its selector returns
test files to run, never individual test cases or a replacement runner.

If a module cannot be parsed, `instrument` returns `undefined`. Check for that
before reading `result.blocks`: a missing result and an empty block list are
different facts, and only the caller can keep them apart. A function
stringified into a browser, worker, or other realm loses the generated runtime
declarations and throws at its first probe.

The fourth argument picks the recipe. `{ mode: 'entries' }` places a probe at
the module and at every function body and nothing inside them — no branch,
loop, handler or `await` — so a run pays one probe per function rather than one
per decision. A function has the same name and path under either mode; what
changes is how many regions there are. The two recipes number regions
differently, so each reports under its own `instrumentation` id:
`instrumentationId(mode)` gives it and `instrumentModeOf(id)` reads it back,
and nothing that reads one recipe's records, journals or snapshot accepts the
other's.

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

The optional second argument accepts `root`, `coverageFile`, `include`,
`preconditions`, and `mode`. `root` defaults to the configuration root, then the current
directory. `coverageFile` overrides the cache path, including when CI needs a
named artifact. `include` receives each absolute module path after Vitest
transforms it; use it to restrict instrumentation to product source. By default, JavaScript and TypeScript modules are included while test,
spec, dependency, and built-output files are excluded. `preconditions` names
additional files whose contents govern every test, such as runner configuration.
Configured setup files are included automatically, and the runtime's own setup
file is placed ahead of them, so a setup file that loads an instrumented module
finds the counter factory it needs; a setup entry that names a package rather
than a file is not a precondition, since no diff carries it. A run that shares
one module graph across files — `isolate: false` — still records every file
that consumed a module as having entered it, and what the module did while
evaluating is credited to those files and to no other. A file consumes a module
by running something in it: a module of nothing but constants, evaluated once
for an earlier file and only read by the next, is recorded for the file that
evaluated it and not for the reader.

A configuration with `projects` needs the wrap in two places, because a Vitest
project inherits neither plugins nor setup files from the configuration around
it. Wrap each project, so each one carries the instrumenting plugin and the
setup file that installs the counter factory, and keep one wrap at the root for
the reporter that folds the run — every project writes its journals to the same
snapshot, which is the point. A root-only wrap is the shape that looks right and
records nothing: the reporter runs, the file is written, and it says every test
reaches no source. The run that does that says so on the way out —
`instrumented 0 modules across N test file(s)` — because the alternative is a
selection that narrows to the empty set and a CI job that passes having run
nothing.

`mode: 'entries'` records module and function entries only, under a recipe of
its own, for a suite that needs to know which functions a test reached and not
which branches. Under either mode, each file's setup takes a snapshot of every
counter before its first test runs, and a region already entered by then is
recorded as **loaded** by that file as well as crossed by it: a function that
ran because the module was imported, not because a test called it. A function
that runs at import time is a side effect every consumer pays for and a test
order can change, and `loadedBy` on the block is where a reader finds it.

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
  narrowByExecution,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';

const diff = await readFile('change.diff', 'utf8');
const { entered, unread } = await narrowByExecution(
  testCoverageFile(process.cwd()),
  diff,
);
```

Hand `entered` to Vitest as path filters — for example
`execFileSync('npx', ['vitest', 'run', ...entered], { stdio: 'inherit' })` when
it names anything — since each returned path already matches Vitest's own
file-path filter. Run nothing when it is empty: Vitest with no filter runs the
whole suite, and an empty answer is the record saying nobody ran what changed.
`selectTestFiles` returns `entered` alone. A module the instrumenter could not
parse is recorded with `instrumented: false`; selection then widens to every
test that loaded it, each of which holds the module as a precondition, since it
cannot attribute reach to individual tests without that module's crossings.
`unread` names the changed paths nothing recorded holds — a README, a fixture
read with `fs`, a script the tests spawn — and a suite that depends on one
declares it as a precondition.

The result is a code-unit-sorted list of test-file paths relative to the Vitest
root. It never names individual Vitest cases and does not replace the runner.
Storybook is the exception: because the product owns that execution surface, it
can select one story.

A changed file selects by how the **snapshot** — the persisted coverage file
`withTestSelection` writes — records it. A product module selects the tests
that entered the changed region. A test file selects itself: nothing enters a
test, so its own edit is the only thing that can run it. A precondition selects
every test it governs, which is what declaring one is for.

A changed file with no row is dead or an asset. A module nobody executed —
every test that imports it mocks it, or nothing loaded it — has no row, and
the tests that import it never ran a line of it: it selects nobody, and so does
everything only it imports. A stylesheet, an image, a JSON file can hold no
probe, so it never has a row, and whether a test ran it is a question about the
module that imported it. `narrowByExecution(file, diff, { relations })` takes
the `Relations` that `relationsOfFiles` in `@variance-authority/core` builds
from a `scanRelations` pass and walks from the changed file through `asset`
edges, which is the kind the scan gives an import of anything that is not a
module: through the stylesheets that import the stylesheet, to the modules that
import those, and no further, since nothing imports a module as an asset. A
module reached with a row selects every test that entered it; a module reached
without one is dead. A file whose own edges the scan could not read may reach
the asset by an edge nobody saw, so its tests are selected as well. A snapshot
that holds a file under another name — the built twin a sibling package's
tests loaded — is looked up under every name `knownAs` returns for it, the
changed file and each module reached alike.

What comes back under `unread` is a changed path nothing recorded holds: no
row, no precondition, and no place in the graph, or a caller with no graph. It
is a report rather than a widening. A fixture the tests read with `fs`, a
script they spawn, a file loaded any way an import graph cannot see, is
declared as a precondition, which is what declaring one is for.

`narrowByExecution` also returns `because`: one entry per selected test, in the
order of `entered`, holding every reason it is there. A reason is a `region` —
the file, the name and the path of the innermost recorded block a changed line
fell in, with its lines — a `precondition` by name, or an `importer` with the
trail from the changed file to the file the test was found through. A watch
loop prints it beside each path it runs, which is how a selection stops being
an oracle.

The snapshot carries the commit it was recorded at, which is the whole of its
position in time and space. There is one master branch and every other checkout
is that branch plus a diff — or minus one, where it is behind — so
`git diff <commit> HEAD` and the working tree are the distance in either
direction, and `readTestCoverage(file)` hands the ref back under `commit` for a
caller to diff from. Merging leaves the index standing where the run that merged
into it stands; whether an individual block's crossings survived that merge is a
finer question, decided per region by the region's own digest. A recording made
outside a checkout has no commit, and an index that cannot say where it is has
nothing to diff against, so a caller holding one runs the suite it would have run
anyway.

The unit of a change is the **line**, in the coordinates of the diff's own base
revision, which is the side the snapshot is indexed by. A hunk header is not the
change: the context lines printed around an edit are unchanged, and charging
them selects the tests that entered the lines a reader was shown rather than the
lines that actually changed. Within a hunk, each changed line is answered by the narrowest
recorded region containing it, and the selection is the union over lines — one
commit that edits an import and a click handler selects everything the module
selects, not what the handler selects. A line that opens or closes the
narrowest region is the enclosing region's line as well — the condition of an
`if`, the other props beside a one-line handler — and charges it too, out to
the first region that holds the line in its interior. A run of additions replacing a run of
removals is charged to the removed lines, and any addition past the count
removed to the gap it opens after the last of them; an addition replacing
nothing is charged to the regions on both sides of the gap it opens. A line no region covers widens to the whole module. A deleted file is
read from its `--- a/` path, since its hunks are entirely old lines and the
snapshot still holds every crossing it had; a renamed file's hunks are read
under its old name the same way, and its new name is asked of the graph.

A run that loads only some of the modules the index holds carries the rest as
they were. A carried module whose text on disk is no longer the text its rows
were recorded over has rows no diff can be placed in, so every test that
entered it is marked partial and runs at the next selection regardless.

## Place a selection by how far the change travelled

A selection tells you which tests to run. It does not tell you which to run
first, and after a change to a shared module most of the suite is selected.
Distance answers the second question: for each selected test, the shortest
import path from the change to it, counted only through the modules that test
actually entered.

The count is worth having because the selection is not flat. The edited module's
own test is one hop away and its callers' tests are two, so a failure at one hop
has one explanation where a failure at four has a chain of them.

`distanceByExecution` reads the snapshot once and returns both readings:

```ts
import {
  distanceByExecution,
  indexFaces,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';

const { narrowing, distances } = await distanceByExecution(
  testCoverageFile(process.cwd()),
  diff,
  { relations, faces: indexFaces(relations) },
);
```

`relations` is the graph the path is walked in — what `relationsOfFiles` builds
from a `scanRelations` pass — and without it nothing can be placed. `knownAs`
gives every name one module is held under, so a built copy in the graph and a
source file in the record count as the same module. `faces` says where a unit's
public entry point is; without it, every file reads as its own entry point.

Restricting the walk to entered modules is what makes the number worth reading.
`dependentsOf` over the graph alone finds a shortest path from any change to any
file, and that path can run through a module the test never loaded — a helper
behind a branch nobody took. `distanceFromView` is the same reading over a
snapshot you already opened, and `nearestFirst` is the comparison both sort by.

Each `TestDistance` carries a `bearing`. Four of the six carry a hop count and
two carry none:

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
- `unmeasured` — the graph could not answer. It carries `because`, naming the
  gap: a built artifact the scan does not read, a directory it was not pointed
  at, a file whose imports nothing could enumerate.

`reach-through` and `unexplained` are findings with an address, and neither
needs a red test to be worth reading. `unmeasured` is the opposite of a finding,
and the distinction is load-bearing: a walk that was never possible
must not print as a walk that failed, or every unscanned directory becomes an
accusation. Pass `enumerated` — whether the graph read what a file imports,
which only whoever built the graph knows — and a dead end there is reported as
the hole it is.

A *unit* is a directory whose contents are meant to be reached through one file.
That is a convention rather than a fact about the filesystem, so you supply it.
`indexFaces` reads the one this repository and most others keep — a directory
with an `index` module — and `eitherFace` stacks your own provider in front of
it, which is where a manifest reader belongs: this package depends on what it
needs, and a manifest is not it.

## Run the near end of a selection first

`atDistance` takes the tests a given number of imports from the change, so a
loop can spend six seconds finding out it was wrong before it spends eleven
minutes finding out it was right:

```ts
import { atDistance, distanceRange, remaining } from '@variance-authority/sense/test-selection';

const { from, to } = distanceRange('0-2') ?? { from: 0, to: Number.MAX_SAFE_INTEGER };
const running = atDistance(distances, from, to);
const later = remaining(distances, from, to);
```

The range is hop counts. `0-2` is every selected test no more than two imports
from the change, and it asks the same question whatever the reading turned out
to hold: if the nearest test is five hops away, `0-2` runs nothing — no test is
that close — and `3-` runs all of them. `distanceRange` reads `2`, `0-2`, and
`3-` (*three and beyond*, which is what a last leg asks for and cannot spell in
advance), and returns nothing for anything else, so a caller reports the typo
rather than quietly running one distance.

Start a near range at `0` rather than `1`. Zero is a distance and a common one
in an edit loop: it is a test whose own source you just changed, and a range
starting at one leaves it until last.

A test nobody could place runs with the range that reaches the end — the one
whose far edge is open, or is at least the furthest distance measured. It is not
distance zero, which says the opposite. So `0-2` and then `3-` runs every
selected file exactly once, and no near range is made expensive by everything
nobody could place.

`remaining` names what a range left behind rather than counting it, because *26
files were not run* is a number and *these 26 files were not run* is the thing
somebody hands to CI. Every range is a smaller claim than the selection, which
is already a smaller claim than the suite: a green `0-2` says the nearest tests
pass and says nothing at all about four hops. Printing that sentence is the
caller's job. `groupByDistance` reports the whole reading as one group per hop
count, which is the table to print beside the range you took out of it, and
`yarn test:since --at-distance 0-2` in this repository is the worked example.

## Select Jest files from a change

Wrap the existing configuration once. `withTestSelection` preserves configured
transforms, setup files, and reporters. Each `transform` entry is wrapped so the
project's own transformer — `@swc/jest`, `ts-jest`, `babel-jest`, any module
with Jest's transformer shape — still runs first, on its own pattern with its
own options, and the probes land on what it produced. `setupFiles` keep their
order and gain the runtime's counter factory at the start, ahead of a setup
file of the project's that loads an instrumented module; `setupFilesAfterEnv`
keep theirs and gain the journal writer at the end; reporters keep theirs and
gain one at the end, and a configuration with no reporters keeps Jest's default
one.

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

The optional second argument accepts `root`, `coverageFile`, `preconditions`,
and `mode`, with the meanings the Vitest seam gives them; there is no
`include`, because product source is every JavaScript and TypeScript module the
configuration's `testMatch` or `testRegex` does not name, less dependencies and
built output, and a test file selects itself and is not a module. A setup
entry that names a package rather than a file — `dotenv/config` — is left
alone and is not a precondition, since no diff carries it. A configuration
with `projects` is instrumented project by project, each keeping its own
transform and setup files, with one reporter for the run; a project named by
path rather than spelled inline is refused, because its transform cannot be
wrapped from here.

Jest transforms inside the workers it forks and keeps the transformed text on
disk under a content key. The probes ride that cache. A module whose content
and transform options have not changed is neither transformed nor parsed again
on any later run or in any worker, and the record of what its probes mean is
stored under the same key inside Jest's `cacheDirectory`, so `jest --clearCache`
discards both halves together. Each test file writes one journal to disk from
`afterAll`; nothing crosses the worker channel, and the reporter folds the
journals when the run completes and lands the result through `mergeCoverage`.
The snapshot is the file the Vitest seam and the journal seam write, so a
repository whose unit tests run under Jest and whose pages are driven by
Playwright selects from one index.

Selection is the same call as for Vitest: `selectTestFiles` over a unified diff
returns test-file paths relative to the Jest root, and each is a path pattern
Jest accepts on its command line — `jest test/alpha.case.ts test/beta.case.ts`.

## Record what a driven page executed

A page cannot hold the names, spans, and digests that make a block ordinal mean
something — and the process that built the bundle is usually not the one that
later drives the page. So the two halves are written down separately and joined
by the driver: `testSelectionProbes()` instruments product source in the
adopter's own build and writes each module's block record down, the page counts
crossings,
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
and one store over both would answer an ordinal with whichever built last. Give
the driver the same label.

A module reports the id it was instrumented under, and that id is the digest of
its repository-relative path. Nothing allocates it, nothing keeps a table of it,
and no build has to have ended for it to mean something: transform ten files of
two hundred thousand, in parallel, in any order, and the ten records that land
are the only ones that had to move.

The two supported drivers do the draining for you:

- `@variance-authority/storybook-collector` records with `tests: true`, and a
  story is its own owner, because this tool shows one story at a time.
- `@variance-authority/playwright-test` records with the `varianceExecution`
  fixture option, or `tests` on `createVariance`, and every observation in one
  spec file joins that file — the runner's unit of execution is the file, so a
  finer attribution is one no selector could spend.

`testSelectionProbes` takes `root`, `label`, `include`, and `cacheRoot` — where
the label's store lives, which defaults to `XDG_CACHE_HOME`. `recordExecution`
takes the same `root`, `label`, `cacheRoot`, and `coverageFile`, plus `subjects`: one entry per window the
driver closed, each an `owner`, the drained `journal`, optional `preconditions`
naming files whose identity the observation depended on, and `complete`, which is
false for a subject that did not finish and keeps it from ever justifying a skip.
`heads` names other builds the same run drove, whose stores join this call.
`commit` overrides where the recording stands, which otherwise reads the
checkout's `HEAD`.

Anything else drives it directly: evaluate `executionCollectorSource()` in the
page if the build does not hoist it, call `drainExecution(page)` to close a
subject's window, and hand the journals to `recordExecution`.

Recording refuses in one direction only. A run whose reported modules no store
can identify, a record from another probe recipe, and a page with no collector
each record **nothing** and say why — costing the next run its full suite — because half a journal written
as though it were whole is the failure that silently skips a subject. Every region
entered while a module was evaluating is attributed to *every* subject the run
drained: a module initializes once per page, for whichever subject happened to
be first, and charging its root and the helpers it called to that one subject
would leave every other story that reads the same top-level constant unselected.
The instrumented module marks that window itself, and the join reads the mark.
Concurrent workers merge under a lock on the index file, so two processes cannot
each write over the other's contribution.

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
ordinal means something only against the record that minted it — and it
defaults to `VARIANCE_AUTHORITY_HEAD`, as `enabled` defaults to whether
`VARIANCE_AUTHORITY_JOURNEYS` is set, so one `env` block configures a service
that names neither. **Told neither of them, `collectJourneys` installs nothing
and `enter` is the identity**, which is what lets the call above ship to production
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
head's into one row per owner, and `heads` names the labels whose stores that
one call reads. Two builds of overlapping source can answer the same ordinal
differently; where their stores disagree about a module, that module is recorded
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
runs. This is machinery for a product that spans processes; a product that
does not has nothing to trace.

**A system that needs it must actually have it.** A head is extra setup — an
instrumented build for the service, an environment block, a line where requests
already pass — and extra setup is always extra: it can be forgotten, it can be
skipped in one CI job, and the service can fail to start. Absence is exactly what
the coverage index already reads as *unknown*, so the two states this cannot be
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
    // Entered before these files' first test ran: a consequence of loading the
    // module, not of a test. Absent when no file had.
    if (block.loadedBy !== undefined) console.log('  loaded by', block.loadedBy);
  }
}
```

The snapshot is a binary artifact, so this is the only way to read the evidence
your own runs produced rather than the two summaries above. `writeTestCoverage`
is the other direction — the same shape, landed whole under a rename, where
`readTestCoverage` and every runner seam will find it.

Crossings here name **test files** and carry no call-stack depth. That is the
recorded granularity, not a limit of this reader; see
[Where the index comes from](#where-the-index-comes-from).

## Fold shards into one snapshot

A suite too large for one machine runs across N jobs and ends with N snapshots,
each a whole observation of its own test files and a partial one of every module
they share. Every question is about the suite, and no shard can answer it.
`foldTestCoverage` is the union the unsharded run would have written, and it is
the same union in any order:

```ts
import { readFile } from 'node:fs/promises';
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
await writeTestCoverage('coverage.bin', suite);
```

It refuses by name, on the rule `variance report` folds reports under: the
result must not be able to say anything one run could not. Shards recorded
under different probe recipes or at different commits were not one run — and
*absent* is a value there, so a shard recorded outside a checkout does not fold
under a commit it never named. A test file two shards both recorded is a split
that overlapped, and a module two shards built from different source has
regions that do not name each other. Where the shards agree, unknown wins: a
module one shard could not instrument is unread in the fold, because the row a
reader widens on must not be outvoted by the shards that measured it.

A fold is a fan-in and `mergeCoverage` is a layer; the two are not
interchangeable. A layer positions the result where the newer side stands and
retires what that side re-recorded whole, which is what landing a run over a
baseline means and would make a fold depend on the order its shards were named
in. A test the newer side did not run is carried as it was, unless a region it
entered was rewritten underneath it: then it is carried incomplete, runs at the
next selection whatever changed, and is recorded whole again by that run. Land
a fold the way a runner lands a run:

```ts
const file = testCoverageFile(process.cwd());
const previous = await readTestCoverage(file).catch(() => undefined);
await writeTestCoverage(file, mergeCoverage(previous, suite));
```

Each shard is recorded by its own runner through the ordinary seams, with
`coverageFile` pointing at the job's artifact; `variance journeys` performs the
fold and the landing from the command line, and its README carries the CI
recipe.

## See where two observers parted

`journeysApart` answers a question no static reading of the same code can:
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

The two measurements differ only in how much of the clock is spent inside
instrumented JavaScript. The cold one is dominated by the native parser; the
warm one runs over a populated parse cache, where nearly every millisecond
carries probes. The warm number is the closer bound.

The transform is paid once per changed file rather than once per test: about
0.14 ms a module, two fifths of it already the platform's. Digests are taken
from `node:crypto`, and the parsed tree crosses out of `oxc` without a JSON
round trip on any 64-bit little-endian host. Where that transfer is unavailable
the same tree arrives more slowly and the records are identical.

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

- [`docs/source-structures.md`](../../docs/source-structures.md) and [`docs/execution-record.md`](../../docs/execution-record.md) are the references for the structures this package reads and writes: primary keys, lookups, traces, and their costs.
- `@variance-authority/core` turns records into relations and answers selection questions.
