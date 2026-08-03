# 0016 — The hot loop everyone assumes is 9% of the cost

**Date:** 2026-08-04
**Question:** should any of this be Rust, or want some other specifically fast tool?

[ADR-0004](../adr/0004-defer-native-acceleration.md) refuses to answer that from
an opinion. It admits native code only when a **recorded benchmark in this
directory** clears one of two gates, so this is that benchmark. One Mac, Node
v22.23, synthetic inputs, one sitting — limits restated at the end.

## The raster tier

A comparison decodes two PNGs and runs pixelmatch over them.

| At 1280×800 (1.02M px, 631 KiB) | |
|---|---|
| `PNG.sync.read`, one image | **22.7 ms** |
| — of which `zlib.inflateSync` (already native) | 9.8 ms (43%) |
| — of which JS un-filtering and copy | 12.9 ms (57%) |
| **pixelmatch alone**, one pair | **4.8 ms** |
| `comparePngs`, one pair, end to end | **50.6 ms** |
| `decode` (base64 → Buffer), one pair | 0.2 ms |

Clipped to a component at 400×300, decode is 2.9 ms and the same 40/60 split
holds.

**The per-pixel comparison is 9% of the cost.** The other 90% is getting the
pixels out of the container, and *half of that is already native* — `pngjs`
delegates inflate to zlib and hand-rolls the un-filtering in JavaScript. So the
whole prize available to a native rewrite of the compare path is the 12.9 ms of
un-filtering per image, and taking it does not require a language: it requires a
different decoder behind the seam `@variance-authority/png` already draws.

Base64 decode being 0.2 ms is worth recording because it looks expensive and is
not — the store's habit of carrying rasters as base64 costs nothing measurable.

## The semantic tier, against gate G1

G1 is *normalize + diff of one subject over 50 ms at p95 on a realistic tree of
≥2000 nodes, with the majority attributable to compute*. There is no I/O in this
benchmark at all, so the second half is satisfied by construction.

| 2201 nodes, 3 matched rules each | p50 | p95 |
|---|---|---|
| trial 1 | 42.4 ms | 50.7 ms |
| trial 2 | 41.7 ms | 48.2 ms |
| trial 3 | 41.5 ms | 48.7 ms |
| 5501 nodes | 108 ms | **120.6 ms** |

**G1 is grazed, not cleared.** Two of three trials land under the threshold and
one lands over it, which is a measurement sitting inside its own noise band, and
that is not a gate firing. At 5501 nodes it is not close, but a 5501-node
*subject* is not what ADR-0007 makes a subject: the boundary is a component tree,
and the warm capture figure the cost model uses is 7.5 ms, which is where a few
hundred nodes lands.

`diffSnapshots` is 7.8 ms of the p95. Normalization is the rest.

### And normalization is flat in the thing that would have justified porting

Holding the tree at 2000 leaves and varying what each node carries:

| rules/node | style props | normalize p95 |
|---|---|---|
| 1 | 1 | 22.3 ms |
| 3 | 1 | 19.2 ms |
| 6 | 1 | 20.2 ms |
| 3 | 5 | 19.8 ms |
| 3 | 15 | 17.9 ms |

Six times the matched rules and fifteen times the custom properties cost
nothing. The work is **per node**, not per declaration — allocation, tree walk,
canonical serialization, hashing.

That matters more than the totals, because ADR-0004 drew the line in advance:
canonical serialization and hashing are candidate 1, "hot, trivially portable,
no policy", while "cascade resolution and banding stay in TS regardless. They
encode policy." The measurement says the cost is in the half that was already
declared portable, and *not* in the half that was declared off-limits. The ADR
guessed right about where the time would be, which is worth saying because it
could easily have guessed wrong and left a decision that could not be acted on.

## Gate G2 is unmeasurable, and that is the finding

G2 is a frequency rollup over 10⁵ subject-builds exceeding 5 s. There is no
rollup to measure: `@variance-authority/history` has the rows and the drift
arithmetic and **no caller** ([spec 0002](../../specs/0002-history-store.md)),
so nothing has ever accumulated a build. A gate over a workload that does not
run cannot fire, and reporting it as "not fired" alongside G1 would imply it had
been checked.

## What none of this touches

| | |
|---|---|
| Chromium cold launch + first navigation | ~205 ms (journal 0007) |
| Warm semantic capture, per subject | 7.5 ms |
| Raster tier, per subject | 65.4 ms |

The dominant cost of a run is a browser, and no language change moves it. Every
number above is downstream of a process this project does not implement and
would not want to.

## The answer

**No Rust, and the reason is not conservatism.** In order:

