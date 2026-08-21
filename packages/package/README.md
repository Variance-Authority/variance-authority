<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/package

**Requires:** a workspace on a disk this process can read — a root `package.json`
whose `workspaces` field names the members, and, for any package that publishes
compiled declarations, a `tsconfig.json` saying which directory they were
compiled from. Nothing has to have been built.

What a repository publishes, as one value: the subpaths each manifest opens, and
every name reachable through them.

## The question

The thing an adopter actually depends on is not a file, it is a name at a
subpath. `@variance-authority/core` exports `digestValue` from `.`; something out
there imports it. Rename it, move it behind a subpath, stop re-exporting it from
the barrel, and every rule a repository normally has stays green — lint reads
syntax, types read a compilation, a boundary rule reads who may import whom. None
of them is watching the edge that breaks somebody else's build.

That edge is a value, so it can have a baseline:

```
removed  /@variance-authority~1core/names/./digestValue
```

This package produces the value. What compares two of them is your business —
that is the whole point of it returning plain JSON.

## Read a workspace

```ts
import { countNames, readSurface } from '@variance-authority/package';

const surface = readSurface('.');

surface['@variance-authority/core']?.declared['files']; // ['dist', 'mark.svg']
surface['@variance-authority/core']?.names['.']?.['digestValue']; // 'function'

countNames(surface); // 1436 — the number that goes to zero when the reading breaks
```

Two halves, and the split is the design. What a package **offers** comes from its
`package.json`, because that manifest is the thing npm uploads and the thing
another project reads. What each entrypoint **reaches** comes from the source
that manifest points at, followed through the barrels — a rule that stopped at
the first `export *` would be watching eight lines instead of a thousand names.

Nothing here opens `dist`. A `types` target of `./dist/index.d.ts` is mapped back
through that package's own `rootDir`/`outDir` to `src/index.ts`, so the names
recorded are the ones somebody wrote and not the ones a build once emitted.

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

Read the removals twice. Those are the ones somebody else's build finds out
about.

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

Each name is recorded as what kind of thing it is and nothing more. An emitted
`.d.ts` states what a compiler inferred; source states what somebody wrote, so
`export const jsxDEV = runtime.jsxDEV` records as a `const` where the emitted
declaration would carry its full signature. **A signature that changes under a
name that does not is a change this misses.** That is a limitation, not an
argument for reading `dist` — which costs a build as a precondition and pays in
stale output.

## What it refuses

A declaration form nobody mapped, a workspace glob more elaborate than `dir/*`, a
`types` target that maps to no file, a name re-exported from a module that does
not publish it: each is an error naming the file, never a quietly smaller
surface. A reader like this fails by returning *less*, and less is what a
re-recorded baseline agrees with forever.
