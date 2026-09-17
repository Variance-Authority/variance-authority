<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/package

> Read a TypeScript workspace API surface as data: every entrypoint a manifest opens and what each one exports, for release and breaking-change checks.

Part of [Variance Authority](https://variance-authority.dev), a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source.

This package reads a TypeScript workspace's public API as data: a **surface**.
For each package it records which subpaths a manifest opens — an **entrypoint**
— and which exported identifiers, or **names**, each entrypoint **reaches** by
following re-exports through barrel files to their source. It reads source and
manifests directly, never a build. It is a release and breaking-change tool: it
tells you what an API looked like and what changed about it.

```bash
npm install --save-dev @variance-authority/package
```

Point it at a checkout, built or not. It reads the root `package.json` for the
`workspaces` field listing the members, and, for a package that publishes
compiled declarations, the `tsconfig.json` saying which directory they were
compiled from.

## Entrypoints

| entrypoint | requires | holds |
|---|---|---|
| `.` | nothing | what a workspace offers: manifests, entrypoints, the names behind them |
| `@variance-authority/package/help` | nothing | the same reading joined with what imports it, and the pages made from it |

`/help` runs the same read as `.` and adds two more: what was written above each
name, and which packages import it. Names come back ordered by how many
packages import them, so the ones most consumers depend on sort first. It is a
separate entrypoint because that ranking requires walking every file in the
repository, and a plain published-surface reading does not.

That walk already knows the file and the line of every import, so `/help` keeps
them rather than only counting them, and marks each one a story, a test or
ordinary source by the marker in its own filename.

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

Each package's entry in the surface has two parts: `declared`, read straight
from `package.json`, and `names`, read from the source file each entrypoint
points at. `names` is built by following re-exports through barrel files, not
just the first `export *`, so a package that re-exports groups of modules still
has every name it makes available counted.

Nothing here opens `dist`. A `types` target of `./dist/index.d.ts` is mapped back
through that package's own `rootDir` and `outDir` to `src/index.ts`, so the names
recorded are the ones somebody wrote, not the ones a build emitted.

## Rank names and find undocumented exports

`readHelp` is the same walk with two more questions asked of it: what was written
above each name, and which packages import it.

```ts
import { readHelp, undocumented } from '@variance-authority/package/help';

const help = readHelp('.', { skip: ['fixtures'] });

const core = help.packages.find((published) => published.name === '@variance-authority/core');
core?.openings[0]?.entries[0]; // the name the most packages reach for, first

undocumented(help).length; // names another package imports that say nothing
```

Entries arrive ordered by how many packages import them. `skip` adds directory
names the walk never descends into, on top of the defaults `node_modules`,
`coverage`, `build`, `dist` and `out`; a package's own build output needs no
entry, since where it lands is read from that package's `tsconfig.json`.

Each entry carries `sites` alongside the count: every place that imports the
name, with the file, the line, and whether that file is a story, a test or
ordinary source. A story and a test are written to *show* a name in use, which
is what an example is, so they answer a different question from a consumer and
are separable without re-reading a path.

```ts
const entry = core?.openings[0]?.entries[0];
entry?.sites.filter((site) => site.kind === 'story'); // where it is demonstrated
entry?.mention; // what the nearest README says, when nothing is written above it
```

`mention` is present only where `doc` is absent and the nearest `README.md` above
the declaring file writes the name as a whole word. It carries the file, the line
and the passage, and it is never merged into `doc`: prose written about a package
is written for a different reader than a comment written above a function, and
counting the first as the second would take the name out of `undocumented`
without anybody having documented it.

`help.exported` is every name the repository's own files export, published or
not — a few hundred names are published here and three thousand are exported.
Each one carries a name, a file, a line, the package the file belongs to and
whether it was written in source, a test or a story, and nothing else, because
nothing else was read for it. It answers *where is the thing that does X* for
the code that was never something to publish, and it is kept apart from
`packages` rather than merged into it so an answer can still say which of the
two it found.

```ts
help.exported.filter((named) => named.name.includes('Viewport'));
// [{ name: 'parseViewport', at: '…/viewport.ts', by: '@variance-authority/…', line: 31, … }]
```

`usage` is the way out of paying for the walk twice. The third reading — every
module file in the repository, opened and parsed — is the expensive one, and a
caller that already holds it passes it in, leaving this to read the manifests
and the entrypoints only.

```ts
readHelp('.', { usage }); // the same value, without re-reading the tree
```

`help.deep` is the other half of the same reading: every specifier that reaches
into a workspace package past what its `exports` map opens — an import that
depends on internals the manifest never promised to keep stable.

## Compare two readings

The value is JSON. Hand it to a snapshot assertion, to `jsondiffpatch`, to
whatever you already have. Handed to `@variance-authority/core`, it
gains the part neither a reader nor a comparison supplies: every delta carries a
fingerprint that is stable across commits, so an approval keeps meaning the same
thing next week.

```ts
import { readFileSync } from 'node:fs';
import { readSurface } from '@variance-authority/package';
import { compareValues } from '@variance-authority/core/compare';
import { shapeValue } from '@variance-authority/core/format';

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

No dependency information is recorded — no `dependencies`, `peerDependencies`,
or `version`. This reads what a package offers as an API, not its dependency
graph or its release history.

`readSurface` records each name as what kind of thing it is (function,
interface, `const`, and so on) and nothing more, so **a signature that changes
under a name that does not is a change the surface misses**. `readHelp` carries
the head of each declaration — everything written before the body — for a
consumer that needs to watch signatures too.

A site is an import, not a call. `readHelp` records the line a name was brought
into a file on, and where it is used inside that file is a question for a
language server. Nor is a site ranked by import distance: `sites` is a list in
reading order, and how far one module sits from another through the graph is
`@variance-authority/sense`'s reading, over an index this one does not build.

What neither reads is `dist`. An emitted `.d.ts` states what a compiler inferred;
source states what somebody wrote, so `export const jsxDEV = runtime.jsxDEV`
reads as a `const` where the emitted declaration would carry a full type. Reading
the other one costs a build as a precondition and pays in stale output.

## What it refuses

An unmapped declaration form, a workspace glob more elaborate than `dir/*`, a
`types` target that maps to no file, or a name re-exported from a module that
does not publish it — each of these makes the read throw an `Error` naming the
file, rather than silently producing a smaller surface.

---

**[@variance-authority/package](https://variance-authority.dev/reference/packages/package)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
