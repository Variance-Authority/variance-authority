# The source index format

The [Sense](../packages/sense) source index is **optional cache state**. A
missing or corrupt index is treated as absent, so it can save scan work but
cannot change scan evidence. It holds the two things a repeated source scan
would otherwise redo over a tree that did not move: one parse per set of file
bytes, and one resolved record per file — that file's outgoing edges, the
declarations it publishes, and the directories its specifiers looked in. Both
are published together, so no scan can read a parse state and a record state
that never existed at the same time.

## Where it goes

`openSourceIndex` takes the path you want it at. `sourceIndexPath(root)` gives
the one every tool here agrees on, so two of them scanning the same checkout
reuse each other's work rather than each paying for a cold start:

```text
${XDG_CACHE_HOME:-~/.cache}/variance-authority/test-selection/<checkout>/source-index.bin
```

`<checkout>` is a digest of the checkout's absolute path. A git worktree gets a
directory of its own beneath the checkout it was cut from, reads both and writes
only its own.

**The index is two things on disk.** Beside `source-index.bin` is a directory
`source-index.bin.segments/` holding the data; the file itself is only the
pointer to which segments are current. Copy, restore or move the two together.
The file alone names segments that are not there, and a chain whose members are
missing is rejected whole — a cold scan, not a wrong answer.

Put it outside the checkout: it is operational state, not source, and nothing
about it belongs in a commit. At the path above, `git clean` will not take it
either.

## Caching it in CI

Cache the directory the file and its segments sit in, and restore it before the
scan. Four rules decide whether a restored index is worth anything:

- **Key it by the checkout path, not by the branch or the commit.** Both halves
  are content-addressed, so a cache restored from another branch costs a slower
  scan and cannot produce a different graph for the tracked tree. There is
  nothing to invalidate on merge.
- **Restore it to the same absolute path it was written from.** Records are
  keyed by the repository root among other things, so an index restored under a
  different checkout path keeps every parse and rebuilds every record. Runners
  that check out at a fixed workspace path keep both halves; runners that use a
  per-job directory keep the parses only.
- **Do not move it between machines of different endianness.** Four-byte
  sections are written in the writing host's native byte order, and nothing in
  the file records which that was.
- **Delete the directory to force a cold scan.** That is the whole recovery
  procedure, for a stale index and a corrupt one alike.

## How large it gets

Measured on public checkouts, as the bytes on disk after a full scan:

| Repository | Files recorded | Index | Per file |
| --- | ---: | ---: | ---: |
| [Material UI](https://github.com/mui/material-ui), `packages` and `docs/src` | 25,117 | 7,987,244 B | 318 B |
| [Docusaurus](https://github.com/facebook/docusaurus) | 2,670 | 1,097,060 B | 411 B |
| This repository | 1,236 | 687,539 B | 556 B |

Size against the bytes per file record, which is a property of the repository
rather than of the machine — but as a range of 318 to 556 B, not as a constant.
It moves with how many edges and names each file carries, not with how large the
repository is, which is why Material UI has twenty times the files of this
repository and is the cheapest of the three per file.

A measured 200,000-file synthetic shape occupies 67.3 MB as shared binary
sections versus 598 MB as JSON; the difference is names interned once rather
than repeated per row. Every figure here covers the serialized index on disk,
not the memory used to build it.

What it buys in time, on the same Material UI checkout: a first scan with no
index costs 2,866 ms and the next unchanged run costs 357 ms. Those two are
wall clock on one Apple M4 Max — 64 GB, macOS 27.0 on arm64, Node v26.7.0 — with
a warm filesystem cache, so they are the fast end of the range: size a CI
container above them rather than against them. [What a run
costs](performance.md) carries the rest of the shapes, the machine in full, and
what is left underneath both numbers.

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
is a warm run that costs what a cold one does.
[Source index structures](source-structures.md) names that case and the two
others like it, and what to change.

A configuration change is published only after the scan has produced the
complete next record map, so unchanged record values may be carried over
physically without being reused during that validating scan.

## Reading it

No command opens this file for you. It is a private cache rather than an
interchange format: the layout below belongs to the version that wrote it, the
reader refuses anything it does not recognise, and neither is a stable interface
you can build against. To read the graph, scan for it —
[`scanRelations`](source.md) answers from the index when one is there. To fix an
index, delete it.

`openSourceIndex` returns the parse cache, the record cache and a `save`
operation together. Point reads ask segments newest to oldest and stop at the
first value or tombstone; iteration materializes them oldest to newest. `save`
keeps only the rows that scan used or wrote, compares them with what is
committed, and writes the smallest segment that connects the two. Saves append,
so a run that changed nothing writes nothing; once the chain has grown enough it
compacts back to a single segment, and the segments it replaces are removed
after the new pointer is in place. Write failures leave scanning correct and
preserve the previous pointer when one exists.

## The bytes

For reimplementers only, and only of the version that wrote the file in front of
you.

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
one or four bytes wide; the four-byte ones are native-endian, which is why the
file does not travel between architectures. Optional lists carry a separate
one-byte column, because an offset range cannot distinguish a fact that is
absent from a list that is known to be empty.

Rows are sorted and the dictionary is sorted, so two logically equal segments
encode to equal bytes. The reader rejects duplicate section names, overlapping
or out-of-bounds sections, invalid widths, unaligned offsets, malformed column
lengths and invalid references.

---

**Further:** [`source-structures.md`](source-structures.md) for the structures
behind these sections, their keys, lookups and costs ·
[`source.md`](source.md) for what the scan reads and where it stops ·
[`performance.md`](performance.md) for what a run costs with this index and
without it.
