# 0009 — Naming the component, counting the collateral, separating reflow from repaint

**Date:** 2026-08-01
**Cycle:** helix 4, move M7
**Branch:** B9 (impact axis)

## Move

Three questions, asked together because they turn out to be one gap seen from
three sides:

1. Can we name the component that changed?
2. Can we track collateral of a design-system change?
3. Can we tell a layout update from a styling one?

**Expected readback:** each is answerable from data already in the snapshot.
**Disconfirming readback:** answering any of them needs a rendering measurement
the cheap tier cannot make — in which case the tier ladder is weaker than claimed.

## Result: expected

```
3 of 3 subjects changed, explained by 2 roots.
  token: --brand — 3 subjects, 3 collateral, token/paint,  structure intact — Button, Card, Hero
  token: --space — 3 subjects, 3 collateral, token/layout, structure intact — Button, Card, Hero
```

Those two lines are the whole answer. Same band, same reach, same components, one
character of difference that decides whether anything can have moved.

## (3) first, because it was the missing model

The frequency bands (§5) classify *what kind of thing changed*: structure, a
value, sub-pixel noise. They do not classify *how far it can reach* — and those
are not the same question.

A spacing token and a colour token are both `token` band. Changing spacing
reflows the document and can move a node on the other side of the page; changing
colour repaints one box and can move nothing at all. Reporting both as "a token
changed" hides the first thing a reviewer wants to know.

So **impact** is a second axis, orthogonal to bands, not a refinement of them:
`layout` | `paint` | `composite`, derived from which property moved. `--brand` is
`token/paint`; `--space` is `token/layout`.

The payoff is a **bound, not a heuristic**:

> A paint-only change has no geometric collateral. Ever.

That follows from how rendering works, so a subject whose every delta is
paint-impact needs no layout comparison to rule out geometry regressions. It is
how a profile with no layout engine answers *"could this have moved anything?"* —
by reasoning rather than by measuring, which is the only way that tier can answer
it at all.

Two classifications are easy to get wrong and are called out in the code:
typography metrics (`font-size`, `line-height`, `letter-spacing`,
`text-transform`) are **layout**, because they change glyph advances and resize
the boxes containing them — a "typography token" change is a layout change. And
`border-*-width` is layout while `border-*-color` is paint; treating `border` as
one thing would make every colour tweak look capable of moving the page.

An unrecognized property is classified `layout`, the widest answer. Impact is used
to *rule out* collateral, so an unknown treated as paint would let a real reflow
pass unexamined.

### It also settles what journal 0007 left open

The chromium run found that any token change altering a component's size reports
as `geometry`, because `dominantBand` returns the worst band present — so a
project blocking on `geometry` blocks on every padding change. That was recorded
as an open question about band cardinality.

It is not a band problem. The bands were right; the model was missing the axis
that distinguishes those cases. `token/layout` versus `token/paint` says exactly
what a policy needs, and *which* of the two to gate on is spec §7.2's business,
not the differ's. The open link is now a policy decision rather than a modelling
gap.

## (1) Naming the component

Roots already named components; nothing said in what *capacity*. Now every diff
carries a component view splitting `root` from `collateral`:

- **root** — the change originated here
- **collateral** — this component renders something that changed; nothing about
  it changed

"Three components changed" reads like three problems. "`Button` changed, and two
components render it" reads like one, which is what it is.

Only the innermost owner is credited with a delta. Otherwise every enclosing
component accumulates every delta beneath it and the page component is the
biggest change in every diff, every time.

`renderedIn` answers *where does this show up* — the propagation half of the
spec's running sentence, *`Button` (variant prop change) → propagated to
`NewHero`*.

**Got it backwards first.** The owner chain is innermost-first, so the frame that
*encloses* a component is the next one out, not the previous one. The first
version recorded the previous frame, which answers "what does this component
contain?" — a question nobody asked, and one that reads as an answer to the right
question until someone checks. Caught by the one test that asserted a specific
name rather than non-emptiness.

## (2) Counting design-system collateral

A `SemanticDiff` answers "what changed in this subject", which is the wrong unit
for review. One token edit arrives as three hundred subjects to click through,
and the three-hundred-and-first gets approved without being read.

`buildDocket` inverts it: aggregate roots across subjects by root **id**, which is
why root ids were built to be stable across subjects — `token:--color-primary` is
the same root wherever it lands, so grouping needs no similarity heuristic.

Each entry carries subject count, delta count, the components reached, whether
structure held, and a **sample** to spot-check. That last one is spec §7.3's
requirement, and the reason is not politeness: mass re-baselining is only
survivable if approval is informed, and nobody informs themselves by reviewing
three hundred identical diffs.

`structureIntact` excludes rect changes that were *derived* from a style change.
Otherwise every spacing token would look like it rearranged the page.

## Folding a rect change under its cause

A rect that moved because this node's padding changed is one edit observed twice.
It now carries `derivedFrom` and inherits the causing delta's token, so it lands
in the same root instead of splitting into a `token` root and an
unrelated-looking `geometry` one.

A rect that moved with *no* layout-impact change on the same node stays
independent — something upstream reflowed and pushed it, which is exactly the
propagation worth surfacing rather than folding away.

## Verification

```bash
yarn build && yarn test
```

400 passed, 2 skipped. Both corpus measurements unchanged: `jsdom` 38/38,
`chromium` 39/39, zero false verdicts, zero undeclared divergence.

## Not done

**The docket has never seen a real change set.** It is tested on constructed
diffs at three subjects. "One token, 300 collateral, one action" is demonstrated
at 3, not 300, and nothing has run it over a repository. The aggregation is
linear in roots and subjects so scale is not the risk — the risk is that real
repositories produce root shapes this corpus does not.
