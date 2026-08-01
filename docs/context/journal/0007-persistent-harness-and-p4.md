# 0007 — The persistent harness, and P4 closed

**Date:** 2026-08-01
**Cycle:** helix 3, move M5
**Branch:** B4 (dual-surface) + B6 (per-profile ground truth), which had to land first

## Move

Two things, in order. Build `packages/harness-playwright` — one Chromium, one
page, one navigation for a whole run — and measure what the persistence is worth.
Then score the corpus under `chromium` and compare the two profiles, which is
claim P4 and the last untouched claim in the checkpoint.

**Expected readback:** the profiles agree on the dimensions both can observe.
**Disconfirming readback:** they disagree, and the disagreement names a defect in
one of the two collection paths. This is what happened, four times.

## 1. The cost of a capture

```
PERSISTENT HARNESS — cost of a capture
  captures:      48 distinct (subject, variant) renders
  cold             9840 ms   205.0 ms/capture   (browser + page + navigate + inject, per subject)
  warm              359 ms     7.5 ms/capture   (one browser, one page, no reload)
  ratio          27.4x
```

Reproduce:

```bash
yarn install --no-immutable
npx playwright install chromium
yarn build
yarn workspace @variance-authority/example-kitchen-sink bench
```

Three runs on the same machine (M-series mac, chromium@151.0.7922.34): 27.4x,
28.0x, 27.4x. Cold 203.9–205.7 ms/capture, warm 7.3–7.5 ms/capture.

Both arms call the same `capture`. `captureOnce` is `createHarness` +
`capture` + `close`, kept in the shipped package rather than written into the
benchmark, because a benchmark whose slow arm is a bespoke script measures the
script. One capture runs before the clock starts, so Playwright's driver startup
and the OS page cache are not charged to whichever arm ran first. The agent
bundle is built once and handed to both arms; a real caller builds it with the
rest of the build, so charging it per capture would be measuring esbuild.

**What the number means.** 7.5 ms is the same order as the `jsdom` tier, which
ADR-0002 priced at "~ms" against "~100ms" for chromium. That estimate was for a
chromium capture *including* navigation. Without it, the gap between the two
semantic tiers is roughly 5x, not 100x — the tier ordering survives, but the
argument for skipping chromium on a `jsdom` hit is much weaker than the ADR's
table suggests. Worth revisiting when the skip-order question (still open) is
decided.

**What it does not mean.** This is not "semantic capture beats screenshotting" —
no raster stage exists to compare against. It is only the cost of the harness
shape, which is the part that was entirely within our control and was about to
be got wrong.

### The shape

`createHarness({ url, bundle, viewport })` launches one browser, opens one page,
navigates once, and injects the caller's bundle once. `harness.capture(subject,
variant)` is a single `page.evaluate`. The harness knows nothing about subjects,
React, or the corpus: the injected bundle installs a `PageAgent` at a known
global and everything DOM-facing lives behind it. That split is what lets the
same harness serve a fixture page, a Storybook, or a route.

`capture` returns a JSON **string** across the bridge, and the harness parses it.
Playwright would happily structured-clone the object, and that would hide the
property ADR-0002's sub-renderer protocol depends on — a capture that only
survives an in-process clone is a capture that cannot cross a pipe. Making the
text round trip mandatory means a capture that acquires a `Map` or a cycle fails
here rather than three transports later.

The cost of one shared document is that subjects can contaminate each other, and
the corpus is *about* contamination. The page agent tears the previous case down
— React root, injected sheets, portal host, host element — before rendering the
next, and `renderCase` independently removes every marked sheet on the way in.
The corpus's own `css-accretion` cases are the check on that: they assert that
irrelevant CSS growing during a session does not move a hash, and they pass under
`chromium`.

## 2. B6 — per-profile expectations (ADR-0008)

`wrapper-flex-block/wrappers` was contested because its note said two
incompatible things: that the only defensible `jsdom` answer is `hash-stable`,
and that a `jsdom` harness must exclude it rather than record a miss. Deciding
between them is the whole of B6.

The decision: **`hash-stable` there is not an expectation, it is a consequence of
blindness.** Scoring it as a pass credits `jsdom` for an answer it reached by not
looking, and the number that inflates is precisely "agreement on the dimensions
both can observe". So a case may declare itself `undecidable` under a profile and
is excluded from that profile's score in both directions.

Three states, kept apart because collapsing any two destroys the measurement:
undecidable (exclude), divergent (both answers correct, argument mandatory), and
undeclared divergence — which is not declarable at all, because it is the finding.
See ADR-0008.

`prop-size/button` and `wrapper-flex-block/wrappers` both left `contested`.
`dialog-open/dialog` stays contested: it is an open question about the subject
boundary, not a per-profile one.

## 3. P4

```
M0 CORPUS MEASUREMENT — jsdom
  scorable cases:       38  (20 stable, 18 changed)
  undecidable here:      1   wrapper-flex-block/wrappers
  contested (excluded):  1   dialog-open/dialog
  agreed:               38/38
  false unchanged:       0
  false changed:         0

