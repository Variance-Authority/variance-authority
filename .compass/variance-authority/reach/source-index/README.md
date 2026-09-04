# Source index

«repository»

## Responsibility

Remembers, across runs, what parsing a file produced and what resolving it
produced, so a second scan costs the diff rather than the repository.

## Bounded context

[Reach](../../DOMAIN.md#reach)

## Inputs and outputs

In: the parses and resolved records one scan produced, together with the digest
each was read under and the layout the resolution happened in. Out: those same
facts on the next run, or nothing — a missing, incompatible, truncated or
corrupt chain behaves as an empty cache.

## Depends on

Nothing in this block. It is operational state kept outside the checkout and is
not source.

## Used by

- [`source-scan`](../source-scan/README.md) — the two caches that remove the
  parse and then the whole record

## Boundary

Two keys, and they are not the same key. The parse section is keyed by content
digest alone, so it cannot go stale. The record section is additionally keyed by
the repository's path layout and the
resolution settings, because resolution can change while a file's bytes do not —
a record reused across a layout change would be an edge into a file that has
moved.

Parses and records are published behind one save, so no run can leave a
generation in which the two disagree about a file. Nothing here decides anything
about a **subject**, and nothing here is allowed to be the reason an answer
differs: it is a saving or it is absent.

## Implementation coordinates

- `packages/sense/src/source-index.ts` — `openSourceIndex`, the two caches and the atomic save
- `packages/sense/src/cache.ts` — the parse cache keyed by content digest
- `packages/sense/src/reuse.ts` — `layoutOf` and the record cache keyed by digest and layout
- `packages/sense/src/source-index-file.ts`,
  `packages/sense/src/source-index-format.ts` — one generation as a chain of
  immutable segments, appended per save and periodically compacted

## Diagram

```mermaid
flowchart LR
  SCAN[source-scan] -->|parses and records| IDX[source-index]
  IDX -->|what has not moved| SCAN
  IDX --- DISK[[operational state outside the checkout]]
```
