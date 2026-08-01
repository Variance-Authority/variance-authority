# 0012 — "The camera is not flaky" was a measurement with the work removed

**Date:** 2026-08-01
**Cycle:** helix 4, move M10
**Branch:** B10 (pixel arm)

## The correction

Journal 0011 reported:

> Shooting the same mounted story twice is exactly 0 differing pixels, every
> round, both policies. The folklore is wrong.

The number is right and the conclusion was not. That experiment holds the mount
fixed, the process fixed, the machine fixed, the fonts fixed, and the clock
irrelevant — every cause of real variance removed — and then reports that
variance does not occur. It is a statement about a *sensor*, answering a question
nobody has.

Nobody's screenshots differ because the camera drifted. They differ because **the
same commit rendered twice does not render identically**: a font substitutes, a
runner is retina, a timestamp advances, an image decodes a frame later. That is
real work showing up in the picture, and it is what a VR tool actually has to
survive.

## What was measured instead

Five sources of variance a pipeline does not control, each a pair of runs of the
*same code*, with the expectation for **both arms** declared before measuring.

```
INSTABILITY — two runs of the same commit
  source               pixel arm          ours     absorbed by
  ------------------------------------------------------------------------
  text-smoothing       moves (177px)      holds    construction
  device-pixel-ratio   moves (3015px)     holds    environment-key
  scrollbar            holds              holds    headless-artifact
  clock                moves (73px)       moves    policy
  block-whitespace     holds              moves    nothing
```

```bash
yarn build && yarn vitest run examples/todomvc/src/pixel.chromium.test.ts
```

The useful column is the last one. "Does it flake?" is the wrong question;
**"what would it take to absorb?"** is the right one, and the answers are not
interchangeable:

- **construction** — the change cannot reach the representation. Glyph
  rasterization is not a property of the box tree, so `text-smoothing` is
  invisible to the semantic arm without any threshold being set. This is the
  `texture` band of §5 doing exactly the job it was specified for.
- **environment-key** — the two runs are different *baselines*, not a diff. A 2×
  render genuinely is a different artifact, so "the hash held" would be a false
  `unchanged` on its own; it is correct only because `deviceScaleFactor` is in the
  key and the runs never meet. A pixel differ has the same option and must be
  configured to take it.
- **policy** — both arms move and both are right. What differs is the cost: a
  pixel differ masks a coordinate region, silencing whatever else lands there and
  breaking when layout moves; the semantic arm masks the *text node*, which
  follows the content.
- **nothing** — `block-whitespace` is ours. Reindenting JSX inside a block renders
  identically and moves our hash.

## Two predictions were wrong, and one probe was not a probe

**`device-pixel-ratio` was predicted to hold and moved.** The prediction was
internally inconsistent: I claimed the render hash would hold *and* that the
environment key would differ, when the key is folded into the hash. The
measurement now separates them — `content` is structure plus style, and the
environment key is asserted separately. Content holds; the key differs; the runs
never compare. That decomposition is the honest answer and the first version
could not have expressed it.

**The scrollbar probe changed the subject's own height**, which is an edit, not
variance. Rewritten to grow the page *around* the subject — and then it stopped
reproducing at all.

## The finding I did not go looking for

Headless Chromium uses **overlay scrollbars**. Growing the page to 2400px leaves
the subject at exactly 1008px:

```
subject width before/after page growth: 1008 1008 | innerWidth 1024
```

So the classic scrollbar reflow does not happen headless, for either arm. And
that belongs to both equally: **a headless pipeline is blind to a reflow every
headed user experiences.** For this cause the usual "it only flakes in CI" story
is exactly inverted — CI is the environment that cannot see it.

Recorded as `absorbedBy: 'headless-artifact'` rather than deleted, because a
probe that fails to reproduce is evidence about the environment.

## What this does and does not say

It does **not** say the semantic arm is steadier in general. It says the two arms
are disturbed by *different* things, and that the ones the semantic arm absorbs
it absorbs by construction or by the environment key rather than by a tolerance —
which matters because a tolerance large enough to swallow rasterization noise is
also large enough to swallow a small real change, and nothing tells you which it
just did.

The `block-whitespace` row is kept in the table for the same reason the
blind-spot probes are kept: a comparison that only ever finds in its own favour
is an advertisement.

Every probe here **simulates** its cause — a smoothing mode instead of a
different GPU driver, a second browser context instead of a second runner —
because varying the machine is not available inside a test. That is a real limit
on what these numbers establish, and it is stated in the file rather than left
for a reader to work out.

## Verification

```bash
yarn build && yarn test
```

447 passed, 3 skipped. Both corpus measurements unchanged: `jsdom` 38/38,
`chromium` 39/39, zero false verdicts.
