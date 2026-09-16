# Source index structures

This page is the reference for the data structures behind a source scan: what
each one holds, what its primary key is, how a value is found, how a fact is
traced back to the file that produced it, and what a lookup, an insert and a
save cost. [`source.md`](source.md) says what the scan reads and why;
[`source-index.md`](source-index.md) gives the byte layout of the persisted
generation. This page sits between the two: the logical structures, their
keys, and their complexity.

Throughout, `n` is the number of files a scan visits, `m` is the number of
resolved edges between them, `d` is the number of files whose bytes differ from
the last scan, and `s` is the number of segments in the persisted chain.

## The structures at a glance

| Structure | Primary key | Value | Lives |
|---|---|---|---|
| digest map | repository-relative path | content digest, `git:<sha>` or `v1:<hash>` | in memory, per scan |
| parse cache | content digest, and how the name said to read it | `Parsed`: requests, exports, declares, unknown | in memory, persisted in the parse layer |
| record cache | repository-relative path | `FileRecord`: digest, resolved edges, declares, unresolved, unknown | in memory, persisted in the record layer |
| config digest | none, one per generation | digest of the inputs that configure resolution | every segment; read from the newest |
| directory map | repository-relative directory | digest of the entry names it holds | every segment; layered like the others |
| witness list | repository-relative path | the directories one record's specifiers could have named | beside each record row |
| immutable log | segment position, oldest to newest | one encoded layer of both maps | `<index>` manifest plus `<index>.segments/` |
| relations graph | node id, an integer | typed CSR adjacency in both directions | in memory, per run |

The first three are what the scan reads and writes. The log is how they
survive a process. The graph is what a run derives from the records and never
persists.

## The digest map

`gitDigests` in `packages/sense/src/tree.ts:46` returns one content digest per
path git knows, tracked or untracked but not ignored, and opens only the dirty
ones. It runs `git ls-tree -r -z HEAD` for the committed blobs, overlays `git
status --porcelain=v1 -z --untracked-files=all`, and re-hashes every path the
status names in one `git hash-object --stdin-paths` call. Deleted and
renamed-away paths are dropped. An ignored path, or one the hash failed on,
gets no entry, and the scan hashes it itself on read.

**Key.** The repository-relative path, forward-slashed.

**Lookup.** One `Map` read, O(1).

**Cost to build.** Three subprocesses, the third hashing every dirty path in
one batch: O(n) to parse the tree listing and O(d) to hash. Outside a git
checkout the function
returns `undefined`, nothing is reused, and every file is read and hashed.

**Trace.** A digest that starts with `git:` is the blob's own object name, so
`git cat-file -p <sha>` prints the bytes that were scanned. A `v1:` digest is
the scan's own hash of the bytes on disk at the time.

## The parse cache

`Parsed` in `packages/sense/src/cache.ts:30` is everything reading one file
produced that does not depend on where the file sits: its requests, each with
its bindings; its exports; the component names it declares; and `unknown`,
the sentence saying why the request list is not the whole set, when it is
not.

**Key.** The content digest, joined with the two things about the file's name
that change what its bytes mean: every extension the basename carries, which
picks the parser's dialect and decides whether the file is read as a stylesheet,
and whether the name marks it as one whose declarations are not components — a
`.test.ts` is not indexed. Nothing else about the path is in it, so
`src/Button.tsx` and `legacy/Button.tsx` holding one content still share one
entry. Two files with one key had one content read one way, on any machine and
in any branch, so an entry is never invalidated. It is dropped when a scan
neither reads nor writes it, see `save` below.

The parts are joined with a NUL rather than re-hashed, which departs from the
compound key in `packages/sense/src/taint/cache.ts:1`. The key is computed once
per file in the repository on every run, including the runs that open nothing;
hashing 24,909 of them costs 17 ms of a warm run that takes 344, and joining
them costs 2. Nothing reads the parts back out.

**What is not in it.** Resolution. Specifiers go in; edges do not.

A bare specifier that resolves outside the repository, or into a directory
the scan never descends into, yields no edge and no unknown mark: the record
lists it under `unresolved` and stays whole. A relative specifier that lands
there is a hole, and the record is marked unknown. A workspace package is the
common case. `@scope/other` resolves through the `node_modules` symlink into
that package's `dist`, and an edge into `dist` is dropped, so a change in
one package reaches another only through the project graph a caller seeds
with; see [`source.md`](source.md). The edge is ordinary when resolution
lands in source instead: a `source` export condition, a `main` naming a
`.ts` file, or a subpath import into the package's `src`.

