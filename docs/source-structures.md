# Source index structures

Set `source: { relations: true }` in your config and `variance run --since <ref>`
stops running the whole suite for every edit. It walks from the files the diff
touched to the components that rest on them, and prints the chain it walked:

> `Button` is affected because `src/tokens.css` → `src/button.css` → `src/Button.tsx`

Without that walk, a changed file that declares no component could have affected
anything, so it affects everything — which is every token file, every theme,
every shared hook.

The walk is cheap enough to run before every suite because the file graph is not
rebuilt from scratch each time. It is read out of an **index**: a
content-addressed cache of the checkout that the run opens, updates with what
changed, and writes back. This page is the reference for that index — what a
change to your tree rebuilds, the three configurations that stop it reusing
anything, what each structure stores and is keyed on, and what a lookup, insert
and save cost.

## Scale

Every figure on this page and on [what a source scan costs](performance.md) was measured
on one checkout this project did not write: [Material UI](https://github.com/mui/material-ui)
at `8f19b1009b` — 41,171 tracked paths, 24,519 of them modules, 24.9 MB of
source. A cold scan of it rebuilds 24,908 records.

| That tree is | Total | Records rebuilt | Files opened |
| --- | --- | --- | --- |
| new — no index at all | 586 ms | 24,908 | 78 |
| unchanged since the last run | 301 ms | 1 | 0 |
| four files edited | 320 ms | 5 | 4 |
| one file added | 362 ms | 105 | 104 |

The first row happens once per machine. The rest is what you pay per run.

The index lives under your cache root, in a directory named for a digest of the
checkout path:

```text
${XDG_CACHE_HOME:-~/.cache}/variance-authority/test-selection/<checkout>/source-index.bin
```

Deleting the index and its `source-index.bin.segments/` directory, then running
`variance index`, is how you force the first row deliberately. The digest is
taken over the absolute path, so a git worktree is a different checkout as far
as the index is concerned: it gets one of its own, inherits nothing from the
checkout it was cut from, and pays the first row once.

## What a change rebuilds

| You change | What is rebuilt |
| --- | --- |
| the contents of a file | that one file's record, and its parse if those exact bytes have never appeared at another path in any branch |
| a file added, moved or deleted | only the records whose imports could have been answered from the affected directory — 105 of 24,908 for one added file above |
| `package.json`, `jsconfig.json`, `deno.json`, `pnpm-workspace.yaml`, any lock file, or any `tsconfig*.json` | the whole index. One `paths` entry redirects every `@/` specifier in the repository, so no record survives |
| `source.dirs` — the directories scanned | nothing. Which directories a scan visits decides which records it produces, never what any record contains, so a narrow scan reuses a wide scan's work and neither invalidates the other |

Two more, neither of them yours to change: upgrading to a release that changes
what a record includes rebuilds the index once, and a type-only import is not a
rebuild trigger for anything downstream — see [edge kinds](#can-you-choose-the-edge-kinds).

## Three ways the index silently stops working

Each of these leaves the tool running and answering. What you see is a run that
is slower than it should be, or a selection wider than it should be, and the
config is the cause.

### A `tsconfig` that `extends` a package

To bound what a new file could change, the scan reads the `paths` and `baseUrl`
patterns out of every `tsconfig.json` and `jsconfig.json` in the tree — every
one, because resolution discovers the nearest config per file, so the bound has
to cover all of them. A config that is not valid JSON, or whose `extends`
names a package rather than a relative path, cannot be followed: the file it
names lives in `node_modules`, which the scan does not read.

One such config anywhere in the tree removes the bound for the whole tree. With
no bound, every tracked path is folded into the configuration digest, and then
**any** file appearing or disappearing invalidates **every** record. The symptom
is that every run is cold: `variance run` never reuses anything, and the timing
sits near the 586 ms row rather than the 362 ms one.

`extends: "@company/tsconfig/base.json"` is an ordinary thing to write in a
monorepo. Replace it with a relative path to the same file, or accept a cold
index.

### A workspace dependency that resolves through `dist`

`@scope/other` normally resolves through the `node_modules` symlink into that
package's `dist`. The scan never descends into `dist`, so the edge is dropped —
and a change in one package then reaches nothing in another. The dependent
package's tests are not selected, and nothing says so, because from the graph's
side there was never an edge to miss.

The edge is ordinary when resolution lands in source instead. Any one of these
is enough, per depended-on package:

- a `source` export condition in its `package.json` pointing at `src`;
- a `main` naming a `.ts` file;
- importing a subpath that names a file in the package's `src` directly.

Failing that, seed the selection from a monorepo tool instead: `source.changes`
takes `nx` or `turbo`, whose affected-project answer crosses the package
boundary the file graph cannot. See [what the scan reads](source.md).

### A file the scan cannot read

A file whose own imports cannot be enumerated — a dynamic `import('./' + name)`,
a `require` whose argument is not a literal, a parse that did not finish, a file
that could not be opened — gets a record with the reason and every edge that could be read. The walk uses
those edges and nothing more. The edge it could not read is answered by the
[execution record](execution-record.md): a module that loads under a test is
in that test's record, whatever expression named it.

This one is not silent either: the record keeps the reason, so the scan can
say which files hide an edge.

## Notation

Throughout, `n` is the number of files a scan visits, `m` the number of resolved
edges between them, `d` the number of files whose bytes differ from the last
scan, `s` the number of segments in the persisted chain, `k` the number of
directories, and `r` the number of rows in a persisted generation.

A **record** is everything resolving one file produced: its path, the digest it
was read from, its outgoing edges with their kinds, the names it declares, the
specifiers that resolved nowhere, and — when its edges could not be enumerated —
the reason. A **generation** is the index as written to disk, as an ordered chain
of immutable **segments** behind one manifest.

## The structures at a glance

| Structure | Primary key | Value | Lives |
|---|---|---|---|
| digest map | repository-relative path | content digest, `git:<sha>` or `v1:<hash>` | in memory, per scan |
| parse cache | content digest, and how the name said to read it | requests, exports, declared names, and why the request list may be short | in memory, persisted |
| record cache | repository-relative path | one record | in memory, persisted |
| config digest | none, one per generation | digest of the inputs that configure resolution | every segment; read from the newest |
| directory map | repository-relative directory | digest of its entry names | every segment |
| witness list | repository-relative path | the directories one record's specifiers could have been answered from | beside each record row |
| immutable log | segment position, oldest to newest | one encoded layer of both maps | the manifest plus its segment directory |
| relations graph | node id, an integer | typed adjacency in both directions | in memory, per run |

The first three are what the scan reads and writes. The log is how they survive a
process. The graph is what a run derives from the records and never persists.

## The digest map

One content digest per path git knows, tracked or untracked but not ignored,
with only the dirty ones opened. It runs `git ls-tree -r -z HEAD` for the
committed blobs, overlays `git status --porcelain=v1 -z --untracked-files=all`,
and re-hashes every path the status names in one `git hash-object --stdin-paths`
call. Deleted and renamed-away paths are dropped. An ignored path, or one the
hash failed on, gets no entry, and the scan hashes it itself on read.

**Key.** The repository-relative path, forward-slashed.

**Lookup.** One map read, O(1).

**Cost to build.** Three subprocesses, the third hashing every dirty path in one
batch: O(n) to parse the tree listing and O(d) to hash. Outside a git checkout
none of this is available, nothing is reused, and every file is read and hashed —
so a run in an exported tarball or a non-git checkout pays the cold column every
time.

**Trace.** A digest starting with `git:` is the blob's own object name, so
`git cat-file -p <sha>` prints the exact bytes that were scanned. A `v1:` digest
is the scan's own hash of the bytes on disk at the time.

## The parse cache

Everything reading one file produced that does not depend on where the file sits:
its requests, each with its bindings; its exports; the component names it
declares; and, when the request list is not the whole set, the reason.

**Key.** The content digest, joined with the two things about the file's name
that change what its bytes mean: every extension the basename has, which
picks the parser's dialect and decides whether the file is read as a stylesheet,
and whether the name marks it as one whose declarations are not components — a
`.test.ts` is not indexed. Nothing else about the path is in the key, so
`src/Button.tsx` and `legacy/Button.tsx` with one content share one entry.
Two files with one key had one content read one way, on any machine and in any
branch, so an entry is never invalidated; it is dropped when a scan neither reads
nor writes it.

The key is computed once per file in the repository on every run, including runs
that open nothing. On the 41,171-path tree above, hashing 24,908 of them costs
17 ms of a warm run that takes 344.

**What is not in it.** Resolution. Specifiers go in; edges do not.

A bare specifier that resolves outside the repository, or into a directory the
scan never descends into, yields no edge and no reason recorded: the record lists
it as unresolved and stays whole, since an uninstalled package lies outside the
diff. A relative specifier that lands there is a hole, and the record records a
reason — which is the file described above, whose other edges the walk still
uses.

**Lookup.** One map read over the rows this scan has touched, falling back to a
newest-first walk of the persisted layers, O(s) map reads. A hit is copied
forward into the working map, so the next read of the same key is O(1) and the
save at the end of the run knows the row was used.

**Insert.** One map write, O(1).

## The record cache

**Primary key.** The repository-relative path. A record is a fact about a
position in the tree, not about bytes: the same bytes at another path resolve
differently.

**Reuse condition.** Two more values guard a hit. The record's digest must equal
the digest the scan now has for that path, and the tree shape the record was
built under must still answer for it. Opening the index empties the available
record map when the configuration digest differs, deletes individual records
whose witness directories changed, and returns a record only when its digest
matches.

**The configuration digest.** A digest of one text: a version line, the root, the
`tsconfig` setting, the export conditions, and the digest of every path that
decides resolution — the files listed in the [invalidation table](#what-a-change-rebuilds).
Building it is O(n) for the filter and O(n log n) for the sort.

**Directories.** The path set is bucketed into one entry-name set per directory
and each sorted set digested, in O(n) over path segments. Comparing two such maps
is the symmetric difference, O(k). On the 41,171-path tree, k is about 1,500.

**Witnesses.** Each record lists the repository-relative directories that could
have answered its specifiers: for `./x` from `D`, `D` and `D/x` when `D/x` is a
directory; for a resolved edge, the directory the answer sits in; for a bare
request, the substitutions the tracked `paths` and `baseUrl` patterns allow. They
are derived from the request rather than from the answer, because a request that
resolves to nothing is the one that starts resolving when a file appears. This is
the mechanism the first trap disables: with no readable alias patterns there are
no witnesses, and the whole path set becomes one.

**Lookup.** O(s) map reads through the layers and one digest comparison. The scan
asks the record cache before it asks the parse cache, so an unchanged file under
an unchanged shape costs one lookup and no parse.

**Insert.** One map write, when a shape was adopted and the record has a
digest. A record whose file could not be hashed is not stored: it names no bytes,
so nothing could later check it against the disk.

## The scan

A breadth-first walk from the configured directories with a moving-head queue.
Per file it takes the first answer on this ladder:

1. the record cache, by path and digest, when the configuration digest matches;
2. the parse cache, by digest, followed by resolution of each request;
3. a read of the file, a parse, resolution, and a write to both caches.

Every resolved edge whose target is a readable extension is enqueued.

**Cost.** O(n + m) queue work in every case. Read and parse cost is O(d) files
with the caches warm and O(n) cold. The result is sorted by path in code-unit
order, O(n log n), so two scans over one tree produce one byte sequence.

## The immutable log

The persisted generation is an ordered chain of immutable segments behind one
manifest. The manifest is the commit: a segment written without it is
unreachable, and a manifest is published only after every segment it names
exists. Each segment reference gives the segment's content digest and byte
length, and a reader rejects the whole chain when any member is missing or does
not hash to its name, so a cache left half-written by a killed process is
rejected whole and the next run is cold. [The byte layout](source-index.md) is
elsewhere.

**Key.** Position in the chain. A segment has no key of its own beyond its
digest-derived file name; its meaning is its place in the order.

**Layers.** Each decoded segment becomes one layer per map, made of the puts and
the deletes that turn the previous state into the next. Parse tombstones are
digests; record tombstones are paths.

**Point read.** Walk newest to oldest and stop at the first put or tombstone that
names the key: O(s) map reads, no copy.

**Iteration.** The first iteration materializes the complete map by applying every
layer oldest to newest, O(total rows across layers); every later iteration reads
the materialized copy.

**Save.** Only the rows this scan read or wrote are kept, so a blob no branch
contains any more falls out of the next generation — the cache does not grow
without bound across branch switches. The delta is computed per map against the
committed state by deep structural equality, O(r) comparisons, and two buffers
are encoded: the delta alone, and the complete state. Nothing is written when the
shape is unchanged and both deltas are empty.

**Publish.** The segment is written under a scratch name, renamed into the segment
directory, a scratch manifest written, and that renamed over the manifest path. A
failure before the manifest rename unlinks the scratch files and leaves the
previous manifest in place. Cost is O(size of the segment written).

**Compaction.** The chain is at most eight segments long. The publish that would
make a ninth writes the complete encoding as a single segment instead, points the
manifest at it alone, and unlinks the segments the previous manifest named.
Compaction restores generation-wide string interning. There is no trigger for
this you control and no reason to want one; it is why your index does not
accumulate segments.

**Cost of a generation.** Encoding sorts parse rows by digest and record rows by
path and builds one code-unit-sorted dictionary, O(r log r). Decoding is
O(bytes), and every offset column is checked for monotonicity on the way in.

## Reading the index

The index is a private cache, not an interchange format, and nothing shipped
prints its contents. There is no dump command and no inspect flag. If you want to
know what is in it, delete it and watch the timings, or ask the questions it was
built to answer:

- `variance ask locate --from <path>` lists what a file rests on, and
  `variance ask locate --to <path>` what rests on it, both at any depth.
  Details in [locate](locate.md).
- `variance run --since <ref>` prints the selection and the chain behind each
  reached component. `variance select` reads no configuration and scans the
  whole checkout instead: it walks a changed file with no row — a stylesheet,
  a module the record never measured — to the nearest measured files that
  import it, and a changed file neither the graph nor the record lists keeps no
  test in the run and is named in the answer.
- `variance serve` exposes the same tree over MCP.

One property of the encoding is worth knowing because it shows up in behaviour:
every list is stored with a flag distinguishing *absent* from *empty*. That is
what keeps a file the scan could not read from being indistinguishable from a
file with no imports — the first is named as a file that hides an edge, the
second has nothing to hide.

## The relations graph

Records become nodes and typed relations, and those fold into the structure every
reachability question is asked of. A run rebuilds it from the records in
O(n log n + m log m) for the two sorts and O(n + m) for everything else. It is
never persisted.

**Node id.** An integer index into the name table. Nodes are ordered kind-major
and then by code unit, so every file node precedes every component node and one
kind's ids are contiguous. An id is valid only against the graph it came from.

**Lookup by name.** An interning map read on `<kind>:<name>`, O(1). Name by id is
an array read.

**Edges.** One convention applies everywhere: `A → B` means A depends on B, so a
change in B may affect A. Both directions are materialized as compressed sparse
rows, the reverse built by a counting sort in O(n + m). Rows are sorted and
deduplicated, and a value import and a type import between the same two files
remain two edges.

**Edge kinds.** `imports` (a value import), `reexports` (an import that also
republishes), `dynamic` (`import()` with a literal specifier), `type` (erased
before anything runs), `asset` (a stylesheet's `@import`, or a `url()` that names
a font or an image), and `declared-in` (a component to the file that declares it).
A request is `type` only when its statement is written `import type` or
`export type`; `import { type T } from './t'` is a value import, because under
`verbatimModuleSyntax` it still loads `./t` and the `tsconfig` that decides is
not in the file. A re-export is `type` only when every statement republishing
from that specifier is written `export type`. Because a component points at the file that declares it,
one walk against the arrows from a changed file reaches every importer and every
component in one pass.

**Files with unrecorded edges.** A bitmask marks the nodes whose edges could not
all be enumerated, with the reason recorded alongside. No walk reads it; it is
there for whoever reports on the scan.

## Tracing a change through the graph

One walk answers what a diff affected. The seed set is every changed file the
graph has a node for, and nothing else. Changed paths with no node in the graph
are returned as missing rather than as *affects nothing*. That is a refusal the
caller acts on: the selector widens to the whole suite, and the report
prints the refusal where the attribution would have been.

**The walk.** One breadth-first search from every seed at once, against the
arrows, with a visited bitmask and an array recording the node each one was
reached through. O(n + m) whatever the number of seeds.

**The chain.** Following that array from a reached node back to its seed and
reversing it is O(length of the chain). Rendered as names, that is the
`src/tokens.css → src/button.css → src/Button.tsx` line the report prints.

### Can you choose the edge kinds?

No. There is no config key and no flag; the tool picks the set per question, and
the sets are fixed:

| Question | Kinds walked |
| --- | --- |
| what a diff affected — the selection walk | every kind but `type` |
| what a subject's digest folds | every kind but `type` |
| what a file's neighbourhood is — `variance ask locate` | every kind, `type` included |
| which module imports a file no probe can sit in | `asset` alone |

`type` is out of the first two because a type-only import is erased before
anything runs, so a change behind one reaches no importer and changes no digest.
It is in the third because a reader asking where something lives is asking about
source, and a type a component imports is in its neighbourhood by any reading a
person would recognise. The [execution record](execution-record.md) agrees by
construction: a type-only import runs nothing, so no crossing ever joins the two
files.

**Answering from records alone.** To find what imports a file without building
the graph: scan every record's edges for the path, O(m). Building the graph once
is O(n log n + m log m), and reading one row of the reverse adjacency after that
is O(degree).

## Complexity summary

| Operation | Cost | When it runs |
|---|---|---|
| digest every tracked path | O(n) listing, O(d) hashes | start of every run that reads the index |
| parse lookup by digest | O(s) map reads, O(1) once touched | per file being rebuilt |
| record lookup by path and digest | O(s) map reads, one comparison | per file visited, every run |
| configuration digest | O(n log n) | start of every run |
| directory map | O(n) segments, O(k log k) digests | start of every run |
| records invalidated by a move | O(k) compare, O(r) witness scan | the first run after a file is added, moved or deleted |
| scan, caches warm | O(n + m) queue, O(d) reads, O(n log n) sort | `variance run`, `variance ask locate`, `variance serve` |
| scan, cold | O(n + m) queue, O(n) reads and parses, O(n log n) sort | the same, with no index or after a configuration change |
| encode one segment | O(r log r) | end of a run that changed something |
| decode one segment | O(bytes) | opening the index |
| save | O(r) diff, two O(r log r) encodes, at most one segment written | end of every run that opened the index |
| compaction | one complete segment | the publish that would make a ninth segment; no user trigger |
| build the graph | O(n log n + m log m) | once per run, in memory |
| node by name, name by id | O(1) | per question asked of the graph |
| what a change affected | O(n + m), any number of seeds | `variance run --since <ref>` or `--against <ref>` |
| why a node was reached | O(length of the chain) | per *affected because* line printed |

**Further:** [`source.md`](source.md) for what the scan reads and where it stops ·
[`source-index.md`](source-index.md) for the section table and byte layout ·
[`selecting.md`](selecting.md) for what a run does with the graph ·
[`performance.md`](performance.md) for what a run costs ·
[`execution-record.md`](execution-record.md) for the structures on the execution
side.
