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
| `@variance-authority/sense` | `scanRelations`, parse caches, record reuse, and Git content digests | a readable checkout for the scan; caches are optional |
| `@variance-authority/sense/read` | `readModule` and `readStyle` when source text already comes from a VFS, editor, or bundler | a file id and source string |
| `@variance-authority/sense/instrument` | transforming one module to add execution-presence probes | a module id and source string |
| `@variance-authority/sense/vitest` | adding instrumentation, collection, and persistence to Vitest | Vitest 2 and product tests |
| `@variance-authority/sense/test-selection` | reading coverage and mapping a unified diff to test files | a coverage file produced by the Vitest integration |

## Keep repeated scans cheap

Both caches are optional. Put them outside the checkout; they are operational
state, not source.

```ts
import { openParseCache, openRecordCache, scanRelations } from '@variance-authority/sense';

const parse = await openParseCache('/var/cache/variance/parse.json');
const records = await openRecordCache('/var/cache/variance/records.json');

await scanRelations({ root: '.', dirs: ['src'], cache: parse, reuse: records });
await Promise.all([parse.save(), records.save()]);
```

The parse cache is keyed by content digest. The record cache is additionally
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
loop, `switch`, handler, and `await` boundaries. `result.blocks` gives each
probe's ordinal and source range. The original line count is preserved; columns
shift because the transform does not print or source-map the file.

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
plugins, setup files, and reporters; its default coverage path is
`.variance-authority/test-coverage.json` under the configured root.

```ts
import { defineConfig } from 'vitest/config';
import { withTestSelection } from '@variance-authority/sense/vitest';

export default withTestSelection(
  defineConfig({
    test: { include: ['src/**/*.test.ts'] },
  }),
);
```

The optional second argument accepts `root`, `coverageFile`, and `include`.
`root` defaults to the configuration root, then the current directory.
`coverageFile` overrides the index path. `include` receives each absolute module
path after Vitest transforms it; use it to restrict instrumentation to product
source. By default, JavaScript and TypeScript modules are included while test,
spec, dependency, and built-output files are excluded.

A complete test run writes the coverage data. A CI job can then pass its unified
diff to the selector and give the returned paths to Vitest:

```ts
import { readFile } from 'node:fs/promises';
import {
  readTestCoverage,
  selectTestFiles,
} from '@variance-authority/sense/test-selection';

const coverage = await readTestCoverage('.variance-authority/test-coverage.json');
const diff = await readFile('change.diff', 'utf8');
const testFiles = selectTestFiles(coverage, diff);
```

The result is a code-unit-sorted list of test-file paths relative to the Vitest
root. It never names individual Vitest cases and does not replace the runner.
Storybook is the exception: because the product owns that execution surface, it
can select one story.

## Related contracts

- [`@variance-authority/core`](../core) turns records into relations and answers selection questions.
- [`docs/selecting.md`](../../docs/selecting.md) describes the product-level selection behavior.
- [`docs/specs/0028-the-instrument.md`](../../docs/specs/0028-the-instrument.md) sets the acceptance contract for the runner adapter and path index.
