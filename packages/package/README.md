<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/package

**Requires:** a workspace on a disk this process can read — a root `package.json`
whose `workspaces` field names the members, and, for any package that publishes
compiled declarations, a `tsconfig.json` saying which directory they were
compiled from. Nothing has to have been built.

Use this package when a release or API check needs the package surface as data:
the subpaths each manifest opens and every name reachable through them. It reads
source and manifests directly; it does not need a build or compare two readings
for you.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `.` | nothing | what a workspace offers: manifests, entrypoints, the names behind them |
| `@variance-authority/package/help` | nothing | the same reading joined with what imports it, and the pages made from it |

The second is the first plus a question the first cannot answer: not *what is
published* but *what is used*, which is what turns a thousand equally-weighted
names into a front door and a footnote. It is a separate door because a baseline
of the published surface does not need to walk every file in the repository, and
the reading that ranks does.

## What it checks

A consumer depends on a name at an exported subpath, not on a source file.
`@variance-authority/core` exports `digestValue` from `.`; moving it behind a
different subpath or removing the re-export changes a consumer's import even if
lint, typechecking, and dependency-boundary checks still pass.

`readSurface` records that edge as a value that can have a baseline:

```
removed  /@variance-authority~1core/names/./digestValue
```

This package produces plain JSON. Snapshot storage, comparison, and approval
remain caller-owned so the surface can be used with an existing release check.

## Read a workspace

```ts
import { countNames, readSurface } from '@variance-authority/package';

const surface = readSurface('.');

surface['@variance-authority/core']?.declared['files']; // ['dist', 'mark.svg']
surface['@variance-authority/core']?.names['.']?.['digestValue']; // 'function'

countNames(surface); // number of published names in this workspace
```

Two halves, and the split is the design. What a package **offers** comes from its
`package.json`, because that manifest is the thing npm uploads and the thing
another project reads. What each entrypoint **reaches** comes from the source
that manifest points at, followed through the barrels — a rule that stopped at
the first `export *` would be watching eight lines instead of a thousand names.

Nothing here opens `dist`. A `types` target of `./dist/index.d.ts` is mapped back
through that package's own `rootDir`/`outDir` to `src/index.ts`, so the names
recorded are the ones somebody wrote and not the ones a build once emitted.

## Rank names and find undocumented exports

`readHelp` is the same walk with two more questions asked of it: what was written
above each name, and which packages import it.

```ts
import { readHelp, undocumented } from '@variance-authority/package/help';

const help = readHelp('.', { skip: ['fixtures'] });

const core = help.packages.find((published) => published.name === '@variance-authority/core');
core?.openings[0]?.entries[0]; // the name the most packages reach for, first

undocumented(help).length; // names another package imports and which say nothing
```

Entries arrive ordered by how many packages import them, because everything
downstream truncates and what survives should be what somebody was going to ask
about. `skip` adds directory names the walk never descends into, on top of
`node_modules`, `coverage`, `build` and `out`; a package's own build output needs
no entry, since where it lands is read from that package's `tsconfig.json`.

`help.deep` is the other half of the same reading: every specifier that reaches
into a workspace package past what its `exports` map opens. Those are the imports
that break on a refactor nobody thought was breaking.

## Compare two readings

The value is JSON. Hand it to a snapshot assertion, to `jsondiffpatch`, to
whatever you already have. Handed to [`@variance-authority/core`](../core) it
gains the part neither a reader nor a comparison supplies: every delta carries a
fingerprint that is stable across commits, so an approval keeps meaning the same
thing next week.

```ts
import { readFileSync } from 'node:fs';
import { readSurface } from '@variance-authority/package';
import { compareValues, shapeValue } from '@variance-authority/core';

const dialect = 'package-surface';
const recorded = shapeValue(JSON.parse(readFileSync('surface.json', 'utf8')), { dialect });
const now = shapeValue(readSurface('.'), { dialect });

for (const delta of compareValues(recorded, now)) {
  console.log(delta.change, delta.pointer, delta.fingerprint);
}
```

Treat removals as release-breaking until the consumer that owned the import has
been updated.

## Read one file

The manifests and the traversal are separable, and a `Reader` is one read of one
workspace — its caches live there rather than in module scope, so two readings of
two checkouts stay two questions.

```ts
import { createReader, namesReachedBy, readOfferings } from '@variance-authority/package';

const offerings = readOfferings('.');
const entrypoints = new Map(
  offerings.flatMap((offering) =>
    offering.entrypoints.map((entry) => [`${offering.name} ${entry.subpath}`, entry.source] as const),
  ),
);

const reader = createReader('.', entrypoints);
namesReachedBy(reader, 'packages/core/src/index.ts').get('digestValue'); // Set { 'function' }
```

Pass the entrypoint map when a re-export can hop packages: a bare specifier is
answered from the other manifest rather than resolved, because resolving it would
go through an `exports` map into a built directory.

## What it records, and what it does not

`OFFERED` is the list of manifest keys recorded present-or-absent — `type`,
`main`, `types`, `exports`, `files`, `bin`, `engines`, `sideEffects` — so a
package that *starts* declaring one reads as a change rather than as a silence.
Pass `offered` to narrow it.

Every kind of dependency is deliberately absent, peers included. A dependency
graph is a different subject with different questions — which range, which
duplicate, which transitive licence — and tools built for it answer them. This
reads what a package offers, not what it needs. `version` is out for a duller
reason: it moves every release and would drown the signal.

Each name in the surface is recorded as what kind of thing it is and nothing
more, so **a signature that changes under a name that does not is a change the
surface misses**. The narrowness is the surface's, not the reader's: `readHelp`
carries the head of each declaration — everything written before the body — and a
consumer that wants to watch signatures has them there.

What neither reads is `dist`. An emitted `.d.ts` states what a compiler inferred;
source states what somebody wrote, so `export const jsxDEV = runtime.jsxDEV`
reads as a `const` where the emitted declaration would carry a full type. Reading
the other one costs a build as a precondition and pays in stale output.

## What it refuses

A declaration form nobody mapped, a workspace glob more elaborate than `dir/*`, a
`types` target that maps to no file, a name re-exported from a module that does
not publish it: each is an error naming the file, never a quietly smaller
surface. A reader like this fails by returning *less*, and less is what a
re-recorded baseline agrees with forever.
