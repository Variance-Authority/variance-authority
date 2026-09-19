<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/package

> Read a TypeScript workspace API surface as data: every entrypoint a manifest opens and what each one exports, for release and breaking-change checks.

Part of [Variance Authority](https://variance-authority.dev).

This package supplies one of those readings, and it is the one that never
renders anything. It reads a TypeScript workspace's public API as data: a
**surface**. For each package it records which subpaths a manifest opens — an
**entrypoint** — and which exported identifiers, or **names**, each entrypoint
**reaches** by following re-exports through barrel files to their source. It
reads source and manifests directly, never a build. Nothing here opens a
browser, and no subject — one named UI state you asked for and can ask for
again — is involved: this is the release and breaking-change reading, and you
can use it on its own.

## What it checks

A consumer depends on a name at an exported subpath, not on a source file.
`@variance-authority/core` exports `digestValue` from `.`; moving it behind a
different subpath or removing the re-export changes a consumer's import even if
lint, typechecking, and dependency-boundary checks still pass.

`readSurface` records that edge as a value that can have a baseline — an earlier
reading you keep and compare against:

```
removed  /@acme~1parser/names/./VERSION
```

## Requirements

Node 22 or newer. Every `@variance-authority/*` package is ESM-only
(`"type": "module"`), so import it from a module, not a `require`.

There is no CLI. The first step is to write a script — a Node module, a Vitest
test, whatever your release check already is — and call the reader from it.

What it reads to find your packages:

| Question | Answer |
| --- | --- |
| Which packages are in the workspace | The root `package.json` `workspaces` field, as an array or as `{ "packages": [...] }`. A path, or a glob ending in `/*`; anything more elaborate throws. |
| pnpm or Bun workspace files | Not read. A `pnpm-workspace.yaml` with no root `workspaces` field reads as a workspace with no members. |
| A repository with one package and no `workspaces` | Read as a single package. This is a supported case, not a degenerate one. |
| A repository with no root `package.json` | Publishes nothing, which is an answer rather than an error. `readHelp` still reads every name the source exports. |
| `private: true` | The only filter. A private package is skipped. |
| TypeScript `paths` aliases | Not followed. A re-export through an alias records the name with the kind `foreign` rather than the kind behind it. |
| A built `dist` | Never opened. A `types` target of `./dist/index.d.ts` is mapped back through that package's own `rootDir` and `outDir` to `src/index.ts`. |

```bash
npm install --save-dev @variance-authority/package
```

## Read a workspace

Point it at a checkout, built or not.

```ts
import { countNames, readSurface } from '@variance-authority/package';

const surface = readSurface('.');

for (const [name, published] of Object.entries(surface)) {
  for (const [subpath, names] of Object.entries(published.names)) {
    console.log(name, subpath, Object.keys(names).length, 'names');
  }
}

console.log(countNames(surface), 'published names in this workspace');
```

Each package's entry has two parts: `declared`, read straight from
`package.json`, and `names`, read from the source file each entrypoint points
at. `names` is built by following re-exports through barrel files, not just the
first `export *`, so a package that re-exports groups of modules still has every
name it makes available counted.

### What you get

`readSurface` returns plain JSON. A workspace with one published package,
`@acme/parser`, whose `src/index.ts` re-exports a function and an interface from
`src/parse.ts` and declares a `const` of its own:

```json
{
  "@acme/parser": {
    "declared": {
      "type": "module",
      "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
      "files": ["dist"]
    },
    "names": {
      ".": {
        "Document": "interface",
        "VERSION": "const",
        "parseDocument": "function"
      }
    }
  }
}
```

`declared` holds the manifest keys `OFFERED` names, present-or-absent. `names`
is one object per subpath the manifest opens, mapping each reachable name to
what kind of thing it is.

## Rank names and find undocumented exports

`readHelp` is the same walk with two more questions asked of it: what was
written above each name — its **doc**, the block comment the declaration carries
— and which packages import it. Names come back ordered by how many packages
import them, so the ones most consumers depend on sort first.

```ts
import { readHelp, undocumented } from '@variance-authority/package/help';

const help = readHelp('.', { skip: ['fixtures'] });

for (const published of help.packages) {
  for (const opening of published.openings) {
    const [busiest] = opening.entries;
    console.log(published.name, opening.subpath, '→', busiest?.name, busiest?.uses, 'uses');
  }
}

for (const entry of undocumented(help)) {
  console.log(`${entry.at}:${entry.line}`, entry.name, 'used by', entry.usedBy.join(', '));
}
```

`openings` is the `readHelp` name for what the surface calls `names`: one entry
per subpath the manifest opens, carrying that subpath, the source file behind
it, and the ranked `entries`. `skip` adds directory names the walk never
descends into, on top of the defaults `node_modules`, `coverage`, `build`,
`dist` and `out`; a package's own build output needs no entry, since where it
lands is read from that package's `tsconfig.json`.

### What you get

One entry, from the same `@acme/parser` workspace, where `packages/app` imports
`VERSION` from source and the package README mentions it:

```json
{
  "name": "VERSION",
  "kind": "const",
  "at": "packages/parser/src/index.ts",
  "line": 3,
  "signature": "const VERSION",
  "mention": {
    "at": "packages/parser/README.md",
    "line": 3,
    "text": "`VERSION` is the release string this package was built from."
  },
  "usedBy": ["@acme/app"],
  "uses": 1,
  "sites": [
    { "by": "@acme/app", "at": "packages/app/src/main.ts", "line": 1, "type": false, "kind": "source" }
  ]
}
```

`sites` is every place that imports the name, with the file, the line, and
whether that file is a **story** (its filename contains `.stories.`), a **test**
(`.test.`, `.spec.` or `.check.`) or ordinary **source**. A story and a test are
written to *show* a name in use, which is what an example is, so they answer a
different question from a consumer and are separable without re-reading a path.

`mention` is present only where `doc` is absent and the nearest `README.md`
above the declaring file writes the name as a whole word. It carries the file,
the line and the passage.

`help.exported` is every name the repository's own files export, published or
not. Each one carries a name, a file, a line, the package the file belongs to
and whether it was written in source, a test or a story, and nothing else,
because nothing else was read for it. It answers *where is the thing that does
X* for the code that was never something to publish.

```ts
help.exported.filter((named) => named.name.includes('Viewport'));
// [{ name: 'parseViewport', at: 'packages/raster/src/viewport.ts', by: '@acme/raster', line: 31, type: false, kind: 'source' }]
```

`help.deep` is the other half of the same reading: every specifier that imports
a workspace package past what its `exports` map opens — an import that depends
on internals the manifest never promised to keep stable.

```json
[{ "specifier": "@acme/parser/src/parse.js", "by": "@acme/app", "at": "packages/app/src/deepuse.ts", "line": 1 }]
```

`help.unreadable` names files whose imports could not be enumerated. Empty is
the expected answer.

### Reuse a reading you already paid for

The third reading — every module file in the repository, opened and parsed — is
the expensive one. `readUsage` produces it, and `usage` hands it back so
`readHelp` reads the manifests and the entrypoints only. `readUsage` takes the
set of `<package> <subpath>` keys the manifests open, which `readOfferings`
gives you:

```ts
import { readOfferings } from '@variance-authority/package';
import { readHelp, readUsage } from '@variance-authority/package/help';

const opened = new Set(
  readOfferings('.').flatMap((offering) =>
    offering.entrypoints.map((entry) => `${offering.name} ${entry.subpath}`),
  ),
);

const usage = readUsage('.', opened);

readHelp('.', { usage }); // the same value, without re-reading the tree
```

## Compare two readings

The value is JSON. Hand it to a snapshot assertion, to `jsondiffpatch`, to
whatever you already have. Handed to `@variance-authority/core`, it gains the
part neither a reader nor a comparison supplies: every delta carries a
**fingerprint**, a stable identifier for the *shape* of the change rather than
for the position it happened at, so the same edit reported twice is one finding
and a recorded decision about it still matches next week.

```bash
npm install --save-dev @variance-authority/package @variance-authority/core
```

Record a reading first. This writes the file the comparison below reads:

```ts
import { writeFileSync } from 'node:fs';
import { readSurface } from '@variance-authority/package';

writeFileSync('surface.json', JSON.stringify(readSurface('.'), null, 2));
```

Then compare the recorded reading against the current one:

```ts
import { readFileSync } from 'node:fs';
import { readSurface } from '@variance-authority/package';
import { compareValues } from '@variance-authority/core/compare';
import { shapeValue } from '@variance-authority/core/format';

// `dialect` is a free-form label saying how to read the text; it defaults to
// `json`. Pass the same one on both sides, or the two are not comparable.
const dialect = 'package-surface';
const recorded = shapeValue(JSON.parse(readFileSync('surface.json', 'utf8')), { dialect });
const now = shapeValue(readSurface('.'), { dialect });

for (const delta of compareValues(recorded, now)) {
  console.log(delta.change, delta.pointer, delta.fingerprint);
}
```

Deleting `VERSION` from `@acme/parser` prints:

```
removed /@acme~1parser/names/./VERSION v1:bdf8b18d9307dc210452b623887ac5a3
```

Treat removals as release-breaking until the consumer that owned the import has
been updated. Storing the readings and deciding which changes are acceptable
stay yours, so the surface fits the release check you already run.

## Read one file

The manifests and the traversal are separable. A `Reader` holds the parses and
the resolved names for one root, so two readings of two checkouts never answer
each other's questions from a shared cache.

`readOfferings` is the manifest half on its own: per published package, its
`declared` keys and the source file behind each subpath.

Set `tolerant` to true when one stale subpath should be recorded in the
offering's `unreadable` list while the other entrypoints remain available.
Strict mode is the default and throws at the first subpath whose source cannot
be established.

```ts
import { createReader, namesReachedBy, readOfferings } from '@variance-authority/package';

const offerings = readOfferings('.');
const entrypoints = new Map(
  offerings.flatMap((offering) =>
    offering.entrypoints.map((entry) => [`${offering.name} ${entry.subpath}`, entry.source] as const),
  ),
);

const reader = createReader('.', entrypoints);

// `namesReachedBy` takes the source path the manifest pointed at, which the map
// above already holds — it is resolved, not relative to the process.
const source = entrypoints.get('@acme/parser .');
if (source !== undefined) {
  for (const [name, kinds] of namesReachedBy(reader, source)) {
    console.log(name, [...kinds.keys()].join('+'));
  }
}
// parseDocument function
// Document interface
// VERSION const
```

Pass the entrypoint map when a re-export can hop packages: a bare specifier is
answered from the other manifest rather than resolved, because resolving it
would go through an `exports` map into a built directory. Pass an empty map, or
none, and only relative specifiers resolve — which is what reading a single
package means.

## What it records, and what it does not

`OFFERED` is an exported constant you can import from
`@variance-authority/package`: the list of manifest keys recorded
present-or-absent — `type`, `main`, `types`, `exports`, `files`, `bin`,
`engines`, `sideEffects` — so a package that *starts* declaring one reads as a
change rather than as a silence. Pass your own list as the `offered` option to
narrow or widen it.

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
language server.

What neither reads is `dist`. An emitted `.d.ts` states what a compiler
inferred; source states what somebody wrote, so `export const jsxDEV =
runtime.jsxDEV` reads as a `const` where the emitted declaration would carry a
full type. Reading the other one costs a build as a precondition and pays in
stale output.

## What it refuses

These are the top-level forms a name can arrive as, and each one gets a kind:

| Written as | Kind |
| --- | --- |
| `function`, `class`, `interface`, `type`, `enum`, `namespace` | the word itself |
| `var`, `let`, `const`, `using`, `await using`, including destructured bindings | the declaration keyword |
| `export * as ns from './x.js'` | `namespace-object` |
| `export default` an object or array literal | `object` |
| `export default` a function, arrow function or class expression | `function` or `class` |
| A name re-exported from outside the workspace, or through an unresolvable specifier | `foreign` |

Anything else makes the read throw an `Error` naming the file rather than
silently producing a smaller surface:

- `export default` an identifier, a call or a literal — `export default thing`
  throws ``src/index.ts default-exports a `Identifier`, which nothing here names``.
- A workspace glob more elaborate than a path or `dir/*`.
- A `types` target that maps to no file, or that sits under a package with no
  `rootDir`/`outDir` pair to map it back through.
- A name re-exported from a module that does not publish it.
- A file that does not parse.

---

**[@variance-authority/package](https://variance-authority.dev/reference/packages/package)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
