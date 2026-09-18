# ADR-0065 — source scanning is one native side, not a faster stage

**Status:** accepted
**Date:** 2026-09-18

**Supersedes [ADR-0004](0004-defer-native-acceleration.md) for the source scan**,
and only for it. Normalization, diff, the frequency rollup and the record
encoder keep ADR-0004's gate and keep failing it.

## Context

A cold `sense` build over a real monorepo: 178,098 tracked paths under the seed,
330,471 scanned records, a 181.8 MiB index — **239.7 s scanning, 17.1 s saving,
256.8 s total, 5.48 GiB peak RSS**. Saving 330,451 records costs 17 seconds.
Constructing them costs four minutes. The representation is not the problem.

ADR-0004 asked for a recorded benchmark rather than an opinion, and this is one.
But it also made a structural argument that a number does not answer, and that
argument is the only reason this decision is not simply "the gate fired":

> Every stage measured here ends by handing a large object graph to a JavaScript
> caller, so a rewrite relocates that crossing rather than removing it.

That is true of the encoder and it is true of `instrument`. It is not true of the
scan, and the difference is what this ADR turns on. The scan's largest
intermediate value — the AST — is not its output. Today the pipeline is native
only at isolated library calls: a whole-tree git inventory becomes a JavaScript
string, a JavaScript walk builds a frontier, one file is read, `oxc` parses it in
Rust, **the tree is deserialized into JavaScript**, a JavaScript traversal
collects specifiers, a JavaScript-controlled resolver answers them, a record is
built, repeat. Every file pays the crossing, and pays it for a value that is
discarded three steps later. `parse()` in place of `parseSync()` does not touch
this: it moves the parse off-thread and leaves the deserialization on the calling
thread, where it is already the same size as the parse
([journal 0041](../journal/0041-what-a-rewrite-would-buy.md)).

So the scan is the one stage where the crossing can be *removed* rather than
relocated, because nothing on the JavaScript side ever wanted the AST.

## Decision

**Git identity, parsing, traversal, specifier extraction, resolution, witnesses
and compact record construction live on one native side of one boundary.**

The rule that defines the boundary, and the one a later optimization is most
likely to break: **no OXC AST and no per-node object graph is returned to
JavaScript.** One coarse call returns a compact relation batch — interned
strings, numeric file ids, columnar edges, declarations, digests, witness
offsets — and a timing summary. That batch is an internal transfer format. It is
not a second database, not a second reader, and not a public surface.

The file is the unit of parallelism, and Rayon is how it is taken. Determinism
comes from canonical assembly after processing rather than from serial
execution: paths interned deterministically, externally visible paths sorted by
code unit, edges canonicalized as they already are, records returned in the order
the TypeScript implementation returns them.

What does not change: the semantic graph is still the product, the existing
reader is still sufficient, seed directories are still seeds rather than
boundaries, storage is not redesigned, and a digest may skip work only when it
names the bytes actually being scanned.

**The TypeScript implementation stays, and stays the oracle.** It is the
differential reference every native answer is compared against, and it is what
runs on a checkout with no Rust toolchain — which is a supported configuration,
not a degraded one. A binary that cannot be loaded produces a slower scan and
never a different graph.

## What the first increment measured, and what it cost the plan

The whole-repository git snapshot went native first, because the alternative —
narrowing git discovery to the seed — is unsound: the path set also decides
whether a resolution candidate exists, bounds alias targets, and invalidates a
reused record when a previously missing candidate appears. Narrowing it is a
correctness change wearing a performance costume, and it should not be made
before the thing it would buy is known.

It buys almost nothing. Over generated trees with an overlay of edits and
untracked files to hash, TypeScript then native
([`tree-cost.mjs`](../../../packages/sense/scripts/tree-cost.mjs)):

```
                            50,165 paths            200,427 paths
git discovery              308.0    279.9 ms     1754.4   1934.6 ms
paths, listed                1.1      3.6 ms        4.4     19.3 ms
config files                 1.7      0.5 ms        6.6      2.7 ms
directories                 24.3      5.7 ms      117.2     31.2 ms
config digest, bounded       1.9      2.1 ms        8.6      9.9 ms
config digest, unbounded     5.4      4.3 ms       15.4     21.7 ms
```

At the scale this decision exists for, **the entire phase is 1.9 seconds of
256.8**, and 1.75 of those seconds are `git` itself — the same subprocess either
way. The only fold that is meaningfully faster natively is `directories`, and it
is 86 ms.

The `paths` row compares nothing, because neither side is sorting there. The
native snapshot is ordered when it is built, so that call only constructs two
hundred thousand JavaScript strings: `named` walks the same paths and returns a
handful of them in 2.7 ms, and the 16.6 ms between the two rows is the boundary,
at about 83 ns a string. On the JavaScript side `git ls-tree -r` emits tree
order, which is byte order, so the sort is a near-linear merge over an array
that already holds its answer — 3.7 ms, against 74.0 ms for the same paths
shuffled. What the row measures is the cost of handing the path set *back*, and
that cost is zero once nothing asks for it.

So the suspicion that the path set's JavaScript materialization was the
scalability defect is **withdrawn**, on measurement, before anything was built on
it. The four minutes are where the pipeline analysis said they were: reads,
parses, AST deserialization and resolution, once per file, serially.

The increment is kept rather than reverted, for a reason that is not sunk cost:
stage two needs the path-existence set to be *in Rust*, because a resolver
running natively cannot ask JavaScript whether a candidate exists without
reintroducing a per-file crossing. It was built as a performance increment,
measured as a correctness-preserving seam, and that is what it is.

## What this forecloses

- Responding to a missed target by returning a larger JavaScript graph. If the
  native path does not reach roughly a tenth of the current wall time, the
  boundary moves further out along the measured profile — it does not move back.
- Optimizing a stage nobody measured. Every claim here has a generator committed
  beside it.
- A second user-facing reader, a second database, or a second executable.
- Treating the native binary as required. There is no configuration in which its
  absence changes an answer.
