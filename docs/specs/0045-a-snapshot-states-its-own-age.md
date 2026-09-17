# Spec 0045 — a snapshot says what it is, how old it is, and whether it is intact

**Missing:** self-description. The execution record is a 77 MB binary file with
no magic bytes, no checksum anywhere, no persisted model version, and one
exact-equality version gate that turns every release into a cache eviction. A
reader cannot distinguish a file from another project, a file from last release,
and a file with a flipped bit — all three arrive as the same untyped `Error`,
and every caller answers all three by re-recording from scratch.
**Built on:** [0043](0043-a-record-costs-what-the-run-cost.md) (the cost a
needless re-record imposes),
[0044](0044-many-writers-one-record.md) (the generation marker this shares),
[ADR-0031](../context/adr/0031-the-run-asks-what-is-recorded-now.md),
[ADR-0059](../context/adr/0059-a-record-is-invalidated-by-what-could-have-answered-it.md).

## Purpose

Three headers exist in this repository and the important one is the least
equipped. `record-format.ts:30` opens with eight magic bytes and carries a
checksum. `packages/core`'s segment header carries a format name and guards its
own `JSON.parse`. The execution record — the file every other artifact exists to
produce — opens with a `uint32` length and a bare
`JSON.stringify({ version, sections })`.

What follows from that is not stylistic:

- The **only** thing identifying the file is that `version === 8` and that the
  twenty-six expected section names happen to be present
  (`format-layout.ts:182`, `format-view.ts:147`).
- `JSON.parse` at `format-view.ts:146` is unguarded, so a damaged header throws
  a JSON parser's error text about a binary file — past every caller that
  discriminates on the format's own refusal message.
- **The model version is never written.** `MODEL = 3` is asserted against the
  in-memory object on encode and *invented* on decode: `test-selection/format.ts:276` returns
  `version: MODEL` whatever wrote the file. If MODEL moves without FORMAT
  moving, a new reader relabels an old file as the new model, and no evidence of
  it survives.
- **There is no checksum of anything.** Not the header, not the section index,
  not a column, not a run, not the dictionary blob, not the crossing pool.
  `column-codec.ts:52-59` sets `ZSTD_c_contentSizeFlag` and not
  `ZSTD_c_checksumFlag`, so even the codec's own frame check is switched off,
  and a RAW-tagged run has no protection at all.

And the failure that matters most is the one nobody would notice. A silent
corruption inside a crossing-set container — `format-view.ts:285-289` wires the
pool with no validation callback, and `crossing-sets.ts:502-563` reads tag,
members and counts raw — yields a set naming test ids past the end of the test
table. The direction that fails is **narrowing**: a set that loses members
produces a smaller run list. The record answers confidently and the suite skips
a test it should have run.

## What would discharge it

**1. The file says what it is before it says anything else.** Magic bytes and a
format name in the header, guarded parse, and a refusal that names the reason. A
file that is not ours is rejected as not ours, not as corrupt.

**2. Three distinct refusals, and they are typed.** *Not this format*, *not this
version* and *damaged* are three different conditions with three different
remedies, and today they are two untyped `Error`s that
`format-view.ts:380-386`, `carried-sources.ts:46-48` and `test-selection/index.ts:254-257` all
catch identically and answer with `undefined`. A merge cannot tell a
one-release-old base from a damaged one; a version bump looks like a corruption
epidemic and a corruption epidemic looks like a version bump. Each refusal
carries a code, and a caller may branch on it.

**3. Integrity, and a stated position on what it is for.** At minimum
`ZSTD_c_checksumFlag`, which costs a constant per frame, plus a digest over the
header and the section index. The position that needs writing down is whether
the record defends against a damaged disk (a per-section digest, checked on
read) or only against a truncated write (a whole-file digest, checked on open) —
because the second is nearly free and the first is not, and the argument for the
first is that its absence fails silently in the narrowing direction.

