<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/sense

**Requires:** a readable checkout for `scanRelations`, or source text plus a
file/module id for the pure readers and transform. Resolution of bare specifiers
also requires the checkout's installed dependencies and any `tsconfig.json` path
mapping they use.

Use this package when a Node process can read a checkout and you need to answer
either of these questions:

- Which files and components can a changed file reach?
- Which execution regions did an instrumented module enter?

The package reads source and returns data. It does not run a test suite, select
tests, collect a test-to-block index, or provide a Vitest, Jest, or Playwright
adapter.

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

To use the transform in a bundler, own the adapter in that bundler and call the
function from its post-transform hook. The smallest adapter shape is:

```ts
import { instrument } from '@variance-authority/sense/instrument';

export function transform(code: string, id: string) {
  if (!/\.[cm]?[jt]sx?$/.test(id)) return null;
  const result = instrument(code, id);
  return result === undefined ? null : { code: result.code, map: null };
}
```

This snippet shows the transform boundary, not a complete runner plugin. The
runner adapter owns file policy and installs a collector before those modules
evaluate. Instrumented code looks up `globalThis.__VA__` with the module id and
block count; the collector returns a `Uint32Array` for that module and associates
the counters with the current attempt. A module transformed without a collector
still runs and keeps counters privately, which is useful for differential
execution but does not identify a test.

The transform provides presence evidence — whether a region was entered. A
Vitest, Jest, or Playwright adapter supplies the runner lifecycle, attempt
identity, flush, and any path index. The runner seams and path-index contract are in
[`spec 0028`](../../docs/specs/0028-the-instrument.md).

If a module cannot be parsed, `instrument` returns `undefined`; treating that as
an empty block list would turn “not instrumented” into “not executed”. Probes
guard their runtime lookup, so a function stringified into a browser, worker, or
other realm still runs without recording there.

## Measure the transform

Run the package-local measurements before adopting the transform. They do not
provide a runner integration:

```bash
npx variance-authority-sense-census
npx variance-authority-sense-overhead
```

`census` counts the regions the transform would add and compares them with
Istanbul's counter sites. `overhead` compares instrumented and uninstrumented
workloads so an adopter can decide whether the transform fits its execution
budget.

To measure source-graph cache behavior on the target checkout, run:

```bash
npx variance-authority-sense-bench
```

## Related contracts

- [`@variance-authority/core`](../core) turns records into relations and answers selection questions.
- [`docs/selecting.md`](../../docs/selecting.md) describes the product-level selection behavior.
- [`docs/specs/0028-the-instrument.md`](../../docs/specs/0028-the-instrument.md) sets the acceptance contract for the runner adapter and path index.
