# Journal 0038 — The wait was most of the measurement

**Date:** 2026-08-31

Journals 0036 and 0037 measured three engines across two hosts and two
architectures, and both reported a number for "what a paint costs". Roughly
thirty milliseconds of that number was Playwright waiting for something we had
already established, in every engine, on every host, for every subject.

This entry names the constant, removes it, and re-measures everything the two
earlier entries concluded from it. Their pixel findings are untouched — those were
never timings. Their **timings are superseded by the tables here**, and one of
their headline claims is wrong in a way that matters.

## Firefox, and the number that gave it away

The question that started this was whether Firefox is an interesting option. It
is, and the case for it is in the last section — but it could not be answered
from 0037's table, because Firefox sat at 33.4 ms there and so did WebKit, and
33.3 ms is exactly 1/30 s. A measurement that lands on a frame boundary in two
engines is a measurement of a frame boundary.

It is not vsync. The distribution rules that out: Firefox's light subject clusters
33 of 40 samples in a single 4 ms bucket, and the same engine on a heavy subject
spreads from 78 to 106 ms with no quantization anywhere. A cap would still be a
cap under load.

## Two animation frames, charged per subject

`locator.screenshot()` does not only capture. It first runs Playwright's
actionability wait, which requires the subject's box to hold still across two
consecutive animation frames. Measured against the frame period each engine
actually runs at:

```
engine     rAF period   two frames   element shot minus viewport shot
chromium        15.3         30.7                              32.6
firefox         16.3         32.7                              29.2
webkit          16.7         33.4                              29.1
```

The right-hand column is the same document captured two ways, and it is the
left-hand column. Four attempts to explain it as anything else all failed on
Chromium: `animations: 'disabled'` (62.8 ms), JPEG instead of PNG (61.2),
a viewport shrunk to barely more than the subject (62.4), and `--disable-gpu`
(62.0), against a 58.0 ms baseline. It is not encoding and it is not the GPU.
Nor is it Playwright's wrapper: a raw CDP `Page.captureScreenshot` costs 25.6 ms
where Playwright's own viewport screenshot costs 25.4, and an `ElementHandle`
pays the wait exactly as a `Locator` does (58.6 against 63.2).

The wait is sound in general and redundant here. By the time the renderer
captures, the stabilization recipe's waits have run, fonts have loaded, and every
network channel has been blocked for the whole lease. It re-establishes what we
have just established, at the price of the paint.

## What the constant was hiding

Two costs were being added together and reported as one number, and they are
charged to different engines.

The benchmark now paints two subjects, because one subject cannot show this. The
first is text on a flat fill — what 0036 measured. The second is 240 blurred,
shadowed, gradient-filled cells under a per-subject rotation. Medians of three
60-paint runs on macOS, one page reused:

```
                light subject      heavy subject
engine        element   clip     element   clip
chromium         59.2   26.2        71.7   36.8
firefox          33.3    8.5        50.1   21.6
webkit           33.3    3.7        67.9   45.5
```

Subtracting across that table gives the two costs directly:

```
engine     capture (light clip)   marginal raster (heavy - light)
chromium                   26.2                              10.6
firefox                     8.5                              13.1
webkit                      3.7                              41.8
```

**Chromium's capture is expensive and its rasterizer is cheap. WebKit is the
exact reverse.** Chromium pays 26 ms before it has drawn anything interesting,
seven times WebKit; WebKit then pays four times Chromium's price for the drawing
itself. Firefox is second on both.

So the engine ordering is a property of the *pair*, not of the engine:

```
light subject:   webkit 3.7   <  firefox  8.5  <  chromium 26.2
heavy subject:   firefox 21.6 <  chromium 36.8 <  webkit   45.5
```

WebKit is first on one subject and **last** on the other. That is the correction
to 0036, and it is not a matter of degree: the engine that entry named as twice
Chromium's speed is, on a subject that rasterizes, 24% slower than Chromium and
110% slower than Firefox.

The constant is what let one subject stand for all subjects. At ~30 ms on every
reading, the light subject's true 7x spread (3.7 to 26.2) reported as 1.8x
(33.3 to 59.2), and a spread that small looks like the kind of thing that will
not reorder. It reorders.

Reproduce both subjects with one command — this is now an arm of the committed
benchmark rather than a probe, so the claim above cannot go stale silently:

