# ADR-0094 — What a case said is stored as items over the crossing-set pool, by one Rust owner

**Status:** accepted
**Date:** 2026-10-17
**Reverses:** the `tests.casePreconditions` column, one interned JSON row per
case resolved at write
**Amends:** [spec 0093](../../specs/0093-a-case-names-its-preconditions.md)
"What is recorded", [spec 0102](../../specs/0102-a-case-records-what-the-code-read.md)
"What is recorded"
**Relates to:** [ADR-0061](0061-a-crossing-relation-is-interned-not-owned.md),
[`packages/sense/native/src/case_said.rs`](../../../packages/sense/native/src/case_said.rs)

## Context

A precondition is configuration a case said; a breadcrumb (spec 0102) is what
the code read while the case ran. Both are near-universal — almost every case
says or reads something — and both have few distinct values: the same
`beforeEach` says the same thing for every case of a file, and a flag set read
by a render is read by every case that renders. That is the shape the coverage
relation already has, a region and the cases that entered it, and ADR-0061
stores it as hash-consed sets in one pool per record.

The column this replaces held each case's resolved row as a JSON string in the
string table. It had four defects, found by a clean-room review:

1. **Two implementations of every step.** Parse, join, resolve, checkout-site
   naming and spelling were written once in TypeScript
   (`case-precondition-column.ts`, `case-preconditions.cts`) and once in Rust
   (`case_preconditions.rs`), with a hand-written `Number.prototype.toString` so
   the two spelled a row byte for byte.
2. **The copies disagreed.** A value two runs said at two sites kept the
   first-arriving site in TypeScript and the first-sorting site in Rust; a
   fraction resolved as `0.000001` in one and `1e-6` in the other.
3. **Resolved at write.** A value a narrower level overrode was dropped from the
   record, so no reader could ask what a `beforeEach` said under a body that
   overrode it, and a merge of two records resolved a resolution.
4. **A query was a scan.** `--where` decoded every case's JSON, across N-API,
   into objects, and filtered them in the CLI.

## Decision

**What a case said is a set of items. An item is one distinct fact; the cases
that hold it are a set in the record's crossing-set pool. One Rust module,
`case_said.rs`, is the only code that parses, joins, encodes, decodes, resolves
or resolves it. TypeScript captures in the realm and calls Rust for the rest.**

### The model

- An **item** is `(name, value, site, level)`. `name` is the precondition's
  name; `value` is its JSON text exactly as the realm's `JSON.stringify` wrote
  it, never re-spelled; `site` is the repository-relative `file:line` of the
  call; `level` is the describe depth of the `beforeEach` that said it, `65535`
  for the case body.
- Each item maps to **the set of cases** that said it, interned in the record's
  one pool (ADR-0061). Equal sets are one entry, so a fact every case of a file
  holds costs one item row and, usually, a set the coverage already interned.
- **Measured** is one more set: the cases a recorder listened to. A case outside
  it is *unmeasured*; a case inside it and in no item said nothing. Absent is
  not empty, and the distinction survives every merge.
- **Stored raw, resolved at read.** Every item is kept, overridden or not. A
  case's row is resolved when it is read: per name, the narrowest level that
  case holds wins; two values at that level are a contradiction, both kept; of
  one value said at several sites, the site first in code-unit order of the
  file, then by line, is printed.

### Operations, and their cost

| Operation | How | Cost |
|---|---|---|
| join a case's frames | union of their items | O(items) |
| merge shards | remap case ids, union equal items' sets | O(items + set bytes); today each case is read out and laid again, O(cases × items) |
| lay a layer | a case the run recorded again takes its items from the run; a carried case keeps its own | O(items + set bytes); today O(cases × items), as a merge |
| one case's row | membership of the case in each item's set, then resolve | O(items × log set) |
| `--where name[=value]` | each case's resolved row, filtered | O(cases × items) |
| unmeasured count | the complement of the measured set | O(set) |

Nothing is stored that a reader cannot use as a fact: no count of calls, no call
order, no timestamp, no stack, no effective configuration.

### The format

One section, `tests.said`, a byte column in the case index, written and read
only by `case_said.rs`. It is absent when no case was listened to. Little-endian
`u32` words unless named otherwise:

```
measured            set id: the cases a recorder listened to
textCount           n
textOff[n + 1]      offsets into text
text[textOff[n]]    UTF-8 bytes of the n distinct strings, code-unit sorted
itemCount           m
name[m]             text id
value[m]            text id: the JSON text
site[m]             text id
level[m]
cases[m]            set id: the cases that said the item
```

Items are sorted by `(name, value, level, site)`; the text table is sorted, so
comparing two ids compares their strings. Each column is contiguous, which is
what the record's zstd compresses best. A case index without the section, from
any writer before this one, reads every case as unmeasured.

The journal frame keeps its sixth owner field, `[[name, value, site, level], …]`,
written by the realm. Only Rust reads it.

### Strategy

- **One owner per step.** Capture stays in the realm, in TypeScript, because it
  runs where only JavaScript runs. Everything after the frame is Rust:
  `case_said.rs` parses the field, names each site from the checkout, joins
  frames, lays the section into the pool, decodes it and resolves a row. Every writer of the case index — the TypeScript writers through
  N-API, the native fold and stitch directly — calls the same functions.
- **TypeScript holds what a case said as an opaque string.** Between capture
  and the record it is the frame field's spelling, `[[name, value, site,
  level], …]`, unresolved; TypeScript passes it to Rust and never parses it. The
  N-API surface is five calls: `saidJoined` (parse, name sites, union),
  `saidSite` (one site named from the checkout), `saidResolved` (a row),
  `saidLaid` and `saidRead` (the section). A reader gets resolved rows from
  `saidResolved` and prints them.
- **One spelling writes it.** Only the set spelling of the case index carries
  `tests.said`, because the section's sets live in the crossing-set pool; the
  row spelling refuses a case index that holds what a case said rather than drop
  it.
- **`--where` filters resolved rows.** It runs in the CLI over the rows Rust
  resolves, so it costs a resolve per case. Answering it from the items' sets,
  without resolving a case that holds no item under the name, is a Rust query
  this decision leaves for later; its semantics are fixed here.
- **Breadcrumbs take the same shape.** Spec 0102's reads are items in a section
  `tests.read` with this layout and this owner; the said and read sets of one
  key intersect to answer *said X, read Y*.

## Consequences

- `case-precondition-column.ts` and `case_preconditions.rs` are deleted, with
  `resolve`, `heardAcross` over parsed rows, `saidOf`, `checkoutSaid`, the JSON
  spelling of a row, and the hand-written number formatter.
- A realm with no addon — the sandboxed realm a Vitest or Jest case runs in — names a
  misplaced call's site as the realm spelled it in the warning it prints; the
  site on the record is named by Rust when the frame is joined.
- A record written before this decision opens with every case unmeasured: its
  `tests.casePreconditions` column is no longer read. A re-recorded run restores
  them.
- The crossing-set codec and the case index writer themselves still exist once
  in TypeScript and once in Rust. This decision does not fold them; it puts the
  facts behind one owner so that fold has one less column to carry.
