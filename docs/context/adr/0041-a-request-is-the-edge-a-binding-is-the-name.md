# ADR-0041 — a request is the edge, a binding is the name, and a mock is neither

**Status:** accepted
**Date:** 2026-08-14
**Relates to:** [ADR-0006](0006-host-free-core.md),
[ADR-0038](0038-a-change-reaches-a-component-through-files.md),
[`packages/sense/src/read.ts`](../../../packages/sense/src/read.ts) (the reader),
[`packages/sense/src/cache.ts`](../../../packages/sense/src/cache.ts) (what is cached),
[`docs/specs/0025-component-relations.md`](../../specs/0025-component-relations.md)

## Context

[ADR-0038](0038-a-change-reaches-a-component-through-files.md) reads a file's
imports and turns each one into an edge with a kind. That is enough to answer
*which components could this diff have moved*, and it is not enough for anything
that asks about a **name**.

Three questions arrived that it cannot answer, and they are not exotic:

**Which npm packages does this subtree depend on.** A bare specifier resolves to
"not a file in this repository" and the edge is dropped. The string `@atlaskit/button`
was the only record that the dependency existed, and it was discarded on the way
to a file id.

**Which file actually declares `Card`.** `import { Card } from '@app/ui'` reaches
the barrel and stops. Whether the barrel declares `Card` or republishes it from
four files further on is the difference between repainting one component and
repainting a package, and a file-level edge holds neither the name nor the
re-export chain that would settle it.

**Which of these imports survive compilation.** The kind was computed as *type if
every binding is type-only*, which is correct for the whole statement and wrong
for every name in it. `import C, { type D } from './cd'` came back as `imports`,
and `D` — erased by every compiler, incapable of moving a pixel — was
indistinguishable from `C`.

All three are the same shortfall: the specifier and the names were read, used to
compute one edge, and thrown away. And the grain matters in both directions. One
row per name multiplies a barrel by its width — fifty edges to one file. One row
per statement loses the names. Neither is the unit.

## Decision

**A request carries the specifier; bindings carry the names; they are separate
rows.**

A **request** is one `import`/`export … from`/`import()`/`require()` — the
specifier **as written**, plus the kind the whole statement has. It is the unit
of the file-level edge, so a barrel republishing fifty names is one edge to one
file, as it was before.

A **binding** is one name the request brings in: what the other module calls it,
what this file calls it, and whether it is type-only. `default` and `*` stand for
the default export and a namespace object — neither is a legal identifier, so
every binding has a name and none of them can be confused with a written one.

Three things follow, and each closes something off.

**The specifier survives resolution.** Resolution answers *which file*, and that
answer is recorded beside the string rather than in place of it. A bare specifier
that resolves to nothing is not a failure to be logged, it is the package the file
depends on, and it is the only place that fact is written down.

**Empty is a fact with several causes, and the kind tells them apart.** A request
binding no names is `import './x'` (a side effect), or `export * from './x'` (a
set this file never enumerates), or `import('./x')` (bound by a property access
the module record never saw). Collapsing them would make "binds nothing" mean
"depends on nothing" for the first, which is how a stylesheet edge disappears.

**An export with no name is not an export of nothing.** `export * from './x'`
publishes whatever the other file publishes. It is carried as an export row with
the name absent, and a consumer asking *does this file export `Card`* has to
follow `from` rather than answer no. This is
[ADR-0008](0008-per-profile-expectations.md) in name space rather than in
observation, and it is the reason the star is not simply dropped as
uninformative.

**A mock is built on top, not stored as a field.** `jest.mock('./b')` cuts an
edge, and cutting edges is real. It is not a column on a request, because the
files that need the attribution are a special kind — tests — and everything that
consumes it is a special kind of query. It composes as a layer that reads the
same requests and rewrites the graph it hands on. Nothing about the encoding has
to change to add it, which is the property being bought.

## Consequences

**The file-level kind is a summary, not the truth.** `kind` is still on every
request and still drives the edge, so nothing downstream of ADR-0038 changed. It
is now derived from bindings that are also kept, so a consumer that needs to
disagree with the summary can.

**The parse cache grew, and past a wall.** `Parsed` now holds requests, bindings
and exports, and its version was bumped so older files are discarded rather than
misread. Measured at 200,000 files, the same records as JSON go from 298 MB to
598 MB — past the 512 MB ceiling that `readFile(…, 'utf8')` throws at
([journal 0026](../journal/0026-what-a-graph-costs-to-keep.md)). Reading names is
what makes the JSON cache unviable rather than merely large, and the binary
encoding that replaces it is not yet built.

**Function-to-function is now a join rather than a research project.** A local
name resolves to a declaring file through the import row, the target's export
rows, and the re-export chain — measured at 0.2 µs per resolution. That is the
step [`docs/specs/0025-component-relations.md`](../../specs/0025-component-relations.md)
was blocked on. Symbol-to-symbol edges still need a real AST pass and scope
resolution, and belong in their own artifact keyed on the same file and name ids.

**Re-export grouping changed the edge count.** `export { a, b } from './x'` was
two specifiers naming one file and is now one request. Every barrel in a
repository was being multiplied by its width, so graphs get smaller and no
answer changes.

**Reading a name is not free, and the cost was not measured separately.** The
module record already computed every binding, so this reads fields rather than
doing new work — but the *record* is bigger and the cache holds more. What that
does to the second-scan number in [journal 0025](../journal/0025-what-a-second-scan-costs.md)
is unmeasured.

## Alternatives

**One row per name, with the specifier repeated.** Rejected. It multiplies every
barrel by its width, and it has no row at all for `import './x'` — a side-effect
import binds nothing, so the edge would need a phantom binding with no name to
exist. `DYNAMIC`, `REQUIRE` and `SIDE_EFFECT` are also properties of the
statement rather than of a name, and would be duplicated across every row.

**Keep the specifier only when it fails to resolve.** Rejected. It makes the
record's shape depend on the resolver's success, so the same file cached in two
checkouts holds different fields, and *which packages does this depend on*
becomes a question only answerable where the answer is already wrong.

**Store the resolved declaring file directly, instead of the export rows.**
Rejected. It is resolution done eagerly for every name in the repository, most
of which nothing will ask about, and it bakes a barrel chain into the record —
so editing one barrel invalidates every record that resolved through it, rather
than only the barrel's own.

**A `MOCKED` flag on the request.** Rejected, and this is the narrow version of
the decision above. It puts a test-only concern in the row every file writes,
for a rewrite that only test files trigger and only some queries observe.

**Materialize the AST and read scopes now.** Rejected. `oxc`'s module record
carries every fact above with no node materialized, and the tree is the expensive
half (ADR-0038). Symbol-level relations genuinely need it, which is why they are
a separate artifact built by a separate pass rather than a wider version of this
one.
