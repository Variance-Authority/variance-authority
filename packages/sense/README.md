<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/sense

> Which components and tests a source change reaches: test selection and impact analysis from a versioned index of a checkout.

**Variance Authority** is a visual regression toolkit for web interfaces: it
compares a rendered subject against an approved baseline and reports which
component caused each change. This package is one piece of it.

**Requires:** a readable checkout for `scanRelations`, or source text plus a
file/module id for the pure readers and transform. Resolution of bare specifiers
also requires the checkout's installed dependencies and any `tsconfig.json` path
mapping they use.

Use this package when you need to answer any of these questions:

- Which files and components can a changed file reach?
- Which Vitest files entered the source regions touched by a diff?
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

Skip it if tests run under something other than Vitest 2, if you need to
exclude individual test cases rather than whole files, or if the instrumented
code will run inside a browser or worker realm — a probe stringified into that
realm throws on its first call. `coveringTests` is the exception: it queries
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
| `@variance-authority/sense/test-selection` | mapping a unified diff to test files, reading the recorded snapshot, and measuring test-file deviation | the Vitest coverage file |
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
never recorded selects nothing.

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
