# The source index format

The [Sense](../packages/sense) source index is one versioned binary generation assembled as a small
log-structured merge tree: an ordered log of immutable segments with periodic
compaction. It contains the two facts a repeated source scan can reuse: parses
keyed by content digest and the way the file's name said to read it, and
resolved file records keyed by file path, content digest, and the configuration
and directories they resolved under. Both maps share one publication boundary.

The index is operational cache state. A reader accepts the complete generation
or treats it as absent; no result or evidence depends on the file surviving.

## Manifest and segments

The path passed to `openSourceIndex` is the atomic pointer to the committed
segment chain:

```text
magic            8 bytes   "VAIDXLSM"
manifest length  4 bytes   unsigned 32-bit little-endian
manifest         n bytes   UTF-8 JSON
```

The manifest has format `variance-authority-immutable-log`, version `1`, and an
oldest-to-newest `segments` array. Each entry records a `v1:` content digest and
byte length. Segment files live under `<index path>.segments/`, named by that
digest. Readers load every named segment, verify its length and digest, and
reject the complete chain when any member is missing or corrupt.

A segment starts with a padded JSON section table followed by aligned binary
sections:

```text
header length  4 bytes   unsigned 32-bit little-endian
header         n bytes   UTF-8 JSON followed by NUL padding
payload        m bytes   sections, each starting at an 8-byte boundary
```

The segment header length includes its padding and makes the payload start on
an 8-byte boundary. The header has this shape:

```json
{
  "format": "variance-authority-source-index",
  "version": 1,
  "sections": [
    { "name": "strings.blob", "offset": 0, "length": 123, "width": 1 }
  ]
}
```

Section offsets are relative to the start of the payload. `length` is in bytes;
`width` is either one byte or four bytes. Four-byte sections are arrays of
unsigned 32-bit integers in the runtime's `Uint32Array` byte order. Version 1
does not claim portability between machines with different endianness. Padding
between sections is not part of either section.

The segment reader requires the exact format name and version. It rejects
duplicate section names, overlapping or out-of-bounds sections, invalid widths,
unaligned offsets, malformed column lengths and invalid references. A missing,
incompatible or rejected chain is an empty cache and causes a normal scan. A
standalone version-1 segment remains readable as a legacy one-layer generation.

## Strings and nullable values

Every string within one segment is interned once across its parse and record
rows. `strings.blob` concatenates its UTF-8 bytes without delimiters;
`strings.off` contains one unsigned 32-bit offset per string plus a terminal
offset. String id `i` therefore occupies `blob[off[i]..off[i + 1]]`.

String ids are assigned after code-unit sorting. `0xffffffff` is the sentinel
for a missing scalar string and is never a string id.

An offset column encodes nested rows in the same way: a parent row `i` owns the
child rows in `[off[i], off[i + 1])`. Every offset column begins at zero, is
monotonic, and ends at the child-row count.

Optional lists have a separate one-byte `*-present` column. This preserves the
difference between an absent fact and a known empty list; an offset range alone
cannot express that distinction. Boolean columns contain only zero or one.

## Sections

The source-index schema is columnar. A group of equally named columns has one
row per logical object unless an offset column connects it to a child group.

