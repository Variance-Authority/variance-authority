# Spec 0017 — Cause-first ranking on every path

**Missing:** the previous revision's document at comparison time. `variance run`
reports every region as collateral ordered by area — the ordering
[journal 0013](../context/journal/0013-observability.md) measured as backwards by
6×.
**Built on:** the ranking itself, which ships and is exercised where `core` is
composed by hand with both documents
([`examples/todomvc/src/observe.chromium.test.ts`](../../examples/todomvc/src/observe.chromium.test.ts)),
and per-component hashing
([ADR-0018](../context/adr/0018-a-component-hash-covers-its-own-nodes.md)).

## Purpose

The single strongest claim this project makes is that a changed pixel resolves to
the component that caused it rather than to the component that moved. That claim
is true of the differ and false of the binary, and the reason is arithmetic
rather than design: a stored baseline is an image, an image carries no document,
and separating cause from collateral needs two documents.

So the default path prints exactly the ordering the documentation calls wrong,
and says so. Component and file still resolve; only the ordering degrades. That
is a real answer and it is not the answer the design promises.

## What would discharge it

**A document beside the baseline, reaching the comparison.** The sidecar already
exists and already carries the digest that settles an unchanged run without
decoding the PNG. What it does not carry is the document that digest came from.

Two shapes, and the choice is the decision this spec forces:

**Carry it.** The sidecar grows to hold the normalized document, not only its
digest. Storage cost is text beside an image that already dominates it, and the
baseline becomes self-describing: whatever painted it, whoever fetches it, the
document arrives with it. The cost is that every store — directory, git-LFS,
remote, tribunal — carries more, and the format becomes a compatibility surface.

**Fetch it.** The document lives in the shared cache
([spec 0011](0011-storage-and-cache-primitives.md)) keyed by the same digest, and
the run asks for it when it needs to rank. Nothing grows, the cache is already
specified, and the failure mode is a cache miss degrading to today's behaviour —
which is the correct degradation, because it is what happens now.

Fetching is cheaper and loses the property that makes a baseline portable.
Carrying is heavier and makes `incomparable`, ranking and inspection all answerable
from one artifact. **Decide before building.**

## The second caller

`observePair` renders both images and carries a single snapshot, so it attributes
and stops. Whatever shape lands must reach it too, or the ephemeral mode — the
one retention mode with no comparability question at all — stays the mode that
cannot rank.

## What it must not do

**Never reconstruct a document from an image.** An invented digest settles every
future run to `unchanged` against an artifact nobody can reproduce, which is the
refusal `accept` already encodes and the reason no ingest verb exists.

## Leaves behind

An ADR on what a baseline is: bytes plus identity today, bytes plus identity plus
the document that produced them afterwards. That changes what a store owes and
what `incomparable` can be decided from, and both belong in the record.