**Lookup.** `cache.get(key)` is a `Map` read over the rows this scan has
touched, falling back to a newest-first walk of the persisted layers, O(s)
map reads. A hit is copied forward into the working map so the next read of
the same key is O(1) and so `save` knows the row was used.

**Insert.** `cache.set(key, parsed)` is one `Map` write, O(1).

## The record cache

`FileRecord` in `packages/core/src/relate/records.ts:40` is what resolving one
parse produced: the path, the digest it was read from, its resolved outgoing
edges with their kinds, the names it declares, the specifiers that resolved
nowhere, and `unknown`, the sentence saying why its edges could not be
enumerated, when they could not.

**Primary key.** The repository-relative path. A record is a fact about a
position in the tree, not about bytes: the same bytes at another path resolve
differently.

**Reuse condition.** Two more values guard a hit. The record's digest must
equal the digest the scan holds for the path now, and the tree shape the record
was built under must still answer for it. Both are checked in `openSourceIndex`
at `packages/sense/src/source-index.ts:30`: `prune` empties the available record
map when the configuration differs and deletes individual records whose
witnesses moved, and `get` returns a record only when its digest matches.

**Configuration.** `treeShapeOf` in `packages/sense/src/reuse.ts:129` digests one
text made of a version line, the root, the `tsconfig` setting, the export
conditions, and the digest of every path that decides resolution: `package.json`,
`jsconfig.json`, the lock files, `pnpm-workspace.yaml`, `deno.json`, and every
`tsconfig*.json`. Editing one of those rebuilds the repository, because one
`paths` entry redirects every `@/` specifier in it. Editing anything else does
not. Building it is O(n) for the filter and O(n log n) for the sort.

**Directories.** `directoriesOf` in `packages/sense/src/witness.ts:170` buckets
the path set into one entry-name set per directory and digests each sorted set,
in O(n) over path segments. `movedDirectories` at
`packages/sense/src/witness.ts:201` is the symmetric difference of two such maps,
O(k) in the number of directories. On a 41,165-path repository k is about 1,500.

**Witnesses.** `witnessesOf` in `packages/sense/src/witness.ts:218` reads one
record's specifiers and returns the repository-relative directories that could
have answered them: for `./x` from `D`, `D` and `D/x` when `D/x` is a directory;
for a resolved edge, the directory holding the answer; for a bare request, the
substitutions the tracked `paths` and `baseUrl` patterns allow. They are derived
from the request rather than from the answer, because a request that resolves to
nothing is the one that starts resolving when a file appears. `aliasesIn` at
`packages/sense/src/witness.ts:71` reads those patterns, and returns nothing at
all when a configuration cannot be parsed or `extends` a package — at which point
`treeShapeOf` folds the whole path set into the configuration digest, and every
appearing path invalidates every record.

**Lookup.** `reuse.get(file, digest)` is O(s) map reads through the layers and
one digest comparison. The scan asks it before it asks the parse cache, so an
unchanged file under an unchanged shape costs one lookup and no parse.

**Insert.** `reuse.set(record, witnesses)` is one `Map` write when a shape is adopted
and the record carries a digest. A record whose file could not be hashed is
not stored: it names no bytes and nothing could later check it against the
disk.

## The scan

`scanRelations` in `packages/sense/src/scan.ts:106` is a breadth-first walk
from the seed directories with a moving-head queue. Per file it takes the
first answer on this ladder:

1. the record cache, by path and digest, when the shape matches;
2. the parse cache, by digest, followed by resolution of each request;
3. a read of the file, a parse, resolution, and a write to both caches.

Every resolved edge whose target is a readable extension is enqueued. A file
that cannot be read produces a record with `unknown` set and no edges. A
relative specifier that resolves nowhere also sets `unknown`, because the file
may then depend on anything; a bare specifier that resolves nowhere is
recorded under `unresolved` only, since an uninstalled package lies outside
the diff.

**Cost.** O(n + m) queue work in every case. The read and parse cost is O(d)
files with the caches warm, O(n) files cold. The result is sorted by path in
code-unit order, O(n log n), so two scans over one tree produce one byte
sequence. What one run costs on a 41,165-path tree, cold and warm and
under a diff, is in [`performance.md`](performance.md).