1. **The biggest win is not decoding at all, and it has already been taken.**
   Spec 0011 item 0 made the settled path answer from a sidecar, so a subject
   that did not change now costs **zero** PNG decode instead of 45 ms. That is
   worth more than any achievable constant factor on the decode itself, and it
   is exactly what ADR-0004 predicted: "native acceleration becoming necessary
   at current scale is evidence that the tiering is not working; the correct
   response is to fix the tiering."

2. **The one honest native candidate is PNG decoding, and it is a dependency
   swap rather than a migration.** `comparePngs` and `decode` are already the
   seam. Replacing `pngjs` with a native decoder is a change to one package with
   a parity suite over it, and the ceiling is the 12.9 ms of JS un-filtering per
   full-viewport image — real, bounded, and available without writing a line of
   Rust. **Nobody should port pixelmatch.** It is 4.8 ms.

3. **Nothing in the semantic tier qualifies yet.** G1 is grazed on a tree at the
   very top of the plausible range and comfortable everywhere below it.

## Addendum — the browser-decode trick, and prior art that skips the question

Asked whether the decode should happen in Chromium instead, on the recollection
that Node's PNG handling was once slow enough to make the round trip worth it.
That recollection was correct when it was formed and **is no longer true**.

Same 1280×800 pair, decoded in headless Chromium via `createImageBitmap` →
`OffscreenCanvas` → `getImageData`, compared in-page, with only a count returned:

| | |
|---|---|
| in-page decode of both images | **44.9 ms** |
| `pngjs` decode of both images | 45.7 ms |
| in-page per-pixel diff | 1.4 ms |
| `pixelmatch` | 4.8 ms |
| **in-page total, round trip from Node** | **65.0 ms** |
| **`comparePngs` total, in Node** | **50.6 ms** |

The decoders are within 2% of each other, so the premise the trick rested on has
evaporated — and once the CDP round trip is counted, moving the work into the
browser is **28% worse**. The 1.4 ms against pixelmatch's 4.8 ms is not a
like-for-like win either: that loop is a plain RGB inequality, where pixelmatch
does antialiasing-aware YIQ. It is the cost of a weaker comparison, not a faster
one.

### `whales-story-shots`, and what it does instead

A previous tool of this project's author, and the same thesis one step earlier:
*hash the HTML and CSS, screenshot only the stories whose hash moved*. Its
capture step prunes CSS to the classes actually present in the HTML before
hashing, which is ADR-0003's applicability pruning arrived at independently.

Its answer to PNG cost is more radical than decoding in the browser: **it never
decodes a PNG anywhere.** Its dependencies are `playwright`, `plimited` and
`sanitize-filename` — no `pngjs`, no `pixelmatch`, no `sharp`, no canvas.
Playwright writes the screenshot straight to disk and nothing reads the bytes
back. Chromium's encoder is the only PNG code in the pipeline.

That works because **it has no pixel verdict**. The comparison is the HTML and
CSS hash; the image is an artifact for a person to look at, produced only for
stories the hashes already flagged.

So the decode cost measured above is not waste this project failed to remove. It
is what the raster tier *buys*: a mask, clustered into regions, joined to the box
tree, resolved to a component and a file. whales cannot produce that and does
not pay for it. The half of its answer that does apply here is already taken —
spec 0011 item 0 made an unchanged subject decode nothing at all, which is
whales' rule for the settled path exactly.

What remains genuinely round-trip-shaped is that **Chromium encodes a PNG and we
immediately decode it**, both ends ours, purely because the transport between
them is a file. The measurement above says the fix is not to move the decode into
the browser. It would have to be a raw-pixel transport, which Playwright does not
offer.

## What would change this

- A corpus of *real* subjects where p95 node count exceeds 2000. This benchmark
  fabricated its trees; the shape of a real design system's largest stories is
  unknown here and is the input that decides G1.
- A history backend with a caller, which would make G2 measurable for the first
  time.
- Full-page rather than clipped screenshots. Journal 0010 already notes clipping
  flatters the raster arm's byte count ~6×; it flatters decode by the same
  factor, and a full-page tool pays 22.7 ms per image rather than 2.9 ms.

## Limits

One machine, one Node version, one sitting, synthetic inputs, no CI runner. The
p50/p95 figures come from 30–40 iterations after a warm-up, so they measure
steady-state JIT rather than the first subject of a run. Nothing here was run
under contention, which is what a CI runner actually is.

The in-page figures carry two more. `getImageData` includes canvas compositing
and a readback, so 44.9 ms is "browser decode as it could actually be used"
rather than decode alone — which is the honest comparison to make, but it is not
a decoder benchmark. And headless Chromium here is almost certainly on
SwiftShader; a GPU-backed runner could move that number in either direction.