```bash
yarn workspace @variance-authority/playwright host 60
```
## The same rectangle, without the wait

`page.screenshot({clip})` asks for the subject's rectangle and skips the wait. It
is the same image only if the clip is rounded the way the element path rounds a
fractional box: **floor the near edge, ceil the far one**, which is the union of
pixels the subject touches. Of five roundings tried it is the only one that
matches. Rounding the *extent* instead of the far *edge* is the tempting mistake
and it fails on a box of integer size at a fractional offset — 420 px wide
starting at x=7.3 spans 421 columns.

The one-off battery was 240 generated subjects — fractional sizes, fractional
offsets, borders, shadows, axis-aligned transforms — in all three engines at both
device scale factors: 240/240 byte-identical. Seven of those cases are committed
as `packages/playwright/src/capture.chromium.test.ts`, so the claim has a
reproduction that runs with the suite rather than only in a transcript.

Three conditions send a subject back to the element path, each because it was
measured to need it:

- **No reported box.** Detached, or `display: none`. There is no rectangle to
  clip to.
- **Not wholly inside the viewport.** A clip rect is viewport-relative and
  Playwright refuses one that leaves it: a subject below the fold throws
  `Clipped area is either empty or outside the resulting image` in all three
  engines. An oversized subject is worse — it returns, silently truncated.
- **Rotated or skewed.** The reported box is then not the rectangle the element
  path captures, and the two disagree on every edge.

The transform test reads the composed matrix's off-diagonal terms rather than the
declared string, so any spelling of a rotation is caught by one check. It is
deliberately conservative: `rotate(90deg)` is axis-aligned in its result and still
takes the slow path, because being wrong here rewrites every baseline a user owns.

## The cross-host matrix, re-measured

Medians of three 60-paint runs on macOS and arm64, two 30-paint runs on amd64,
one page reused throughout. Every row in every run reported the two capture paths
byte-identical.

```
                     element                      clip
engine       macOS  arm64  amd64   |   macOS  arm64  amd64
chromium      61.8   67.9   77.4   |    29.0   34.0   35.6
firefox       33.3   35.3   47.4   |     8.3    7.5   13.9
webkit        33.3   40.0   40.9   |     3.5    5.8   11.0
```

`macOS` is this host, `arm64` is `mcr.microsoft.com/playwright:v1.62.1-noble`
under Docker Desktop 29.0.1, `amd64` is the same image translated. Reproduce with:

```bash
yarn workspace @variance-authority/playwright host 60
```

```bash
docker run --rm --ipc=host --user pwuser -v "$PWD/box:/work" -w /work \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  mcr.microsoft.com/playwright:v1.62.1-noble node host.mjs 60
```

Two of the three clip columns are steady to a tenth of a millisecond across
repeats — Firefox 8.3/8.3/8.4 native and 7.0/7.8/7.5 in the container, WebKit
3.5/3.6/3.3 and 5.8/5.9/5.6. **Chromium's is not**: 29.0/26.8/38.9 natively,
against 34.5/33.9/34.0 in the container. The one engine whose capture dominates
its paint is also the one whose paint will not sit still on this host, so the
Chromium-native cell is the weakest number in the table and a 1.17x container
ratio computed from it should not be quoted to two figures.

A second set of three runs on the same host, recorded later with the heavy-subject
arm added, reproduced every other cell within a millisecond and put that one at
25.9/26.2/27.9. Six recorded runs therefore span 25.9 to 38.9 for Chromium native
clip, with five of them between 25.9 and 29.0 — so 38.9 is an outlier rather than
the spread, and the cell is best read as ~27.

The container and the translated container produced **identical raster digests**
— `574715aff898`, `9bce28c9628b`, `9b300d27ba9d` for the three engines on both
architectures. That is 0037's central pixel finding, reproduced here on a
different capture path, and it is the half of 0037 that was never in doubt.

### 0037's headline is wrong, and this is how

0037 concluded that **a container costs nothing per paint** — within 10% on all
three engines. That was measured with ~30 ms of constant added to both sides of
the ratio, which is the arrangement in which a ratio understates. On the paint
alone:

```
engine     element path   clip path
chromium          1.10x      1.17x
firefox           1.06x      0.90x
webkit            1.20x      1.66x
```

