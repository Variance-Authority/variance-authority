# Journal 0036 — The model picks the engine

**Date:** 2026-08-30

> **The timings in this entry are superseded by journal 0038.** About 30 ms of
> every reading below is Playwright's element actionability wait — two animation
> frames, charged per subject, in every engine — and not the engine painting.
> The reuse-over-isolation finding survives and is *understated* here; the engine
> ordering under reuse does not, because it depends on the subject. The pixel
> findings are unaffected.

Chromium is the default engine everywhere, WebKit has the reputation of the
slowpoke, and nobody had measured it here. The question was worth asking twice
over: which engine costs least per subject, and whether the pixel differences
between engines are large enough that driving one and verifying on another is a
thing a run can survive.

Both answers turned on the same thing, and it was not the engine. **The first
measurement was of the harness, and it inverted the result.**

## The reproduction

```bash
yarn workspace @variance-authority/case-incumbent bundle
```

```bash
yarn workspace @variance-authority/case-incumbent engines 80
```

```bash
yarn workspace @variance-authority/playwright paint 30
```

The first benchmark drives the incumbent case's eight scenarios — a subject with
pre-registered ground truth about which changes are regressions — through four
session models on every installed engine, then compares the captures. The second
does the same cost measurement on the product's own render path, so the ordering
is not an artefact of the case's page.

Apple M4 Max, 16 cores, Node v26.7.0, Playwright 1.62.1: chromium
151.0.7922.34, firefox 153.0, webkit 26.5.

## Under reuse, WebKit is twice Chromium's speed

> Corrected in 0038: it is not, in general. On this subject it is; on a
> raster-heavy one Chromium wins. Every number in the table below carries the
> two-frame constant.

```
80 subjects per model, 8 distinct, 800x600 @1x

engine      remount   reset   navigate   isolate    tax
chromium      64.1    64.1      79.5     146.5    2.3x
firefox       47.5    47.8      81.4     248.2    5.2x
webkit        31.0    31.0      62.9     197.7    6.4x
```

`remount` is one page with the subject switched in place through the page's own
API — the model ADR-0009 argues for, and the shape of a Storybook story switch.
`isolate` is a fresh context and page per subject, which is Playwright's own
fixture. `navigate` reuses the page and reloads it.

The ordering **reverses between the two ends of that table**. Under isolation
Chromium is fastest by a comfortable margin and WebKit is 35% behind it. Under
reuse WebKit is fastest by 2.1×, and Chromium is last. The product's own renderer
reports the same reversal on a different subject: 74.3 ms against 49.9 ms reuse,
225 ms against 485 ms isolated.

The cause is in the `tax` column. Isolation costs Chromium 2.3× and WebKit 6.4×,
so **the tax is heaviest on the engine that paints fastest**. A benchmark shaped
like Playwright's default fixture is therefore mostly a measurement of process
setup, and it hands the win to whichever engine opens a context cheapest. That is
a plausible route by which the whole industry came to believe what it believes
about these three engines, and it is not a fact about rasterisation.

## Reset is not the expensive half

The objection to reuse is state surviving between subjects, and the answer to it
has to be affordable or the objection wins by default:

```
clearing storage and cookies, timed alone: chromium 0.30ms, firefox 0.30ms, webkit 0.30ms
```

Under one percent of a subject, on every engine. The end-to-end `reset` column
above cannot resolve it — a third of a millisecond inside a 31 ms subject is
below the engines' own run-to-run spread, and the difference of the two medians
read as high as 10 ms and as low as zero across five runs of the same command.
Timing the primitives directly is the same claim with an instrument that can see
it. **Isolation does not buy cleanliness. It buys a process, and charges for the
cleanliness separately.**

## The captures are stable, after the first pass

Every subject, painted repeatedly through `remount` on all three engines, is
byte-identical to itself — but only once every subject has been painted once.
Warming a single subject was not enough, and the way that surfaced is the reason
the drift check reports magnitude instead of a boolean: Chromium's first capture
of the first subject differs from its next capture, seven subjects later, on
**14 pixels by one least-significant bit** — 0.0107% of the clip — and every
capture after that is identical. Firefox and WebKit never moved at all.

So the warm-up is now a full untimed cycle, which is also the honest arrangement
for a run: a suite pays a first pass too, and it is the second one that has to be
stable. Nothing accumulates over 80 subjects on any engine.

## A pixel tolerance cannot separate an engine from a defect

```
agreement — area is the share of cells differing by >2% luminance, peak is the largest

  scale   two engines, same subject      one engine, before vs after     tells
  1x1     area <=  5.94%   peak <= 99.08%    area       -    peak       -     0
  4x4     area <=  9.71%   peak <= 33.22%    area <=  0.10%   peak >= 83.11%    1
```

