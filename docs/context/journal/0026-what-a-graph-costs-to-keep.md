# 0026 — what a graph costs to keep

Reading names ([ADR-0041](../adr/0041-a-request-is-the-edge-a-binding-is-the-name.md))
made every record bigger. The question was whether the JSON caches still hold, and
what replaces them if they do not. Both halves were measured at 200,000 files
before anything was chosen.

## The reproduction

```bash
yarn workspace @variance-authority/oxc storage
```

Takes a file count as its argument and defaults to 200,000 — a synthetic graph of
that many files, 12 bindings and 5 exports each, names drawn from a pool of 40,000
so interning has something to intern. A quarter of the exports are republished from
a file that genuinely publishes the name, so re-export chains resolve rather than
dead-end, and rings are left in so the hop bound is exercised. It builds the
records, encodes them, reads them back, resolves names through the barrels, and
walks the reverse graph two ways. Numbers below are from a run at the default size.

```
239937 of 1000000 exports are republished from another file
200000 files, 2400000 bindings, 1000000 exports, 240002 interned names
```

## JSON went over the wall

```
as JSON, edges      298 MB — 0.58x the 512 MB string ceiling
as JSON, bindings   598 MB — 1.17x the 512 MB string ceiling
```

`JSON.stringify` returns a string and `readFile(…, 'utf8')` returns a string, so
both ends are bounded by V8's `MAX_STRING_LENGTH` — **536,870,888** bytes, confirmed
with `node -e 'console.log(require("node:buffer").constants.MAX_STRING_LENGTH)'`.
The edges-only record we shipped before fits at a little over half the ceiling. The
record with names in it does not.

The failure mode is worse than the size. Writing throws where a caller might notice.
*Reading* throws too — and a cache read is best-effort by construction, so the throw
is caught and turned into "no cache", and every run silently takes the cold path
forever. A cache that has quietly stopped being a cache is the same class of bug as
a green run over an unwatched surface: the number that would tell you is the one
that stopped being produced.

This is not a projection about some future repository. It is the shape we committed
in [`752228f`](https://github.com/variance-authority/variance-authority/commit/752228f),
at a file count large monorepos already have.

## The same records, as sections

Every field is a `Uint32Array` of ids into one interned name blob, each section
padded to an 8-byte boundary so the view constructor does not throw, behind a small
JSON index.

```
names.blob           18.1 MB
imports.target        9.2 MB
imports.imported      9.2 MB
imports.local         9.2 MB
imports.flags         2.3 MB
exports.exported      3.8 MB
exports.local         3.8 MB
exports.from          3.8 MB
exports.imported      3.8 MB
TOTAL                67.3 MB
```

**67.3 MB against 598 MB — 8.9x smaller**, and the difference is almost entirely
that a name is stored once rather than once per use. 2.4 million bindings and a
million exports draw on 240,002 distinct names. The encoding is not what buys this;
the scope of the interning is. Per-file string tables would store `react` once per
importing file and land much closer to the JSON figure.

Load is `readFile` plus nine `subarray` calls — **15–19 ms**, nothing decoded, no
parse proportional to the payload. Names are cut out of the blob only when asked for.

## Resolving a name through barrels

20,000 local names resolved to the file that declares them, following import row →
target's export rows → `from` when the export is a republication:

```
3-4 ms total, 0.14-0.20 us each
19905 of 20000 resolved
4781 of them through at least one re-export
```

The 95 that did not are the deliberate rings, stopped by the 16-hop bound. This is
the step [`docs/specs/0025-component-relations.md`](../specs/0025-component-relations.md)
was waiting on, and at 0.2 µs it does not need its own index.

## Walking the reverse graph

The dependents question needs the transpose, so it is materialized: 2,698,086
reverse edges, **11 MB as CSR** against **13 MB in SQLite**. Two traversals, each
run against both:

```
a 50-file PR — reached 8634 (4.3%)
  csr     load 1 ms + walk 1 ms = 1-2 ms
  sqlite  13-14 ms (1.5-1.6 us/node)

one token file — reached 115378 (57.7%)
  csr     load 1 ms + walk 7 ms = 7-8 ms
  sqlite  215-221 ms (1.9 us/node)
```

CSR pays ~1 ms up front and then reads memory. SQLite pays nothing up front and
~1.6 µs per node reached, so the crossover is around **600–700 nodes** — below that
the index query wins, above it the flat array does, and both traversals here are far
above it. The token file is the one that matters: a 30x gap on the case where a
change touches something everything imports, which is exactly when someone is
waiting for the answer.

LMDB was in the harness and skipped — it is not installed, and on these numbers a
`readFile` of 11 MB into a typed array has no room left to beat.

## What this settles and what it does not

The binary sections replace the JSON parse cache; that much the numbers decide. They
say nothing about *incremental* cost, which is the harder half — a whole-snapshot
format has to rewrite all 67 MB to record one edited file, and cannot merge a cache
built elsewhere into local work at all. Section-per-field is compatible with writing
a generation and appending, but that is not built and not measured.

Nor does this measure a real repository. It is a synthetic graph with a plausible
shape, and the fan-out of the token file was chosen rather than observed. What it
establishes is the ratio between the encodings, which does not depend on the shape
being right.