WebKit pays 66% to run in the container, not 20%. And Firefox is **faster in the
container than on this Mac** — 7.5 against 8.3, with every one of the three
container repeats below every one of the three native repeats. The container is
still cheap. "Costs nothing" was the constant talking.

0037's nine-arrangement ordering survives — **for the subject it was measured
on**, which is the light one. On that subject it still partitions perfectly by
engine:

```
webkit  macOS   3.5      firefox amd64  13.9
webkit  arm64   5.8      chromium macOS 29.0
firefox arm64   7.5      chromium arm64 34.0
firefox macOS   8.3      chromium amd64 35.6
webkit  amd64  11.0
```

The slowest non-Chromium arrangement is translated x86 in a container at 13.9 ms;
the fastest Chromium is 29.0 on bare metal. Neither host nor emulator moves an
engine across that line — the gap they open is 5–66% and the gap between engines
is 4x.

**But the subject does move engines across it, and easily.** Swap the light
subject for the heavy one and Chromium beats WebKit on the same machine, 36.8
against 45.5, without any host changing. So the shape of 0037's conclusion is
right — the engine matters more than where you run it — while the specific
ordering it hands a reader is only that subject's. 0037 reads as though the
ranking were a property of the three engines. It is a property of three engines
and one document.

### And the isolation tax is far larger than recorded

The same dilution ran the other way on the rejected session model, where the
constant was a *smaller* share of a much larger number. Reuse against a context
and page per subject, both on the clip path:

```
engine      macOS   arm64    amd64
chromium     2.5x    1.9x    19.2x
firefox     15.5x   14.2x    62.3x
webkit      42.6x   18.3x   110.7x
```

0037 recorded this tax as 1.6x to 5.5x natively, and that is what the element
path still reports, because ~30 ms lands on the reuse arm where it is most of the
measurement and on the isolate arm where it is a rounding error. WebKit under
translation pays **110x** to open a context per subject.

The standing rule that we reuse pages and contexts is not weakened by anything in
this entry. It is understated by an order of magnitude in the entry that first
measured it.

## What the product path gains

The renderer took the element path, so it paid the wait once per subject.
`packages/playwright/src/capture.ts` now takes whichever path is both cheaper and
identical, and falls back on the three cases above. `yarn workspace
@variance-authority/playwright paint 30`, against the figures 0036 recorded:

```
engine     0036    now
chromium   74.3   41.6
firefox    50.0   16.6
webkit     49.9   16.6
```

Firefox and WebKit now sit on the renderer's own post-capture
`requestAnimationFrame` turn — one frame — which exists to give queued callbacks
a chance to declare a missing resource. That is a correctness wait we are keeping,
and it is now the floor for two of three engines.

## Where this leaves Firefox

It is the only engine that is not worst at something.

WebKit's advantage is real but narrow: it wins on subjects with little
rasterization and loses badly on subjects with a lot of it, and it pays the
largest container penalty (1.66x) and the largest isolation tax (42.6x). Chromium
is the reverse — the cheapest rasterizer by 5x, behind a capture that costs 25 ms
before it draws anything.

Firefox is second on capture and second on raster, and second twice wins: on the
heavy subject it is first outright at 21.6 ms, against Chromium's 36.8 and
WebKit's 45.5. It is never worst on either subject, and it is the only engine of
the three that can say so. It is also the only engine the container does not
charge, and with an identical pinned font its cross-host geometry drift is 2 px
against WebKit's 22.

Against it: translation nearly doubles it (1.85x), which it very nearly shares
with WebKit (1.90x) while Chromium barely notices (1.05x) — its capture cost is
already so large that the emulator disappears into it. So on an x86 runner
Firefox's margin over Chromium narrows from 4.5x to 2.6x. It is still the margin.

And the stabilization recipe has only ever been asked to hold Chromium still. The
2 px drift is still a drift — Firefox travels *best*, not free, and the comparator
still refuses to compare across those two hosts.

## What this does not measure

Browser launch, which is paid once per session and whose spread across the runs
recorded here (54–1506 ms) is far larger than any difference between engines.

Whether the fast path applies to a real suite's subjects as often as it applies to
generated ones. The predicate requires the subject to be wholly within the
viewport, which is the normal case for a component or a story and is not
guaranteed for a full-page route.