Geometry is identical in all three engines for every scenario. The disagreement
is entirely text rasterisation, and **it is not small**. At pixel scale a glyph
edge goes from nearly white in one engine to nearly black in another: the worst
cross-engine pixel differs by 99.08%, which is the whole range. There is no
amplitude threshold at that scale, and there is no area threshold either — two
engines painting the *same* subject disagree across 5.94% of it while a real
regression moves 0.10%, so a tolerance wide enough to absorb the engine is
sixty times wider than the defect it is supposed to catch.

**The separation is made by scale, not by threshold.** Averaged into 4×4
luminance blocks the engine's disagreement collapses from 99% to 33%, because it
is high-frequency and signed — one engine puts weight a third of a pixel to the
left of where the other does, and averaging cancels it. A dropped indicator does
not cancel, because the element is absent: it reads 83.11% at the same scale, and
reads it in all three engines within a quarter of a percent of each other
(83.39 chromium, 83.11 firefox, 83.24 webkit).

Averaging in linear light matters here. Blurring or averaging gamma-encoded
values darkens edges and manufactures a difference that is not on the screen.

Against the corpus's pre-registered ground truth, every pixel-visible regression
is told on every engine — two by a size change that needs no reading at all, one
by block amplitude — and nothing that is not a regression fires. The three
regressions that never reach the pixels are absent, correctly: no comparator can
see them, which is an argument for the other signals and not a defect in this
one.

## Only Chromium can be told how to paint text

The fast engine is the one that takes no instruction. `CHROMIUM_RASTER_ARGS`
already passes `--disable-lcd-text` and `--font-render-hinting=none`, and there
is no Firefox or WebKit equivalent — their text is painted the way the host
paints text.

On this machine the asymmetry is dormant, and not for the reason it looked like.
Black text on white, measured for chroma — a pixel that is not grey can only have
come from a rasteriser weighting the subpixels:

```
                                     fringed px   worst channel spread
chromium headless                             0                  0/255
chromium --disable-lcd-text                   0                  0/255
chromium headed / @2x                         0                  0/255
firefox headless                              0                  0/255
webkit headless / headed / @2x                0                  0/255

chromium default vs --disable-lcd-text          0 px differ
chromium default vs --disable-font-subpixel-positioning   0 px differ
chromium default vs --font-render-hinting=none  0 px differ
webkit default vs -webkit-font-smoothing:antialiased   4204 px differ
```

**No engine emits subpixel antialiasing here at all**, headed or headless, at 1×
or 2×, and all four Chromium flags move zero pixels. macOS removed subpixel
antialiasing system-wide in 10.14, so there is nothing on this host for them to
switch off. The flags are still correct to pass — they are pinning against a host
default that exists elsewhere — and where fontconfig is live, which is Linux and
therefore most CI, they are load-bearing.

WebKit's only lever is page-side. `-webkit-font-smoothing: antialiased` does
change WebKit's raster, by 4,204 pixels of a 500×160 subject, and that is exactly
why it is not a stabilisation: it changes what is being photographed rather than
the conditions it is photographed under. A baseline recorded that way is a
baseline of something the product does not render.

So the raster tier's rule is asymmetric by engine. A Chromium raster can be
pinned against its host; a WebKit or Firefox raster can only be **produced in one
place**. `RenderIdentity` already carries `platform` alongside `engine` and a
`rasterization` digest over the launch arguments, so a laptop's baseline and a
container's are separate baselines and a run reports `incomparable` rather than
comparing them. That is the safe failure and not a solution — neither answers for
the other.

The operational consequence: if rasters are produced in a container, produce them
**only** there. A local WebKit renderer records baselines nothing will ever
compare against and charges the raster tier for them. The semantic tier is
unaffected and stays local, which is what ADR-0010's two keys are for.

## Two ways the measurement lied first

**A Playwright project named `webkit` runs Chromium** unless something sets
`use.browserName`. The project name selects nothing. It surfaced because all
three "engines" reported an identical 146 ms median, which is not a number three
rasterisers produce. Device presets supply the engine through
`defaultBrowserType`; a hand-written `use` block has to say it. Every reading
taken before that was found was a reading of Chromium three times.

**`fullyParallel` is off by default**, and without it the tests in one file run
in a single worker whatever `--workers` says. The first parallel arm showed no
speedup at eight workers and the conclusion drawn from it was about the engines.

Both are the same failure as a stale build: the run answers fluently and answers
the wrong question.

## What is not measured

**Anything but this machine.** The taxes are process-setup costs and they scale
with core count, page cache and disk; the reuse medians are rasterisation and
they scale with the GPU. The ratios are what is being claimed.

**Fonts beyond the system stack.** The corpus's subject uses the platform's own
fonts. A webfont loaded identically in all three engines would narrow the
cross-engine disagreement and does not change the argument about scale, but the
99.08% figure is a property of *these* glyphs at *this* size.

**Linux and Windows.** Every reading here is darwin/arm64. The claim that
Chromium's font flags become load-bearing under fontconfig is the documented
behaviour of those flags and is *not* measured here — this host cannot exercise
it, because macOS has no subpixel antialiasing to disable. WebKit under
Playwright is not Safari either, and its rasterisation on another platform is
another measurement.
