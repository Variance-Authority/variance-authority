# Source scan

«gateway»

## Responsibility

Walks a checkout once and turns each file into a record of its resolved outgoing
edges, its content digest, and the components it declares.

## Bounded context

[Reach](../../DOMAIN.md#reach)

## Inputs and outputs

In: a repository root, the directories to seed from, the individual files a run
rests on that nothing imports, the installed dependencies and path mappings a
specifier needs to resolve, and — when something already knows them — a map of
content digests. Out: one record per file, carrying resolved edges, the digest
the record was read from, the component names the file declares, specifiers that
resolved nowhere, and, when not all of the file's edges could be enumerated,
the sentence saying which.

Content digests come from the version control object store, so a file edited and
then edited back to its committed contents lands on its committed digest and
nothing runs for it. The bytes behind a digest come from the object store or the
working tree, as the operator chooses; the digest names the record either way.

## Depends on

- [`source-index`](../source-index/README.md) — the parse cache and the record
  cache that let an unchanged file cost two map lookups
- [`normalization`](../../normalization/README.md) — which component a source
  file declares, read from the same parse

## Used by

- [`source-index`](../source-index/README.md) — the records an update
  publishes, package edges among them, and the harness records that let a walk
  descend from a declared entry point
- [`crossings`](../crossings/README.md) — the statically reachable files behind
  a test file, for measuring how much of them a run entered

## Boundary

Configured directories are seeds and not a boundary: an imported stylesheet
outside them still enters the graph, because a scan that only knows the files it
was pointed at cannot answer the question it exists for. It stops at the
repository edge for *files* — a specifier resolving into a sibling package's
built output, or anywhere above the root, is dropped, since nothing in a diff of
this repository can be that file. That leaves a real gap at every package
boundary, and it is filled by [`selection`](../selection/README.md) taking
another tool's affected-project answer as more changed input.

A specifier that names an installed dependency does not vanish at that edge: it
is kept as an edge to the package under the name the source asked for, so a
package [`installed`](../installed/README.md) says moved reaches the files that
import it and no others. The name is the whole of what is recorded — no version,
no resolution, no directory.

Named files are seeded beside the directories, and they are exact paths rather
than places to walk. A harness config lives above every directory a component
scan would be pointed at, so no walk arrives at it and the file that decides how
the whole suite runs has no node. Seeded by name it becomes an ordinary record,
and so does everything it loads. A named path that is not there, or that has no
reader, is dropped rather than recorded as a file whose edges could not be read:
one misspelling would then name a file nobody wrote in every report on the scan,
and read there as a scan that had failed.

It decides where a specifier points and never what counts as one; that is
settled from syntax alone. A specifier that resolves nowhere is still a fact
worth keeping, and *binds nothing* has several causes that must stay apart: a
bare specifier is recorded as a package edge whether or not anything is
installed under that name, since whether a package is present here decides
nothing about which files import it, while an unreadable or unresolved relative
request names repository source nobody could identify, so the file carries the
sentence naming it and the edge is left to the recorded run.

## Implementation coordinates

- `packages/sense/src/scan.ts` — `scanRelations`, the walk and the reuse ladder
- `packages/sense/src/read.ts` — `readModule` and `readStyle`, source text to specifiers
- `packages/sense/src/resolve.ts` — specifier to file, export conditions,
  `tsconfig` paths, and the case-folding checks that are invisible on a
  case-sensitive machine
- `packages/sense/src/tree.ts` — `gitDigests`, content digests without opening a file
- `packages/core/src/relate/records.ts` — the `FileRecord` shape the scan produces

## Diagram

```mermaid
flowchart LR
  CHECKOUT[[checkout]] --> SCAN[source-scan]
  NORM[normalization] -->|declared components| SCAN
  IDX[source-index] -->|parses and records already known| SCAN
  SCAN -->|file records| IDX
  SCAN -->|reachable source behind a test| CROSS[crossings]
```