## The immutable log

`openImmutableLog` in `packages/sense/src/immutable-log.ts:39` holds the
persisted generation as an ordered chain of immutable segments behind one
manifest. The manifest is the commit: a segment written without it is
unreachable, and a manifest is published only after every segment it names
exists. Each segment reference carries the segment's content digest and byte
length, and a reader rejects the whole chain when any member is missing or
does not hash to its name. [`source-index.md`](source-index.md) has the byte
layout of the manifest and of a segment.

**Key.** Position in the chain. A segment has no key of its own beyond its
digest-derived file name; its meaning is its place in the order.

**Layers.** Each decoded segment becomes one `MapLayer` per map, holding the
puts and the deletes that turn the previous state into the next. Parse
tombstones are digests; record tombstones are paths.

**Point read.** `lookupInLayers` in `packages/sense/src/ordered-map.ts:8`
walks newest to oldest and stops at the first put or tombstone that names the
key: O(s) map reads, no copy.

**Iteration.** The first iteration materializes the complete map by applying
every layer oldest to newest, O(total rows across layers), and every later
iteration reads the materialized copy.

**Save.** `save` keeps only the rows this scan read or wrote, so a blob no
branch holds any more falls out of the next generation. It computes a
`differenceLayer` per map against the committed state using deep structural
equality on both maps, O(rows) comparisons, and encodes two buffers: the delta
alone, and the complete state. When the log is already committed, the shape
is unchanged and both deltas are empty, nothing is written; a generation with
no manifest yet publishes even an empty delta, and one written as a single
file is compacted at its first publish that carries a change.

**Publish.** `publish` writes the segment under a scratch name, renames it
into `<index>.segments/`, writes a scratch manifest, and renames that over the
manifest path. A failure before the manifest rename unlinks the scratch files
and leaves the previous manifest in place; the unlinking of superseded
segments after the rename swallows its own errors. The cost is O(size of the segment written).

**Compaction.** The chain holds at most eight segments. The publish that would
make a ninth writes the complete encoding as a single segment instead, points
the manifest at it alone, and unlinks the segments the previous manifest
named. A generation written as a single file, recognized by the absence of
the manifest magic, is compacted on its first publish. Compaction restores
generation-wide string interning.

**Cost of a generation.** Encoding sorts parse rows by digest and record rows
by path and builds one code-unit-sorted dictionary, O(r log r) for `r` rows
and strings. Decoding is O(bytes), and every offset column is checked for
monotonicity on the way in.

## Finding a fact in the persisted generation

Every section but `strings.blob` is a typed-array column of width one or four
bytes, and the columns of one group are indexed by the same row number.
Parse rows and record rows are stored sorted by their primary key. The reader
decodes each segment into one put/delete layer per map, O(bytes); a point
read walks the layers newest first, and only iteration materializes.

To locate a value by hand:

- A parse by digest: intern the digest in `strings.blob` through
  `strings.off`, find its id in `parses.digest`, and read the row's request
  range from `parses.requests[row]` to `parses.requests[row + 1]`. Each request
  row gives a specifier id, a kind id and a binding range in the same way.
- A record by path: the same procedure over `records.file`, then edges in
  `records.edges`, whose entries index `edges.to` and `edges.kind`.
- Whether a list is known or merely empty: the matching `*-present` byte. The
  difference between absent and empty is what keeps an unreadable file from
  reading as a file with no imports.
- The configuration: the one id in `index.config`, `0xffffffff` for none.

## The relations graph

`relationsOfFiles` in `packages/core/src/relate/records.ts:97` turns records
into nodes and typed relations, and `relationsOf` in
`packages/core/src/relate/graph.ts:217` folds those into the structure every
reachability question is asked of. A run rebuilds it from
the records in O(n log n + m log m) for the two sorts and O(n + m) for
everything else.

**Node id.** An integer index into `names`. Nodes are ordered kind-major and
then by code unit, so every `file` node precedes every `component` node and
one kind's ids are contiguous. An id is valid only against the graph it came
from.

**Lookup by name.** `idOf(relations, kind, name)` reads the interning map on
the key `<kind>:<name>`, O(1). `nodeAt(relations, id)` is an array read.

