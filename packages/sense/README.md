<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/sense

**Requires:** a readable checkout for `scanRelations`, or source text plus a
file/module id for the pure readers and transform. Resolution of bare specifiers
also requires the checkout's installed dependencies and any `tsconfig.json` path
mapping they use.

Use this package when a Node process can read a checkout and you need to answer
any of these questions:

- Which files and components can a changed file reach?
- Which execution regions did an instrumented module enter?
- Which Vitest files entered the source regions touched by a diff?
- Which named tests reached a function or line, and at what stack depth?

The package reads source and returns data. Its Vitest integration instruments
product source, attributes entered regions to completed test files, and writes
the coverage index used for selection. Vitest still collects and executes every
test inside each selected file.

## Start with source selection

The main entrypoint walks the configured directories, follows resolvable module
and stylesheet references, and returns one `FileRecord` per file. Pass those
records to [`@variance-authority/core`](../core), which owns the graph and the
selection rules.

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
output, or another path outside `root` are omitted. Use the workspace's project
graph (for example, Nx or Turborepo) to add package-level affected seeds; this
package deliberately does not invent those edges.

An unreadable or unresolved relative edge widens the affected set and is
reported as opaque. A missing bare package is recorded without widening: it is
outside the repository's diff. The distinction prevents uncertainty from being
reported as a smaller, confident selection.

## Entrypoints

| import | Use it for | Requires |
|---|---|---|
| `@variance-authority/sense` | `scanRelations`, the binary source index, and Git content digests | a readable checkout for the scan; persistence is optional |
| `@variance-authority/sense/read` | `readModule` and `readStyle` when source text already comes from a VFS, editor, or bundler | a file id and source string |
| `@variance-authority/sense/instrument` | transforming one module to add execution-presence probes | a module id and source string |
| `@variance-authority/sense/vitest` | adding instrumentation, collection, and persistence to Vitest | Vitest 2 and product tests |
| `@variance-authority/sense/test-selection` | querying named-test reach, measuring test-file deviation, and mapping a unified diff to test files | execution data from a collector; persisted selection queries use the Vitest coverage file |

## Keep repeated scans cheap

The source index is optional. Put it outside the checkout; it is operational
state, not source. It stores parses and resolved records in one versioned binary
generation assembled from immutable segments. Each save appends only changed
rows and tombstones; periodic compaction restores one globally interned segment.

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
or a caller-provided map is used. The
[binary format](../../docs/source-index.md) documents the container, columns and
rejection rules.

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
loop, `switch`, handler, and `await` boundaries. `result.blocks` gives each
probe's ordinal, source range, own-source digest, and enclosing arrival-region
owner. A condition belongs to the region before its outcomes, so changing that
precondition changes the owner's digest while an edit inside one outcome does
not. `sourceDigest` names the exact input and `instrumentation` names the probe
recipe. The original line count is preserved; columns shift because the
transform does not print or source-map the file.

Test selection is added to a runner configuration or CI job; adopters do not
write an adapter or collector. It instruments modules after the runner’s
transform and records coverage at test-file granularity. Its selector returns
test files to run, never individual test cases or a replacement runner. The
runner seams and path-index contract are in
[`spec 0028`](../../docs/specs/0028-the-instrument.md).

If a module cannot be parsed, `instrument` returns `undefined`; treating that as
an empty block list would turn “not instrumented” into “not executed”. A function
stringified into a browser, worker, or other realm loses the generated runtime
declarations and throws at its first probe.

## Select Vitest files from a change

Wrap the existing configuration once. `withTestSelection` preserves configured
plugins, setup files, and reporters. Its default coverage path is under
`XDG_CACHE_HOME`, keyed by the configured repository root, rather than inside the
checkout. The artifact stores paths once and represents blocks and crossings as
aligned typed-array sections with CSR offsets. Only its small versioned section
index is JSON.

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

Every run contributes coverage data. An observation is complete only when every
leaf task in its file passes; focused, skipped, or failed execution remains
partial and cannot erase an earlier crossing from the same generation. Each
test-file observation records the identities of its own source, configured setup,
additional preconditions, and the instrumented modules it entered. A precondition
change starts a new generation: inherited crossings are retired, and a partial
new generation cannot justify excluding the file. A CI job can then pass its
unified diff to the selector and give the returned paths to Vitest:

A transformed module that the instrument cannot parse is recorded with
`instrumented: false`; its missing blocks are unavailable evidence, not an empty
execution result. It cannot attribute reach to individual tests, so selection
must widen at the module boundary without consulting crossings.

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

The result is a code-unit-sorted list of test-file paths relative to the Vitest
root. It never names individual Vitest cases and does not replace the runner.
Storybook is the exception: because the product owns that execution surface, it
can select one story.

A changed file selects by how the snapshot records it. A product module selects
the tests that entered the changed region. A test file selects itself: nothing
enters a test, so its own edit is the only thing that can run it. A precondition
selects every test it governs, which is what declaring one is for. A file the
snapshot never recorded selects nothing.

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
opaque dependency makes that row's `baseline`, `sensitivity`, and `deviation`
absent; it is never reported as zero. If any row is indeterminate, the suite
baseline, coverage ratio, and sensitivity are absent too.

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
editors, and navigation integrations. Given an execution index and a source
line or function, it returns individual test identities ordered by their
shortest observed call-stack depth.
`coveringTestsInFile` answers the whole indexed file in one operation:

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

## Related contracts

- [`@variance-authority/core`](../core) turns records into relations and answers selection questions.
- [`docs/selecting.md`](../../docs/selecting.md) describes the product-level selection behavior.
- [`docs/specs/0028-the-instrument.md`](../../docs/specs/0028-the-instrument.md) sets the acceptance contract for the runner adapter and path index.
