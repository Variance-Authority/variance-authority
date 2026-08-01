# ADR-0004 — Defer native (Rust) acceleration behind a measured gate

**Status:** accepted
**Date:** 2026-08-01
**Origin:** kickoff steer — *"You might need to bring some rust(?) to speedup processing of signals."*

## Context

Two workloads in this system are plausibly native-shaped:

1. **Per-subject normalization + diff.** Tree walk, cascade resolution, canonical
   serialization, hash. Runs once per reachable subject per profile.
2. **Frequency signal processing (§5).** Per-node change frequency accumulated
   across builds, over hash streams, to identify chronically unstable regions.
   This is the "signals" workload, and it is the one that grows without bound:
   `subjects × nodes × builds`.

## Decision

**No native code in M0. The gate is a measurement, not an opinion.**

Native acceleration is admitted only when a recorded benchmark in
`docs/context/journal/` shows one of:

- **G1** — normalization + diff of a single subject exceeds **50 ms** at p95 on
  a realistic tree (≥2 000 nodes), *and* profiling attributes the majority to
  compute rather than to collector I/O or engine round-trips;
- **G2** — a frequency-stats rollup over **10⁵ subject-builds** exceeds **5 s**,
  making the incremental cost visible in CI wall time.

Until a gate fires, JS/TS only.

## Rationale

The spike's stated risk (§10 M0) is *normalization quality*, not throughput. A
normalizer that is fast and wrong fails M0; a normalizer that is slow and right
passes it. Optimizing before the ruleset stabilizes would also mean rewriting the
optimized artifact every time the ruleset changes — and the ruleset is expected to
churn hard through M0/M1.

There is also a structural reason to expect the gate not to fire soon. Principle 1
(cheapest-representation-first) means the expensive stages run on a *shrinking*
subset: reachability culls most subjects, the structure+CSS digest culls most of
the remainder, and only the residue reaches semantic diff. The compute this
project performs is designed to be small. If native acceleration turns out to be
necessary at M0 scale, that is evidence the tiering is not working — and the
correct response is to fix the tiering, not to make a broken tier faster.

## If a gate fires

The boundary is already drawn correctly for it. `core` is pure data in / pure data
out (ADR-0001): no DOM, no I/O, no async. That is exactly the shape that ports to
a native module behind an unchanged interface. The candidate order is:

1. canonical serialization + hashing (hot, trivially portable, no policy)
2. tree diff (hot, moderate)
3. frequency rollup (batch, embarrassingly parallel)

Cascade resolution and banding stay in TS regardless — they encode policy, and
policy must remain legible and cheap to change.

## What this forecloses

- Native code as an early differentiator or a performance claim in launch
  material. We have no measurement, so we make no claim.
- Any `core` API that is async or streaming "so it can be native later".
  Speculative accommodation is how interfaces rot. `core` stays synchronous and
  data-in/data-out because that is the *simplest* correct shape, and it happens
  to also be the portable one.
