# The source index format

[**Variance Authority**](README.md) is a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source. To decide which work
a change can affect, it scans your checkout for the file graph. The **source
index** is where that scan keeps what it learned, so the next scan over a tree
that did not move does not read it again.

The index is optional cache state. A missing, incomplete or corrupt index is
treated as absent: it can save scan work and cannot change scan evidence. It
holds the two things a repeated scan would otherwise redo — one parse per set of
file bytes, and one resolved record per file: that file's outgoing edges, the
declarations it publishes, and the directories its specifiers looked in. Both
are published together, so no scan can read a parse state and a record state
that never existed at the same time.

Read this page to cache the index in CI, to predict what a change to your tree
costs, or to read the bytes from another language.

## Building one

No command builds the index by itself. It is written and updated as a side
effect of the commands that need the file graph:

```bash
# Requires `source: { dirs: ["src"], relations: true }` in variance.config.json.
variance run --since <ref>
variance run --against <ref>

# Any question that names a start point in the tree.
variance ask "<question>" --from src/billing/
variance ask "<question>" --to src/lib/precision.ts
```

Each of those opens the index, scans, and publishes what it learned before it
exits. The first such command on a machine pays a cold scan; every later one
pays for what moved.

When an editor, watcher or orchestrator already holds the exact changed paths,
write them one per line and hand the file to a source question:

```bash
variance ask search --query button --from src/issue-view.tsx --changed-file /tmp/changed-paths
```

The paths are relative to the scan root. The file is authoritative, including
when it is empty; a rename writes both its old and new path. Git still supplies
the committed path set and the named paths are hashed from disk, but `git
status` is not run to rediscover them.

Declarative loaders can be supplied beside that list as a
[Sense taint table](../packages/sense/README.md):

```bash
variance ask search --query button --from src/issue-view.tsx --taint-file /tmp/loaders.json
```

The JSON object is keyed by scan-root-relative caller file; each `+` array names
the modules that caller loads without an ordinary import. Source-area questions
accept additions only because a subtraction such as a mock is relative to one
file's run and cannot be flattened into one workspace-wide source tree.

From your own tooling, `openSourceIndex` and `sourceIndexPath` in
[`@variance-authority/sense`](../packages/sense/README.md) are the same two
halves the commands use: open the index, hand `cache` and `reuse` to
`scanRelations`, `save` when the scan returns.

## Where it goes

Under your cache root, in a directory named for a digest of the checkout's
absolute path:

```text
${XDG_CACHE_HOME:-~/.cache}/variance-authority/scans/v1-<digest>/source-index.bin
${XDG_CACHE_HOME:-~/.cache}/variance-authority/scans/v1-<digest>/source-index.bin.segments/
```

`<digest>` is the first 32 hexadecimal characters of the SHA-256 of that path,
which you can compute without running anything:

```bash
printf %s "$PWD" | shasum -a 256 | cut -c1-32
```

`sourceIndexPath(root)` — the path the library picks when a caller names none —
puts it under `variance-authority/test-selection/<digest>/source-index.bin`
instead, with the same digest and no `v1-` prefix, and a git worktree gets
`test-selection/<primary digest>/.work/<digest>/` beneath the checkout it was
cut from, reading both layers and writing only its own. Cache
`${XDG_CACHE_HOME:-~/.cache}/variance-authority` whole and you need not choose
between them.

**The index is two things on disk.** Beside `source-index.bin` is a directory
`source-index.bin.segments/` holding the data; the file itself is only the
pointer to which segments are current. Copy, restore and move the two together.
The file alone names segments that are not there, and a chain whose members are
missing is rejected whole — a cold scan, not a wrong answer.

To force a cold scan, delete the digest directory. That is the whole recovery
procedure, for a stale index and a corrupt one alike.

```bash
rm -rf ~/.cache/variance-authority/scans/v1-$(printf %s "$PWD" | shasum -a 256 | cut -c1-32)
```

## Caching it in CI

Cache the directory the file and its segments sit in, and restore it before the
scan. Four rules decide whether a restored index is worth anything.

**Restore it to the same absolute path it was written from.** The checkout root
is one of the inputs to the digest every record is keyed under, so an index
restored under a different checkout path keeps every parse and rebuilds every
record. Runners that check out at a fixed workspace path keep both halves;
runners that use a per-job directory keep the parses only.

**Nothing about the branch or the commit belongs in the key for correctness.**
Parses are keyed by the digest of the file bytes they came from, records by that
digest and a digest of the tree's shape, so an index restored from another
branch costs a slower scan and cannot produce a different graph for the tracked
tree. There is nothing to invalidate on merge.

**Vary the key anyway, so the cache is written again.** A cache key that never
changes is saved once and restored forever: every later job restores the index
as it was on the day it was first written and re-scans everything that has moved
since, which looks like a warm cache and costs a cold one. Put the commit in the
key and the stable part in the restore prefix, so each job saves its own entry
and starts from the newest one that exists:

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/variance-authority
    key: variance-index-${{ runner.os }}-${{ runner.arch }}-${{ github.sha }}
    restore-keys: |
      variance-index-${{ runner.os }}-${{ runner.arch }}-
