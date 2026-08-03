# ADR-0004 — Defer native (Rust) acceleration behind a measured gate

**Status:** accepted
**Date:** 2026-08-01

## Context

Two workloads in this system are plausibly native-shaped:

1. **Per-subject normalization + diff.** Tree walk, cascade resolution, canonical
   serialization, hash. Runs once per reachable subject per profile.
2. **Frequency signal processing (§5).** Per-node change frequency accumulated across
   builds, over hash streams, to identify chronically unstable regions. This is the
   "signals" workload, and it is the one that grows without bound:
   `subjects × nodes × builds`.

The stated risk (§10) is *normalization quality*, not throughput. A normalizer that
is fast and wrong fails; a normalizer that is slow and right passes. Optimizing
before the ruleset stabilizes also means rewriting the optimized artifact on every
ruleset change, and the ruleset churns hard while it stabilizes.

Principle 1 (cheapest-representation-first) makes the expensive stages run on a
*shrinking* subset: reachability culls most subjects, the structure+CSS digest culls
most of the remainder, and only the residue reaches semantic diff. The compute this
project performs is designed to be small.

## Decision

**No native code. The gate is a measurement, not an opinion.**

Native acceleration is admitted only when a recorded benchmark in
`docs/context/journal/` shows one of:

- **G1** — normalization + diff of a single subject exceeds **50 ms** at p95 on a
  realistic tree (≥2 000 nodes), *and* profiling attributes the majority to compute
  rather than to collector I/O or engine round-trips;
- **G2** — a frequency-stats rollup over **10⁵ subject-builds** exceeds **5 s**,
  making the incremental cost visible in CI wall time.

Until a gate fires, JS/TS only.

Native acceleration becoming necessary at current scale is evidence that the tiering
is not working; the correct response is to fix the tiering, not to make a broken tier
faster.

When a gate fires, the boundary is already drawn for it: `core` is pure data in /
pure data out (ADR-0001) — no DOM, no I/O, no async — which is exactly the shape that
ports to a native module behind an unchanged interface. The candidate order is:

1. canonical serialization + hashing (hot, trivially portable, no policy)
2. tree diff (hot, moderate)
3. frequency rollup (batch, embarrassingly parallel)

Cascade resolution and banding stay in TS regardless. They encode policy, and policy
must remain legible and cheap to change.

## Measured 2026-08-04 — neither gate has fired, and the ADR aimed right

[Journal 0016](../journal/0016-where-the-time-actually-goes.md) is the recorded
benchmark this decision asks for. Outcome:

- **G1 is grazed, not cleared.** Normalize + diff on a 2201-node tree is 42 ms
  at p50 and 48–51 ms at p95 across three trials, against a 50 ms threshold — a
  result inside its own noise band, which is not a gate firing. At 5501 nodes it
  is 121 ms, but ADR-0007 makes a subject a component tree and the cost model's
  warm capture figure is 7.5 ms.
- **G2 cannot be measured.** There is no frequency rollup, because
  `@variance-authority/history` still has no caller. A gate over a workload that
  never runs has not been checked, and must not be reported as passed.

Two things this ADR got right in advance are worth recording, because they made
the measurement actionable rather than merely interesting. Normalization cost is
**flat** in matched rules per node (1 → 6) and in custom properties (1 → 15), so
the work is per-node — allocation, tree walk, canonical serialization, hashing.
That is candidate 1 above, the half declared "hot, trivially portable, no
policy", and it is *not* cascade resolution, the half declared to stay in TS
regardless.

The finding that changes what anyone should do next is on the raster side and
this ADR did not anticipate it: **pixelmatch is 9% of a comparison.** Decoding
the two PNGs is 90%, and 43% of *that* is already native zlib. So the real
candidate is a PNG decoder, and the seam for it is `@variance-authority/png`.

**And the fastest one available is already running.** Chromium decodes a
1280×800 PNG in 12.4 ms against `pngjs`'s 24.7 ms — cold, distinct images, no
cache — off Node's main thread, and across a pool of pages it takes the
comparison stage from 57.3 ms per pair to 5.8 ms. `variance run` holds a
persistent Chromium already, renders the document in it, has it encode a PNG, and
then decodes that PNG in Node at half the speed of the process it came from.

That does not weaken this ADR, it vindicates the shape of it: the answer to "is
this too slow" was never a language, and here it is not even a dependency. What
it needs settled first is how a 1 MP mask crosses back when the farm design
returns an integer, whether two decoders agree byte for byte — a verdict that
depends on which decoder read the file is not deterministic, and determinism is
the product — and what the tribunal does, having no browser in reach. Those are
a spec's questions, not a patch's.

The larger win was structural and is already banked: spec 0011 item 0 made an
unchanged subject decode nothing at all, which is worth more than any constant
factor and is precisely the "fix the tiering" clause below.

## What this forecloses

- Native code as an early differentiator or a performance claim in launch material.
  There is no measurement, so there is no claim.
- Any `core` API that is async or streaming "so it can be native later". Speculative
  accommodation is how interfaces rot. `core` stays synchronous and
  data-in/data-out because that is the *simplest* correct shape, and it happens to
  also be the portable one.