**Edges.** One convention holds everywhere: `A → B` means A depends on B, so a
change in B may move A. Both directions are materialized as compressed sparse
rows. Node `i`'s row in `depends` is `target[offset[i] .. offset[i + 1])`, and
`kind[j]` says what kind of edge `target[j]` is. `dependents` is the transpose,
built by a counting sort in O(n + m). Rows are sorted and deduplicated, and a
value import and a type import between the same two files remain two edges.

**Edge kinds.** `imports`, `reexports`, `dynamic`, `type`, `asset` and
`declared-in`. A request is `type` when every binding it brings in is
type-only, `import type { T }` and `import { type T }` alike, and a re-export
is `type` under the same rule. A component is an edge from the component node to the file that
declares it, so a walk against the arrows from a changed file reaches every
importer and every component in one pass.

**Unknown nodes.** `unknown[id]` is `1` where the file's edges could not be
enumerated, and `reasons` carries the sentence for each. The mask is what the
inner loop tests; the map is what an operator reads.

## Tracing a change through the graph

`movedBy` in `packages/core/src/relate/records.ts:170` is the one walk a run
performs. The seed set is every changed file the graph holds plus every node
whose edges are unknown, because an unreadable file might import the one that
changed. Changed paths the graph does not hold are returned as `missing`, and
the unknown files as `opaque`, each with its reason.

**The walk.** `dependentsOf` in `packages/core/src/relate/reach.ts:63` is one
breadth-first search from every seed at once, against the arrows, with a
`Uint8Array` visited mask and an `Int32Array` recording the node each one was
reached through. O(n + m) whatever the number of seeds.

**The trail.** `trailOf(reach, id)` follows the parent array from a reached
node back to its seed and reverses it, O(length of the trail). `explain`
renders it as names, which is how a run prints *`Button` is affected because
`src/tokens.css` → `src/button.css` → `src/Button.tsx`*.

**Choosing the kinds.** `through` restricts the walk to named edge kinds as a
byte lookup per edge. The default is `RUNTIME_EDGES`, every kind but `type`:
a type-only import is erased before anything runs, so a change behind it
reaches no importer. `EDGE_KINDS` walks it for a question about source rather
than a runtime, and the shipped selection passes `asset` alone when it asks
which module imports a file no probe can sit in. `closureOf` walks
`CLOSURE_EDGES`, a list of the same five kinds kept separately because the
digest depends on it, so a type-only change moves no merkle digest. The [execution record](execution-record.md)
agrees by construction: a type-only import runs nothing, so no crossing ever
joins the two files.

**Answering from records alone.** To find what imports a file without
building the graph: scan every record's edges for the path, O(m). Building
the graph once is O(n log n + m log m), and reading one row of `dependents`
after that is O(degree).

## Complexity summary

| Operation | Cost | Where |
|---|---|---|
| digest of every tracked path | O(n) listing, O(d) hashes | `gitDigests` |
| parse lookup by digest | O(s) map reads, O(1) once touched | `cache.get` |
| record lookup by path and digest | O(s) map reads, one comparison | `reuse.get` |
| config digest | O(n log n) | `treeShapeOf` |
| directory map | O(n) segments, O(k log k) digests | `directoriesOf` |
| records invalidated by a move | O(k) compare, O(r) witness scan | `prune` |
| scan, caches warm | O(n + m) queue, O(d) reads, O(n log n) sort | `scanRelations` |
| scan, cold | O(n + m) queue, O(n) reads and parses, O(n log n) sort | `scanRelations` |
| encode one segment | O(r log r) | `encodeSourceIndex` |
| decode one segment | O(bytes) | `decodeSourceIndex` |
| save | O(rows) diff, two O(r log r) encodes, at most one segment written | `save` |
| compaction | one complete segment, whenever a ninth would join the chain | `publish` |
| build the graph | O(n log n + m log m) | `relationsOfFiles`, `relationsOf` |
| node by name, name by id | O(1) | `idOf`, `nodeAt` |
| what a change moved | O(n + m), any number of seeds | `movedBy` |
| why a node was reached | O(trail length) | `trailOf` |

**Further:** [`source-index.md`](source-index.md) for the section table and
byte layout · [`source.md`](source.md) for what the scan reads and where it
stops · [`execution-record.md`](execution-record.md) for the structures on the
execution side · [`selecting.md`](selecting.md) for what a run does with the
graph · [`source.md`](source.md#what-a-second-scan-costs)
for how Git supplies the committed file digests.