```

**Do not move an index between hosts of different endianness.** See
[the bytes](#the-bytes) for what the reader does with one that arrives anyway.

## How large it gets

Measured on public checkouts, as the bytes on disk after a full scan:

| Repository | Files recorded | Index | Per file |
| --- | ---: | ---: | ---: |
| [Material UI](https://github.com/mui/material-ui), `packages` and `docs/src` | 25,117 | 7,987,244 B | 318 B |
| [Docusaurus](https://github.com/facebook/docusaurus) | 2,670 | 1,097,060 B | 411 B |
| This repository | 1,236 | 687,539 B | 556 B |

Size the index against the bytes per file record, as a range of 318 to 556 B
rather than a constant. It moves with how many edges and names each file
carries, not with how large the repository is, which is why Material UI has
twenty times the files of this repository and is the cheapest of the three per
file.

A measured 200,000-file synthetic shape occupies 67.3 MB as shared binary
sections against 598 MB as JSON; the difference is names interned once rather
than repeated per row. Every figure here covers the serialized index on disk,
not the memory used to build it.

What it buys in time, on the same Material UI checkout: a first scan with no
index costs 2,866 ms and the next unchanged run costs 357 ms. Those two are wall
clock on one Apple M4 Max — 64 GB, macOS 27.0 on arm64, Node v26.7.0 — with a
warm filesystem cache, so they are the fast end of the range: size a CI container
above them rather than against them. [What a source scan costs](performance.md) carries
the rest of the shapes, the machine in full, and what is left underneath both
numbers.

## What a change costs you

| You change | What survives |
| --- | --- |
| a file's contents | everything except that file's record, and its parse when no path in any branch has held those bytes |
| a file added, moved or deleted | every record except those whose specifiers could have been answered from the directory that moved |
| a manifest, a lock file, any `tsconfig*.json` or `jsconfig.json` | the parses. Every record is rebuilt: one `paths` entry can redirect every bare specifier in the repository |
| the checkout's absolute path | the parses, for the same reason |
| which directories you scan | everything. Which directories a scan visits decides which records it produces, never what any record contains, so a narrow scan reuses a wide scan's work |

One case removes the per-directory bound and makes every run cold. To know that
an added file cannot change where a bare specifier lands, the scan reads `paths`
and `baseUrl` out of every tracked `tsconfig*.json` and `jsconfig.json`. A
config it cannot follow — not valid JSON, or an `extends` naming a package
rather than a relative path — leaves the whole tree unbounded, and then every
record is rebuilt whenever any tracked file appears or disappears. The symptom
is a warm run that costs what a cold one does. [Source index
structures](source-structures.md) names that case and the two others like it,
and what to change.

## Reading it

The index is a private cache, not an interchange format, and no command prints
it: the layout belongs to the version that wrote it, and the reader refuses
anything it does not recognise. To read the graph, scan for it —
[`scanRelations`](source.md) answers from the index when one is there. To fix an
index, delete it.

`openSourceIndex` returns the parse cache, the record cache and a `save`
operation together. Point reads ask segments newest to oldest and stop at the
first value or tombstone; iteration materializes them oldest to newest. `save`
keeps only the rows the scan used or wrote, compares them with what is
committed, and writes the smallest segment that connects the two. Saves append,
so a run that changed nothing writes nothing; once the chain has grown enough it
compacts back to a single segment, and the segments it replaces are removed
after the new pointer is in place. A write that fails leaves scanning correct
and preserves the previous pointer when one exists.

## The bytes

For reimplementers, and only of the version that wrote the file in front of you.

`source-index.bin` is an atomic pointer: an eight-byte magic, a 32-bit
little-endian length, and a UTF-8 JSON manifest naming the committed segments
oldest to newest, each by content digest and byte length. Readers load every
named segment and verify both, and reject the complete chain when any member is
missing or fails. A missing, incompatible or rejected chain is an empty cache
and causes a normal scan.

Each segment is a 32-bit little-endian header length, a padded UTF-8 JSON
section table, and the sections themselves, each starting on an eight-byte
boundary. The schema is columnar: one dictionary holding every string in that
segment interned once, and integer columns over it — one row per parse, per
record, and per child object such as an import request or an edge, with offset
columns connecting a parent row to the range of children it owns. Sections are
one or four bytes wide. Optional lists carry a separate one-byte column, because
an offset range cannot distinguish a fact that is absent from a list that is
known to be empty.

Rows are sorted and the dictionary is sorted, so two logically equal segments
encode to equal bytes. The reader rejects duplicate section names, overlapping
or out-of-bounds sections, invalid widths, unaligned offsets, malformed column
lengths and invalid references.

### Byte order

The two length prefixes above are written little-endian explicitly and parse the
same way on any host. The four-byte data columns are not: they are written as
the writing host's native words and read as the reading host's, and nothing in
the file records which order that was. A byte-order mismatch is therefore not
detected as such.

What an index written on the other endianness meets instead is the validation
every read performs before it believes a column. An offset column must begin at
zero, end exactly at the length of the data it points into, and never run
backwards; every string id must land inside the dictionary; every reference must
name a row that exists. A byte-swapped column fails that on its first non-zero
value, and the chain is rejected whole — the reader reports no index and the
scan runs cold.

That outcome is a consequence of bounds checking rather than a check for byte
order, so treat an index as belonging to the architecture that wrote it. Where a
cache is shared across runners, key it by the runner architecture along with the
operating system.

---

**Further:** [`source-structures.md`](source-structures.md) for the structures
behind these sections, their keys, lookups and costs ·
[`source.md`](source.md) for what the scan reads and where it stops ·
[`performance.md`](performance.md) for what a run costs with this index and
without it.
