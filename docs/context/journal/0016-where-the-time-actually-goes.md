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

2. **The one honest candidate is PNG decoding, and the fast decoder is already
   running.** `comparePngs` and `decode` are the seam, so this is a change to one
   package with a parity suite over it. The addendum below measures the options:
   a native Node decoder could recover the 12.9 ms of JS un-filtering, and
   *Chromium* — a process `variance run` already launches — decodes at **2×
   `pngjs`** and parallelises across a pool for **~10×** on comparison
   throughput. Neither needs a line of Rust. **Nobody should port pixelmatch.**
   It is 4.8 ms.

3. **Nothing in the semantic tier qualifies yet.** G1 is grazed on a tree at the
   very top of the plausible range and comfortable everywhere below it.

## Addendum — the browser-decode trick, measured three times

Asked whether the decode should happen in Chromium instead, on the recollection
that Node's PNG handling was slow enough to make the round trip worth it — a
performance decision taken about six years ago in a predecessor tool.

**It was right then and it is still right.** This section reported the opposite
twice before getting there, and both mistakes are recorded below because each one
is a way to fabricate a null result.

### The honest numbers

16 **distinct** 1280×800 PNGs, each decoded to RGBA, no image reused:

| | |
|---|---|
| Chromium, each image seen for the first time | **12.4 ms** |
| Chromium, the same images a second time | 1.5 ms *(cache, not decode)* |
| `pngjs` in Node | **24.7 ms** |

**Chromium's decoder is 2.0× `pngjs`** on the cold path, which is the only path
a real run has. And decoding is off the main thread, so a *pair* costs less than
two singles: `Promise.all` over both images inside one page comes in under the
sum.

Throughput over 24 distinct pairs, decode plus `pixelmatch`, against this repo's
own `comparePngs`:

| | total | per pair |
|---|---|---|
| browser farm, 1 worker | 447 ms | **18.6 ms** |
| browser farm, 4 workers | 183 ms | **7.6 ms** |
| browser farm, 8 workers | 139 ms | **5.8 ms** |
| Node, sequential, main thread | 1375 ms | **57.3 ms** |

**~10× on the comparison stage**, and the transport that was supposed to sink it
— 631 KiB of base64 per image over CDP — is visibly not the binding constraint.

### The two ways this was measured wrong first

**A per-byte JS loop, costing more than the decode it fed.** The first attempt
built a `Blob` with `Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))` and ran
`createImageBitmap` over it: **17.5 ms** of the 26.5 ms was that one line.
Handing the base64 straight to `new Image()` as a data URL lets Chromium do the
same work in native code. The benchmark was measuring my own string handling and
attributing it to the browser.

**An image cache, mistaken for a decoder.** The second attempt decoded the *same*
data URL twelve times and reported 1.4 ms. Chromium caches decoded bitmaps, so
eleven of those twelve were a lookup. The cold figure is 12.4 ms — 9× worse than
what the loop reported, and the difference is the entire finding.

Both produced a *plausible* number. Neither measured decoding.

### How the predecessor actually does it

A pool of eight browsers, each a page that has been prepared with
`page.evaluate('var module = {}')` and then `addScriptTag({path:
require.resolve('pixelmatch')})`. `pixelmatch` is CommonJS, so it assigns itself
to the `module.exports` already sitting in page scope, and the injected matcher
calls it there. Every story is fanned across the pool with `Promise.all`; each
page decodes both images from data URLs, runs `pixelmatch`, and returns **a
single integer**. A dimension mismatch short-circuits to a sentinel rather than
comparing.

Two things that design gets for nothing: the decode leaves Node's event loop
entirely, and the parallelism costs no `worker_threads`, no native addon, and no
thread pool of its own — it is a pool of processes that were going to be launched
anyway.

### Is `pngjs` simply a bad decoder?

No. It is mid, and every drop-in replacement tried is equal or worse. 16
distinct 1280×800 images, cold, **every candidate verified byte-identical to
`pngjs`'s RGBA** before being timed:

| | |
|---|---|
| Chromium | **12.4 ms** |
| `sharp` (libvips, native addon) | **14.5 ms** |
| `pngjs` (current) | 23.5 ms |
| `@cwasm/lodepng` (wasm) | 28.3 ms |
| `@cf-wasm/png` (wasm) | 99.8 ms |

Both wasm decoders are *slower* than the pure-JS one, and one is 4× slower.
`png-rs` is not published to npm. `@jsquash/oxipng` is a compressor rather than
a decoder and is not a candidate for this at all.

That result is what makes the choice awkward rather than obvious. The only
faster library is a **native addon**, which the tribunal cannot load — it is a
Cloudflare Worker. Wasm is the portable option and wasm is the slow end. So
there is no swap that helps everywhere, and the ~2× on the table is not sitting
in a package: it is Chromium plus the pool, which is a design change.

### What this means here

The fastest PNG decoder in this system is **already running in a process this
system already starts**. `variance run` holds a persistent Chromium, renders a
document, has Chromium encode a PNG, ships it to Node, and decodes it there at
half the speed the browser it came from would have managed.

That is a real and available win — journal-measured at 2× on decode and ~10× on
comparison throughput — and it needs no Rust, no native module, and no new
dependency. What it needs is answers to three things this benchmark does not
settle, which is why it is a spec and not a patch:

- **The mask has to come back.** The farm returns an integer; this project needs
  the changed-pixel mask, because clustering it into regions is what produces a
  component and a file. A 1 MP mask is not an integer, and how it crosses back —
  RLE, coordinate list, or region extraction done in-page — is the design.
- **Two decoders must agree exactly.** A verdict that depends on which decoder
  read the bytes is not deterministic, and determinism is the product. `pngjs`
  and Chromium agreeing on 8-bit non-interlaced RGBA is likely and is not
  established here.
- **Not every consumer has a browser.** The tribunal is a Cloudflare Worker with
  no Chromium in reach, so the Node path stays regardless and this becomes a
  second implementation to hold in parity — exactly the shape
  `packages/observe/src/parity.test.ts` exists for.

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
and a readback, so 12.4 ms is "browser decode as it could actually be used"
rather than decode alone — the honest comparison to make, but not a decoder
benchmark. And headless Chromium here is almost certainly on SwiftShader; a
GPU-backed runner could move it in either direction.

The farm figures were taken with eight browsers on a laptop that has more cores
than that. A CI runner with two vCPUs will not see 8-way scaling, and the
per-worker memory of eight Chromium processes is a cost this benchmark did not
weigh at all.

**And the meta-limit, earned here rather than assumed:** two of the three
measurements in the addendum were wrong in ways that produced believable numbers.
A benchmark that agrees with a prior is not evidence; it is the case that most
needs decomposing.
