# ADR-0061 — a crossing relation is interned, not owned

**Status:** accepted
**Date:** 2026-09-16
**Relates to:** [journal 0050](../journal/0050-six-hundred-million-crossings-were-three-thousand-sets.md), [journal 0051](../journal/0051-the-snapshot-fits-and-the-publish-does-not.md), [ADR-0056](./0056-a-journey-is-the-places-visited.md)

## Context

A region of an instrumented module has to be able to answer *which test files
entered me*. The obvious representation is the one the model already had: each
region owns a list of the tests that crossed it.

At the scale this project is aimed at, that representation is the whole problem
rather than a detail of it. Two hundred thousand modules at eight regions each is
1.6 million regions; two thousand test files whose imports reach forty thousand
modules apiece puts 671 million pairs in that relation. Owned as `string[]` per
region it is 5,122 MB of pointers before anything is encoded, and every reader
pays it again on the way out.

The relation is also not random. A test reaches forty thousand modules by
importing a **barrel**, and the barrel re-exports every leaf, so every leaf under
it is entered by exactly the tests that touched that barrel. The audience belongs
to the barrel; the leaves inherit it whole. Measured on a computed barrel graph,
1.6 million regions hold **3,408 distinct answers**.

An owned representation cannot use that. Sharing has to be expressible, and a
list of strings per region is a shape in which two identical answers are two
objects that happen to be equal.

## Decision

**A region stores an identifier into a pool of the distinct crossing sets. The
sets are interned by byte equality of their encoding, and no region owns one.**

Four parts, each load-bearing.

**The container is a pure function of the set.** `crossing-sets.ts` chooses
between `LIST` (sorted ids), `BITS` (one bit per test) and `RUNS` (`(first,
length)` pairs) by the set's size and density alone. That is what makes interning
a memcmp: two equal sets encode identically, so byte equality *is* set equality,
and the pool never has to compare two sets logically. A container chosen by
anything else — arrival order, a heuristic, a hint from the caller — makes the
encoding ambiguous and the pool's index a correctness problem.

**The whole-suite set is the cheap one.** It costs 5 or 9 bytes. A barrel's leaf
entered by everything is the row a pair-based representation charges most for and
this one charges least for, which is the right way round for the repositories
that need it.

**The arena is one buffer and the index is open-addressed.** Not a preference: a
`Uint8Array` per set with a `Map` from hash to candidates costs 989 MB against
510 MB on the same worst case, because the object headers exceed the sets. The
arena grows through a resizable `ArrayBuffer`, so growth costs 2n at the instant
of the copy rather than holding two arenas.

**One pool per snapshot, both relations out of it.** `format.ts` builds a single
`CrossingSets` for the whole file and interns each block's crossers and loaders
into it; `format-view.ts` reopens it and serves `crossingPool()`, and selection's
last hop is `crossings.members(blockSet.at(block))`. Two pools would intern the
same sets twice and lose the sharing that motivates the structure.

## Consequences

The relation is built, stored and queried at **134 MB peak** for a repository of
200,000 modules, against a 600 MB ceiling. Every relation column in a written
snapshot is under 27 KB, and a query decompresses one blob run rather than the
file: answering a hundred-file diff against a 77.2 MB snapshot reads 3.7 MB.

The adversarial case is measured rather than argued. Every one of 1.6M regions
holding its own 20%-dense set — nothing shared with anything — is 386 MB of
containers at 510 MB peak, so it fits unsharded at two thousand tests. At five
thousand it is 960 MB and needs three chunks of 453 MB, one per process, and the
pools merge.

## What this forecloses

- **A region owning its crossers.** `CoverageBlock.testFiles` is still a
  `string[]` upstream of the encoder, and that is now a defect with a name rather
  than a design. It is 5,816 MB at target shape, paid and thrown away at the
  encoder's door, and `instrumented-modules.ts`, `journal.ts`, `vitest.ts`,
  `jest-reporter.ts`, `merge.ts` and `format-layer.ts` all build it, so they move
  together or not at all.
- **Container choice that depends on anything but the set.** Any future
  container — a bitmap variant, a delta encoding — must be selected by a pure
  function of the members, or interning stops being byte equality and the pool
  stops being sound.
- **Interning across snapshots.** A `SetId` is meaningful only against the pool
  it was minted in. Two snapshots' ids are not comparable, and a merge interns
  into the merged pool rather than renumbering.
- **Answering "which regions did this test enter" for free.** The relation is
  stored one way. The reverse is a scan — measured at 5 ms for one test naming
  254,035 regions — and a caller that needs it repeatedly should say so rather
  than assume it is an index lookup.

It does not foreclose a native implementation. The structure is a buffer and an
`Int32Array` on purpose, and nothing about the decision above depends on the
language it is built in.
