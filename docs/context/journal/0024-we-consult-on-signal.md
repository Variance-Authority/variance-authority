# 0024 — We consult on signal

**Date:** 2026-08-13
**Question:** [0022](0022-the-error-react-already-threw.md) resolved React 19's
captured frames into files inside `collect()`, for every node of every capture.
[0023](0023-the-version-that-never-lost-it.md) measured what that costs: 14
distinct call sites on a 4211-node page, 17.6 ms cold. Bounded, and paid by every
subject in the suite — including the ones that settle on a document digest and
never print a line about anything. Who was that fetch for?

## Nobody, most of the time

A green suite is the design centre of this product. Every subject matches its
baseline's digest, no image is rendered, no comparison runs, and the report says
so in one line per subject. On that path there is no region, because nothing was
compared, and usually no finding, because the render is clean. A location has no
one to be handed to.

The old shape spent the frames anyway, because it spent them where they were
captured. It was the wrong side: capture knows what a page *has*, and only the
report knows what anyone is going to *ask*.

## The move, stated as one line

Frames ride the normalized snapshot, and `locateSites` spends them for the nodes
a region or a finding names.

That is the whole change. `locateCapture` — which walked a capture and rewrote
every node's provenance — is gone, replaced by:

```ts
locateSites(sites, snapshot, resolver): Promise<readonly T[]>
```

where a *site* is anything carrying a `path` and possibly a `source`. An
`AttributedRegion` is one. A `Finding` is one. They arrive from opposite
directions — one from a mask, one from an inspection — and both are already the
*handful*, which is what makes this affordable rather than clever.

Three ways a site costs nothing, all of them common: it has no `path` (no box
contained it), it already has a `source` (React ≤18 and `jsx-source` both record
one outright, and attribution has already copied it across), or its node carried
no frames (a production build captures none). And a subject that settled never
calls this at all.

## What had to be true for this to be safe

Deferring meant a snapshot now carries frames, and a frame holds an absolute URL
with a dev server's port in it. If anything hashed, compared or stored one, every
baseline would disagree with itself across a restart.

Nothing does, and each was checked rather than assumed:

- **No hash sees it.** `structureOf` and `styleOf` in
  `packages/core/src/rules/normalize/project.ts` are whitelist projections, and
  neither admits provenance at all.
- **No comparison sees it.** `compare-nodes.ts` reads `owners` and `createdBy`.
- **No disk sees it.** A snapshot is never serialized. The history record writes
  the component hashes it folds out of one; the raster sidecar does the same.

So `rooted()` in normalization now passes `stack` through untouched — and
deliberately unrooted, because a frame's URL is what the *fetch* needs and a
repository-relative path is not fetchable.

The claim is asserted twice. `normalize.test.ts` states it directly: a node with
frames hashes identically to one without. The browser suite states it the way a
reader can see it — the React 19 fixture and the React 18 fixture render the same
JSX into the same DOM and arrive in genuinely different states, one holding
unspent frames and one holding a recorded location, and all three of their hashes
are equal.

## What it changed about the collectors

Less than expected. Each collector already built one `CallSiteResolver` per run;
it now hands it out on `Collector.callSites` instead of spending it, and
`collect()` normalizes the capture it acquired rather than a rewritten copy. The
resolver stays per collector rather than per subject on purpose: the cache is the
thing that makes any of this bounded, and a suite's subjects share their modules.

`observe-one.ts` is where the signal is read, on both sides of it — regions after
the observation, findings on both the compared path and the settled one. A
settled subject with a finding still gets its line, which is right: inspection is
not a comparison, and a defect present on a subject that changed nothing is
exactly the case a comparison can never reach.

## What this does not do

It does not make resolution free — it makes it proportional. A subject where
fifty regions landed across a large page resolves what those fifty nodes need,
and the cache collapses them onto the modules they share. What it removes is the
whole-suite tax: a hundred green subjects used to pay a hundred times for
answers no one read, and now pay nothing.

It also narrows what a recorded snapshot carries. `source` is now filled only for
nodes something asked about, so a snapshot is no longer a complete map of where
every element was written. Nothing consumes such a map — regions and findings are
what name nodes, and both ask — and that is the trade, stated rather than
discovered later.