| section | width | meaning |
|---|---:|---|
| `strings.blob` | 1 | concatenated UTF-8 dictionary |
| `strings.off` | 4 | dictionary byte offsets |
| `index.config` | 4 | one nullable resolution-configuration digest id |
| `directories.path` | 4 | repository-relative directory ids |
| `directories.digest` | 4 | directory-membership digest ids |
| `directories.deleted` | 4 | directory tombstones |
| `parses.key` | 4 | parse content-digest ids |
| `parses.key-way` | 4 | ids of how each parse's name said to read it |
| `parses.deleted` | 4 | parse-key tombstones, content-digest half |
| `parses.deleted-way` | 4 | parse-key tombstones, read-way half |
| `parses.requests` | 4 | parse-to-request offsets |
| `parses.exports` | 4 | parse-to-export offsets |
| `parses.exports-present` | 1 | whether each export list is known |
| `parses.declares` | 4 | parse-to-declaration offsets |
| `parses.declares-present` | 1 | whether each declaration list is known |
| `parses.unknown` | 4 | nullable parse-uncertainty string ids |
| `requests.value` | 4 | specifier string ids |
| `requests.kind` | 4 | request-kind string ids |
| `requests.bindings` | 4 | request-to-binding offsets |
| `bindings.imported` | 4 | imported-name string ids |
| `bindings.local` | 4 | local-name string ids |
| `bindings.type` | 1 | type-only flags |
| `exports.exported` | 4 | nullable exported-name ids |
| `exports.local` | 4 | nullable local-name ids |
| `exports.from` | 4 | nullable source-specifier ids |
| `exports.imported` | 4 | nullable imported-name ids |
| `exports.type` | 1 | type-only flags |
| `declares.name` | 4 | parsed declaration-name ids |
| `records.file` | 4 | repository-relative path ids |
| `records.deleted` | 4 | repository-relative path tombstones |
| `records.digest` | 4 | nullable content-digest ids |
| `records.edges` | 4 | record-to-edge offsets |
| `records.edges-present` | 1 | whether each edge list is known |
| `records.declares` | 4 | record-to-declaration offsets |
| `records.declares-present` | 1 | whether each declaration list is known |
| `records.unresolved` | 4 | record-to-unresolved-request offsets |
| `records.unresolved-present` | 1 | whether each unresolved list is known |
| `records.unknown` | 4 | nullable record-uncertainty string ids |
| `records.witnesses` | 4 | record-to-witness offsets |
| `witnesses.directory` | 4 | witness directory-path ids |
| `edges.to` | 4 | target-path string ids |
| `edges.kind` | 4 | edge-kind string ids |
| `record-declares.name` | 4 | resolved declaration-name ids |
| `unresolved.value` | 4 | unresolved-specifier string ids |

Parse rows and parse tombstones are sorted by digest; record rows, record
tombstones, directory rows and directory tombstones are sorted by path. All use code-unit ordering. Nested arrays retain
their semantic order. With the sorted dictionary and a fixed schema, equal
logical segments encode to equal bytes.

## Reuse and publication

Parse rows depend only on content, so they remain reusable when the repository
moves. Record rows also depend on resolution, and on two keys rather than one.
The adopted configuration digest covers the inputs that control resolution
everywhere — manifests, lockfiles, `tsconfig` and `jsconfig` contents, the
requested `tsconfig`, and the condition names — and a mismatch discards the
record layer as a unit while retaining parse rows. The directory map names each
directory by the entries it holds; a record whose stored witnesses include a
directory that moved is discarded individually. An individual record is reused
only when its content digest also matches.

Where no tracked configuration can be read, there is no bound on where a bare
specifier may land, and the whole path set is folded into the configuration
digest instead — which discards the record layer whenever any path appears.

The newest segment's configuration applies to the materialized record map. A
configuration change is published only after the scan has produced the complete
next map, so unchanged record values may be inherited physically without being
reused during that validating scan.

One `openSourceIndex` call returns the parse cache, record cache and `save`
operation together. Opening creates one ordered lookup for each map. Point
reads ask segments newest to oldest, stopping at the first put or tombstone;
iteration materializes them oldest to newest. `save` retains only rows used or
written by that scan, compares that complete state with the committed one, and
writes the smallest segment that connects them. The segment is published before
a scratch manifest is renamed over the destination.

The ninth pending segment compacts the chain into one complete segment. The
compacted segment restores generation-wide string interning, and the obsolete
segments from the prior manifest are removed after publication. Write failures
leave scanning correct and preserve the previous manifest when one exists;
without one, later work is cold.

The measured 200,000-file synthetic shape occupies 67.3 MB as shared binary
sections versus 598 MB as JSON. The ratio comes chiefly from interning names
once across the generation. The measurement covers the serialized source index,
not the memory used while building it.

---

**Further:** [`source-structures.md`](source-structures.md) for the logical
structures behind these sections, their keys, lookups and costs ·
[`source.md`](source.md) for what the scan reads and where it stops.
