# ADR-0002 — Observation profiles: JSDOM and REAL-DOM are different environment keys

**Status:** accepted
**Date:** 2026-08-01

## Context

The spec (§4.2) describes one semantic snapshot containing ARIA tree, normalized
computed styles, **and layout rects**. It assumes a real engine.

JSDOM has no layout engine. `getBoundingClientRect()` returns all zeros and
`getComputedStyle()` returns only what was declared, with no cascade resolution for
anything requiring layout. A snapshot taken naively under JSDOM is *shaped* like a
real one but silently missing the entire `geometry` band. Compared against a
Chromium baseline, every layout rect reads as "changed to 0×0" — or, where rects are
omitted, a real geometry regression reads as `unchanged`. **A false `unchanged` is
the worst possible failure mode for this product.** It is the one thing the tool
must never do.

## Decision

A snapshot carries an **observation profile**: the declared set of dimensions the
collector was *capable* of observing, independent of what it actually found.

```ts
interface ObservationProfile {
  id: 'jsdom' | 'chromium';
  ariaTree: boolean;
  declaredStyle: boolean;
  computedStyle: boolean;   // cascade fully resolved
  layout: boolean;          // real box geometry
  raster: boolean;
}
```

The profile is normative in three ways:

1. **The profile id is a component of the environment key.** Baselines are stored
   per `(subject, environmentKey)`. A `jsdom` snapshot and a `chromium` snapshot of
   the same subject occupy different manifest slots and are *never* diffed against
   each other. Attempting to is an error, not a mismatch.

2. **A dimension the profile says is unobservable is absent from the hash input,
   not present-and-empty.** Absence is encoded structurally, so a profile upgrade —
   a tier gaining layout — is a clean cache miss rather than a silent comparison of
   zeros.

3. **Bands are gated by profile.** A `jsdom` verdict can never be `unchanged` for
   the `geometry` band, because `jsdom` cannot observe geometry. It reports
   `geometry: unobserved`. A tier that cannot see a band must say so rather than
   pass it.

Because `core` may not touch a DOM (ADR-0001), the collector boundary is a
serializable request/response pair:

```
CollectRequest  { subjectId, profile, viewport, rulesetVersion, ... }
CollectResponse { snapshot, diagnostics, timings }
```

Nothing in that pair is a live object. The transport is therefore free: in-process,
worker, IPC, or HTTP to a device farm. The remote transport is not implemented, and
no code may assume the collector is local.

## Consequences

JSDOM is not a cheaper substitute for the browser. It is a **different, earlier
gate**:

- runs in the unit-test process, in milliseconds, with no browser
- catches ARIA/structure/content/declared-style regressions at the point of edit
- produces the same provenance chains (fiber traversal is engine-independent)

JSDOM decides the `token` band and the structural half of `geometry` — nodes
appearing, disappearing, reordering — cheaply. Real box geometry, moves and resizes,
requires an engine. Cheapest-representation-first (Principle 1) therefore has three
tiers, not two:

```
reachability  →  jsdom semantic  →  chromium semantic  →  raster
   free            ~ms                  ~100ms            ~seconds
```

## What this forecloses

- Any "run it in JSDOM to approximate the browser" story. No correlation heuristic
  between profiles ships. They are separate baselines.
- Sharing one baseline across profiles to save storage.

## Known limits

Whether a `chromium` `unchanged` permits skipping the `jsdom` tier for that subject,
or the reverse, is unresolved. Cheapest-first argues for running jsdom first and
skipping chromium on a hit, but that is sound only for bands jsdom can actually
observe. The resolution is a measurement; see `journal/`.
