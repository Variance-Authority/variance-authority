# 0042 — the lanes were there the whole time

[ADR-0004](../adr/0004-defer-native-acceleration.md) has been read twice as "no
native code", and both readings of the measurements behind it said the same
thing: the cost was never where a language would reach it. Decoding is 90% of a
comparison and `pixelmatch` is 9% ([journal 0016](0016-where-the-time-actually-goes.md));
`sense`'s stages are already a third native and lose their remainder to a format
rather than a rewrite ([journal 0041](0041-what-a-rewrite-would-buy.md)). Neither
reading looked at the one thing in this repository whose *shape* wants SIMD.

`measureYiqDistance` is a flat loop over two byte arrays producing a
`Float32Array`: no allocation, no branches that depend on anything but the
pixels, the same nine multiplies on every iteration. That is a vector kernel
written as a scalar one, and it sat inside a gate whose thresholds were drawn for
normalization, diff and rollup, so nobody had a number for it.

## The reproduction

```bash
yarn workspace @variance-authority/raster build
```

```bash
yarn workspace @variance-authority/raster simd
```

The SIMD arm is 130 lines of WebAssembly text in
[`scripts/yiq-simd.wat`](../../../packages/raster/scripts/yiq-simd.wat): four
pixels per iteration, `u8` widened to `i16` to `f32`, then a 4×4 shuffle
transpose that puts R, G and B on parallel lanes so the quadratic form runs once
for four pixels instead of four times for one. It is hand-written because there
is no Rust toolchain on this machine and the kernel did not need one — a second
toolchain was never the cost of finding out.

## What it buys

```
1280x800 opaque pair, median of 30

                                        0% changed   5% changed   100% changed
JS, as shipped                            2.92 ms      2.58 ms       4.35 ms
SIMD, images already in wasm memory       0.65 ms      0.65 ms       0.65 ms
SIMD, skipping identical quads            0.17 ms      0.20 ms       0.59 ms
the copies alone                          0.33 ms      0.32 ms       0.27 ms
SIMD as a JS caller pays for it           0.96 ms      0.97 ms       0.93 ms
```

Four to seven times on the kernel, and **thirteen to seventeen** in the regime a
regression suite actually runs in, because a `v128.xor` against a 16-byte group
retires four identical pixels in one test and most pixels in a screenshot pair
are identical. The JS loop has the same early-out and it is per-pixel; the
vector one is per-quad and costs one instruction.

The flat 0.65 ms line is the finding underneath the speedup. SIMD does not care
how much of the image changed, so the arm that skips is the *only* one that
tracks the workload — and the shape of a real suite is the left column, not the
right.

## What the boundary charges

**A third of the wasm path is copying.** Every decoder this package is fed by —
`pngjs`, `sharp`, Chromium over CDP — hands back an array on the JS heap, and
none of them can be told to write into a wasm linear memory instead. So two
4 MB images go in and a 4 MB field comes out, and 0.3 ms of the 0.96 ms is memory
bandwidth doing nothing else.

This is [journal 0041](0041-what-a-rewrite-would-buy.md)'s finding arriving from
the other direction. There, oxc's native parse cost 11 ms and handing its tree to
JavaScript cost 10 ms. Here the arithmetic costs 0.65 ms and handing the pixels
across costs 0.33. **The crossing is the same size as the work**, in both
directions, in unrelated stages, measured a month apart. A decoder that wrote
into wasm memory would delete that third outright, which makes the decoder seam —
not the kernel — the place the next measurement belongs.

## The parity result is what decides the shape

```
1,024,000 random opaque pairs, the whole 8-bit domain
  worst deviation        4.768e-7
  worst f32 ulp distance 11
  worst curve point      1 pixel, at severity 0.25
```

JS evaluates the quadratic form in `float64` and rounds once on the way into the
`Float32Array`. The SIMD arm rounds at every operation. Eleven ulps is nothing to
look at and it is not nothing: at severity `0.25` the two kernels put a different
number of pixels above the level, and a curve point that depends on which build
ran is not a measurement.

So the two cannot both be in the tree, and that is a constraint on *deployment*
rather than an argument against the kernel. [`png/mask`](../../../packages/png/src/mask.ts)
already carries the reason in its own header: a diff is computed in Node when a
run writes its report and in the browser when a reviewer opens a change, and two
ends computing the same thing is only safe while it is literally the same code.
A `.wasm` satisfies that better than the JS does — it runs in Node, in the review
page, and in the Worker the tribunal is, which is the one environment where every
accelerant that won in [journal 0016](0016-where-the-time-actually-goes.md) is
unavailable. The replacement is single-implementation or it is nothing.

## What this does not say

It does not fire a gate, and it does not make the metric worth attacking yet.
Staged against the pipeline it sits in:

```
observeDifference, 1280x800, 5% changed        5.96 ms
  the kernel's arithmetic                      2.66 ms   45%
  differenceCurve                              3.16 ms   53%
  createField, run twice                       0.80 ms   13%
```

**The curve costs what the kernel costs.** It is already `O(pixels + levels)`,
and what it spends is a binary search per pixel over eight levels — three
unpredictable branches on a million pixels, to bucket a value that is zero for
most of them. Replacing the kernel and leaving that in place takes 5.96 ms to
roughly 4, which is not worth a `.wasm` in the tree. Both, plus the second
validation pass, would take it under 1.5.

And the difference path is still the residue path. It runs on pairs that a mask
has already flagged, not on every subject. The share that would make this pay is
the share it does not yet have.

## The gate

ADR-0004 stands and nothing here fires it. What changes is that the record now
has a number for the one workload neither G1 nor G2 described, and the number is
large enough that the next three questions are worth naming rather than
rediscovering:

- **the decoder seam, not the kernel.** A third of the win is lost to a copy that
  exists only because no decoder writes into wasm memory. That is measurable
  today and it is worth more than the kernel is.
- **the tribunal.** The day the Worker computes a mask or a field at volume, wasm
  stops being the fast option and becomes the only one above plain JS — and it
  starts from behind, since both wasm PNG decoders tested in journal 0016 lost to
  `pngjs`.
- **the curve, first.** It is half the pipeline, it needs no toolchain, and
  removing work beats performing it faster — which is the same sentence journal
  0041 ended on.
