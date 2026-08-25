# The source index format

The Sense source index is one versioned binary generation containing the two
facts a repeated source scan can reuse: parses keyed by content digest, and
resolved file records keyed by file path, content digest and resolution layout.
They share one string dictionary and one publication boundary.

The index is operational cache state. A reader accepts the complete generation
or treats it as absent; no result or evidence depends on the file surviving.

## Container

The file starts with a padded JSON section table followed by aligned binary
sections:

```text
header length  4 bytes   unsigned 32-bit little-endian
header         n bytes   UTF-8 JSON followed by NUL padding
payload        m bytes   sections, each starting at an 8-byte boundary
```

The header length includes its padding and makes the payload start on an
8-byte boundary. The header has this shape:

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

The reader requires the exact format name and version. It rejects duplicate
section names, overlapping or out-of-bounds sections, invalid widths, unaligned
offsets, malformed column lengths and invalid references. A missing,
incompatible or rejected file is an empty cache and causes a normal scan.

## Strings and nullable values

Every string in both layers is interned once. `strings.blob` concatenates its
UTF-8 bytes without delimiters; `strings.off` contains one unsigned 32-bit
offset per string plus a terminal offset. String id `i` therefore occupies
`blob[off[i]..off[i + 1]]`.

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
| `index.layout` | 4 | one nullable resolution-layout digest id |
| `parses.digest` | 4 | parse content-digest ids |
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
| `records.digest` | 4 | nullable content-digest ids |
| `records.edges` | 4 | record-to-edge offsets |
| `records.edges-present` | 1 | whether each edge list is known |
| `records.declares` | 4 | record-to-declaration offsets |
| `records.declares-present` | 1 | whether each declaration list is known |
| `records.unresolved` | 4 | record-to-unresolved-request offsets |
| `records.unresolved-present` | 1 | whether each unresolved list is known |
| `records.unknown` | 4 | nullable record-uncertainty string ids |
| `edges.to` | 4 | target-path string ids |
| `edges.kind` | 4 | edge-kind string ids |
| `record-declares.name` | 4 | resolved declaration-name ids |
| `unresolved.value` | 4 | unresolved-specifier string ids |

Parse rows are sorted by digest and record rows by path, both by code unit.
Nested arrays retain their semantic order. With the sorted dictionary and a
fixed schema, equal logical generations encode to equal bytes.

## Reuse and publication

Parse rows depend only on content, so they remain reusable when the repository
layout changes. Record rows also depend on resolution: the adopted layout digest
covers the path set and the configuration inputs that control resolution. A
layout mismatch discards the record layer as a unit while retaining parse rows;
an individual record is reused only when its content digest also matches.

One `openSourceIndex` call returns the parse cache, record cache and `save`
operation together. `save` retains only rows used or written by that scan,
encodes one complete generation to a scratch file, then renames it over the
destination. Write failures leave scanning correct and preserve the previous
generation when one exists; without one, later work is cold.

The measured 200,000-file synthetic shape occupies 67.3 MB as shared binary
sections versus 598 MB as JSON. The ratio comes chiefly from interning names
once across the generation; [journal 0026](context/journal/0026-what-a-graph-costs-to-keep.md)
records the measurement and its limits.