**4. Every structural invariant the readers depend on is checked, including the
sorted ones.** `format-validation.ts:32-58` checks row-count agreement, and the
value checks run only when their column materializes: ordinal uniqueness, owner
rooting, extents and instrumented-implies-regions are all skipped by an ordinary
selection, and `blocks.ordinal` has no check at all. **Sortedness is checked
nowhere**, and it is the invariant every `lookup.ts` binary search rests on. An
unsorted dictionary opens cleanly, validates cleanly, and returns wrong skip
lists forever.

Two more that are cheap and absent: the section index is validated for presence
but not for *exactly* `NAMES`, and `width` is taken from the header rather than
derived — so a header that lies about a width changes the row count the shape
check runs against. And `openRuns(section, undefined, BLOB_RUN)`
(`columns.ts:251`) skips the run-count agreement check for the two largest
sections in the file.

**5. A version bump stops being a cache eviction.** `header.version !== FORMAT`
is exact equality with no minimum readable version, no ignore-unknown-section
rule, and no migration. `format-layout.ts:19-42` says so plainly: adding a
section moves the number *even though every section that was there still means
what it did*. That is one release invalidating every snapshot in every cache
layer, every CI artifact, and every shard from a machine on a different release
— and by [0043](0043-a-record-costs-what-the-run-cost.md), one full run each.

There are two honest answers and the project has picked neither in writing.
Either the reader tolerates a file whose sections are a subset of what it knows
(a minimum readable version, with unknown sections ignored and absent ones
treated as unread), or the position is **rebuild, never migrate** — in which
case it is a position, it says why, it names the cost, and the version gate
reports *old* rather than *corrupt* so the operator knows a rebuild is
scheduled rather than a disk failing.

**6. Durability matches the claim.** `test-selection/index.ts:307` says "whole or not at all".
`writeCoverageBytes` (`:340-345`) is a temp-write and a rename with no `fsync`
of the file and none of the directory, which holds against a concurrent reader
and not against a crash.

**7. One writer, or two writers driven by one table.** `NAMES` is read only by
the reader; `test-selection/format.ts:150-177` and `format-layer.ts:414-443` each spell the
twenty-six sections out by hand. A section added to one and not the other
produces files that differ by release path, and the only detection is a
missing-section refusal that says "corrupt".

**8. The tests exercise the failures the format exists to survive.**
`format.test.ts` covers a flipped state byte, a negative offset, a wrong
version, a damaged run, a bad owner and an out-of-range set id. Nothing
truncates a file. Nothing writes a valid-length header with invalid JSON — the
one case that reaches for it never gets to `JSON.parse`, because its first four
bytes fail the length check. Nothing corrupts `sets.blob`.

**Acceptance:** a snapshot from a foreign format, a snapshot one FORMAT behind,
and a snapshot with one bit flipped in each of the header, a column, and
`sets.blob`, each producing a distinct typed refusal naming the reason —
verified by a test that performs the mutation, not by a fixture. Then the
version-policy decision written as an ADR. Then a snapshot truncated under an
open descriptor mid-query, which must fail rather than return a partial answer.

## What it forecloses

**A version number is not identity, and identity is not integrity.** The three
are separate fields answering separate questions, and none of them may be
offered in place of another.

**No refusal is a bare `Error` again.** A caller that must match on a message
substring to know what happened is a caller that will match wrongly, and the
three that already do are the reason this spec exists.

**Silent discard is not a repair strategy.** Every path that answers a bad
snapshot with `undefined` keeps its licence to rebuild, and loses the option of
doing so without saying what it found. A corrupted record discarded on Tuesday
with no diagnostic is indistinguishable from a first run
([0044](0044-many-writers-one-record.md) item 5 is the same rule on the write
side).

**Compatibility is a decision, not a default.** This spec does not require the
reader to read old files. It requires the project to *say* which it does, and to
stop paying the eviction by accident.