M5 CORPUS MEASUREMENT — chromium (chromium@151.0.7922.34)
  scorable cases:       39  (20 stable, 19 changed)
  undecidable here:      0
  contested (excluded):  1   dialog-open/dialog
  agreed:               39/39
  false unchanged:       0
  false changed:         0

P4 — PROFILE AGREEMENT (jsdom vs chromium)
  comparable cases:      38
  declared divergent:     0
  must agree:            38
  observed agreement:    38/38
  undeclared divergence:  0
```

Reproduce:

```bash
yarn build && yarn vitest run examples/kitchen-sink/src/measure.chromium.test.tsx
```

**P4 is met.** Both measurements live in one file and one run, because a
comparison assembled from two files is a comparison of two runs. The `jsdom` half
collects in-process; the `chromium` half drives the harness; both reach the
fixtures through the same `renderCase` and the same `jsdomSnapshot` /
`page-agent` pair, so a disagreement cannot be blamed on the fixtures.

The first `chromium` run scored **31/39**, with **8 false `changed` and 0 false
`unchanged`**, and 8/38 undeclared divergences. Every one was a real defect and
none was a case where the ground truth turned out to be wrong — the same shape as
journal 0006's first run, and for the same reason: the corpus was written before
either collector existed.

## The four defects P4 found

Each was invisible to either profile scored alone. That is the entire value of
the claim: these are bugs whose only symptom is that two observers of the same
render disagree.

### 1. Wrapper collapse was disabled outright under `chromium`

`isInertWrapper` tested every entry in the node's resolved style against a table
of initial values, and `isInertDeclaration` returns `false` for anything it does
not recognise — "silence is not evidence of inertness", which is correct
reasoning about a *declaration*. Under a profile with computed style there are no
silent properties: the engine reports all ~200 allowlisted ones, including used
values like `width: 1264px` that describe the parent's layout and not anything
the wrapper did. The first unrecognised one returned `false`, so **no wrapper
anywhere collapsed under `chromium`**, and six cases failed.

This is journal 0006's defect 1 again — one over-eager rule silently disabling
the whole collapse pass — arriving from the opposite direction. It is worth
saying plainly that the same rule has now been disabled twice by two unrelated
accidents, which suggests the rule is under-tested rather than unlucky.

Fixed by testing only what the node *declared*: an engine-computed value is not
evidence about the wrapper, and an inherited one passes through it either way.
Conservatism is kept where it is evidence — an unrecognised property the wrapper
declared still blocks the collapse.

Note what this does *not* break: `wrapper-flex-block/wrappers` still reports
`hash-changed` under `chromium` after the fix, because the wrappers collapse and
the *leaves* resize — they stop being flex items, so `flex-grow: 1` no longer
applies to them. That is the case working as designed for the first time. Before
the fix it "passed" because nothing collapsed, which is the right answer from the
wrong evidence.

### 2. A `var()`-tainted shorthand vanished from the capture under `chromium`

Chromium's CSSOM enumerates `padding: var(--a) var(--b)` as four *longhand*
names with **empty** values — pending substitution — and `declarationsOf` skipped
empty values. So the declaration disappeared from `matchedRules` entirely. JSDOM's
CSSOM keeps the authored shorthand instead. Same stylesheet, two different
captures, and `spelling/card`, `spelling/button` and `all-cruft/hero` read as
changes under `chromium` only.

The verdict was saved by computed style supplying the resolved value anyway, so
the visible symptom was only that token attribution differed. The invisible one is
worse: on the declared-only tier the same code path would have dropped a real
value out of the hash, which is a false `unchanged` waiting for a profile that
cannot cover for it.

Fixed in the collector: when a longhand enumerates empty, recover the shorthand
and emit it **unexpanded**, as ADR-0003 requires — decomposition is versioned by
`core`'s ruleset, not by whichever engine the collector happened to run in. The
recovery is restricted to `var()`-bearing values, because that is the only thing
that leaves a longhand pending; a resolvable shorthand enumerates as longhands
*with* values and re-emitting it would declare the same properties twice.

### 3. Metric collateral was raised as a cause

With the verdicts agreeing, claim P2 (one root per cause) failed on six cases
under `chromium` and none under `jsdom`. `token-space-3/hero` reported **six**
roots for one token edit: the token, plus a `component:` root for every component
whose box happened to resize.

The corpus predicted this in writing, a cycle before the collector ran:

> Under a profile with layout this also produces rect movement, which the
> attributor must fold under the same root as collateral rather than raise as a
> separate `geometry` finding.

`band.ts` says the same thing. Nothing implemented it. Fixed by holding metric
deltas — `rect-changed`, and `style-changed` on properties that are functions of
the used box rather than of any declaration — until every cause has a group, then
attaching each to the nearest cause: same node, then nearest change inside it,
then nearest change above it. Inside before above, because a box that grew did so
because of its contents far more often than because of its container.

A metric delta with no cause anywhere keeps its own root. That case is a real
finding — most often something outside the subject reaching in — and absorbing it
into an unrelated root would hide it.

Two smaller pieces fell out of the same investigation:

- **`currentColor` followers became second roots.** No rule declares
  `outline-color`, so it resolves through no token, but a token-driven `color`
  change moves it — giving "the accent token moved" *and* "Button changed" for
  one edit. Recognised now by the value matching `color` on both sides, so a node
  that declares its own outline colour is unaffected.
- **The subject root is owner-less.** It is the container the harness created, so
  it carries no fiber, and its height and rect move whenever anything inside
  does. It was producing an `unattributed` root on every case with real geometry.
  The same metric-folding rule covers it.

### 4. The token map meant two different things on the same tree

`prop-size/button` still reported two roots. The `<button>` recorded
`--va-line-height: 1.4` — the custom property's value, correct — while the text
node *inside it* recorded `--va-line-height: 19.6px`, the used line-height. The
inherited-value loop in `resolveStyle` was writing the *property's* value under
the *token's* name. The differ reads that map to decide whether a token moved, so
a font-size change made an untouched token look like it had moved, and the text
node became an independent root for a change with one cause.

This is journal 0006's defect 5 — attributing a change to a token that held — in
a place its corpus could not reach without a layout engine, since under `jsdom`
both values are the empty string.

**Where I got it wrong, and had to back out.** The obvious fix — only record the
token when its own value is known — produced a **false `unchanged` under `jsdom`
for `prop-size/button`**, the one failure this product cannot have. Under a
declared-only profile no custom property resolves at all (`:root` is outside the
subject, so applicability pruning drops it), so the map went empty on both sides
and the hash stopped moving. The shipped fix records the correct value when it is
known and falls back to the property value when it is not — a deliberate
over-report, a stand-in witness that *something* under this token moved, because
an absent entry is indistinguishable from "the token held".

That is the second time in two journals that a correctness fix, applied without
checking the weaker profile, converted a noisy report into a silent one. The
lesson is procedural, not technical: **any change to attribution or to the token
map must be run under both profiles before it is believed.** That is now cheap,
which is the other thing this cycle bought.

## One more defect, found by B6 rather than by P4

Scoring `prop-size/button` under `jsdom` — possible only once ADR-0008 let a
formerly-contested case be scored — produced a **non-identical diff with zero
deltas and zero roots**. The hash moved and the docket was empty: a reviewer is
told something changed and then told nothing about what.

Cause: `styleTokens` is part of the render hash but was never compared. Under a
profile that cannot resolve custom properties the resolved values are equal empty
strings and the style loop sees nothing, while the token *names* differ. Fixed
with a `token-changed` delta, emitted only when the resolved value did *not* also
move — otherwise the `style-changed` delta already names the property and
reporting both would split one cause in two.

## Where the profiles legitimately differ

Four cases shift band under `chromium` while agreeing on the verdict:

```
  token-space-3/hero:        jsdom token → chromium geometry
  prop-variant/button:       jsdom token → chromium geometry
  prop-size/button:          jsdom token → chromium geometry
  prop-primary-variant/hero: jsdom token → chromium geometry
```

All four are the same thing: real boxes move, `bandOf` puts `rect-changed` in
`geometry`, and `dominantBand` reports the worst band present. Only
`prop-size/button` declares this in the corpus, via ADR-0008's per-profile clause;
the other three are reported and not scored, because band was never asserted from
the default clause and turning 39 unasserted fields into assertions in the same
change would mix a format decision with a measurement.

This is worth flagging against ADR-0002, which says a policy blocking on
`geometry` is what makes the band system useful. **Under `chromium`, every
`token`-band change to a component that affects its size is reported as
`geometry`.** If a project blocks on `geometry`, that policy blocks on every
padding change — which is not what the band system was sold as. The corpus's
band-cardinality question ("does a subject report one band or a set?") is no
longer academic; it decides whether the `chromium` profile is usable as a gate.
It remains open, and it is a change to `SemanticDiff`, not to the corpus.

## What I could not do

- **Nothing was measured on another machine.** The cold/warm ratio and every rect
  in the corpus come from one mac with one Chromium. Font metrics decide rects,
  and the environment key records fonts as a string the caller supplies rather
  than as content hashes, so a second machine could produce different geometry
  and the key would not say so. `collect` warns about this; the corpus does not
  fix it.
- **The `jsdom` half of the P4 file runs under Vitest's jsdom environment, and
  esbuild refuses to start there** — jsdom's `TextEncoder` produces a
  `Uint8Array` from another realm and esbuild checks for it. The agent bundle is
  therefore built in a child process. Ugly, and the alternative was splitting the
  comparison across two files, which would have made it a comparison of two runs.
- **No raster stage, so no screenshot to be cheaper than.** The 27x is the cost of
  the harness shape, not of the product claim.
- **One corpus, still built by us.** Both profiles now agree on it. That proves
  the two collection paths implement one ruleset; it does not prove the ruleset
  holds on someone else's component library.

## P4

> Both profiles agree on the dimensions both can observe.

**Met**, on 38 comparable cases, with four defects repaired to get there and one
of the four repairs backed out and redone after it produced a false `unchanged`
under the weaker profile. The claim is now a measurement rather than an argument
from construction, which is the only thing that changed about it.
