# 0018 — Where a change enters the room

**Date:** 2026-08-13
**Question:** every instrument in this system reads a page that has stopped
moving. Four proposals arrived that all read *earlier* than that. Are they four
things, or one thing at four depths?

One thing at four depths. A change enters a rendered page at a sequence of
points, and each instrument that exists catches it at exactly one of them:

| Where it enters | What sees it | Where that lives |
|---|---|---|
| an input to a component | nothing, until now | `contrast.test.tsx`, [spec 0024](../../specs/0024-what-a-prop-controls.md) |
| a commit React schedules | the commit tap | [`commits.ts`](../../../packages/react/src/commits.ts) |
| a boundary that has not resolved | the Suspense reader | [`suspense.ts`](../../../packages/react/src/suspense.ts) |
| a byte on the wire | the asset map and `network.settle()` | [`stabilization.md`](../../stabilization.md) |
| the end-state DOM and CSS | the five bands | [ADR-0018](../adr/0018-a-component-hash-covers-its-own-nodes.md) |
| a pixel that already differs | a diff mask | everyone, including Argos |

The wire and the end state were already instrumented. **The two rows in the
middle were not, and they are where "the page had not finished" actually
happens.** The row at the top is where "and this is what did it" actually
happens. The row at the bottom is where the incumbents start.

## The incumbent starts at the last row, and says so

Argos publishes [`mask-fingerprint`](https://github.com/argos-ci/mask-fingerprint):
take the mask of differing pixels, dilate it, crop to its bounding box, reduce to
an N×N grid of densities, quantize, and hash to a 64-bit integer. Two diffs of
roughly the same shape in roughly the same place hash equal, so a database can
`GROUP BY` them.

It is a good piece of engineering and its own framing is precise: **tolerant
equality, not approximate similarity.** It answers *has this exact shape of
difference been seen before* — which is the recurrence question, and this
repository asks it too ([ADR-0031](../adr/0031-the-run-asks-what-is-recorded-now.md)).

The difference is the key. A fingerprint is a key in *pixel space*: a region, a
shape, a density. Change the viewport and it is a different key for the same
defect; move the component down the page and it is a different key; two unrelated
components whose diffs happen to be the same blob are one key. This repository's
recurrence key is a component and a band, which survives all three and carries a
`file:line` — the fingerprint carries no provenance at all, because at the layer
it works on there is none left to carry. **You cannot recover which component
moved from the shape of the pixels that moved.** That is not a flaw in the
implementation; it is what the layer knows.

## Playwright polls in pixel space too

`toHaveScreenshot` decides a page has settled by taking screenshots until two
consecutive ones match. It is an entirely reasonable thing to do with the
information available to a screenshot API, and it has two costs: it pays a
raster per poll, and when it fails it can only report that the page kept
changing.

Both costs are artifacts of asking in the wrong space. React knows exactly when
it commits, and it will say so to anyone who asks before it loads.

## The tap: what the scheduler will tell you, and when

`__REACT_DEVTOOLS_GLOBAL_HOOK__` is not a debugging aid, it is a documented
handshake: a renderer looks for that global when its module body runs, and if it
finds an object with `supportsFiber` and `inject`, it reports every commit to
`onCommitFiberRoot`. Nothing about it needs the extension. It needs to exist
**first**, which is the entire operational constraint and the reason
[`commits.test.tsx`](../../../packages/react/src/commits.test.tsx) calls
`tapCommits()` at module scope and imports `react-dom` dynamically underneath it.

What arrives is better than a settle signal. Every fiber carries a `PerformedWork`
flag, and `subtreeFlags` bubbles it, so the committed tree can be walked with
whole branches pruned and the walk yields exactly the components that rendered —
the same test DevTools uses to decide what to highlight. Measured: a mount of
`Shell → (Restless, memo(Quiet))` reports `['Shell', 'Restless', 'Quiet']`, and a
state update inside `Restless` reports `['Restless']` alone. The memoized sibling
is absent rather than listed-and-unchanged, which matters, because a report that
names it sends a reader to a component that did nothing.

So a page that will not settle produces a sentence instead of a timeout. On a
component with a 5ms `setInterval`, `awaitQuiet` returns `settled: false` and
`restless: [{name: 'Ticker', commits: n}]` — and `Page`, which rendered once at
mount and never again, is **not in the list at all**.

### The refusal is the interesting part

A tap that attaches late hears nothing, and hearing nothing is indistinguishable
from a quiet page. That is the failure mode that would make this instrument worse
than useless, so `tapCommits` looks for a `__reactContainer$…` expando on any
element and, finding one, refuses: `attached: false`,
`reason: 'react-already-loaded'`. An unattached tap returns `settled: false` from
`awaitQuiet`, always. **No silence is ever reported as quiet.**

The same reasoning produced a real bug in the first cut. `reactVersion` was
snapshotted when the tap attached — but by construction the tap attaches before
React injects, so a correctly-instrumented page reported "no React" every time.
It is a getter now.

## Suspense: the boundary needs no hook at all

The commit tap needs to be first. Reading Suspense does not, and that asymmetry
is worth stating because it decides where each instrument can be used.

A Suspense fiber's `memoizedState` is `null` when it is showing its children and
an object when it is showing its fallback — with `dehydrated` set if the fallback
is server-rendered markup awaiting hydration. That convention is reachable by
pure traversal from the `__reactFiber$…` expando this package already reads for
provenance, which means the state of every boundary is available *at any time*,
on a page nobody instrumented in advance, including in production.

Verified on React 19.2.8, with the test asserting
`__REACT_DEVTOOLS_GLOBAL_HOOK__` is `undefined` so the claim cannot rot into
an accident.

What comes back is not a count. A pending boundary reports the owner chain above
it, innermost first, and the component that wrote the `<Suspense>`: `owners:
['Panel', 'Page']`, `createdBy: 'Panel'`. Nested boundaries report their depth
and their own state separately — an outer boundary that never fell back reads
`resolved` while the inner one reads `pending`, because reporting both as pending
would send a reader to the wrong `<Suspense>`. And the walk is scoped to the
subject: a spinner in an `<aside>` is not this `<section>`'s problem, which is
asserted directly.

**Both of these are shipped and neither is wired into `settle()`.** They are
exports of `@variance-authority/react`; the collector still waits on the network
and the document digest.

## The fourth depth: what a prop controls

The other three all answer *when* and *who*. The last one answers *what caused
it*, and it turned out to need no new collection at all.

Render a component twice, varying exactly one prop, and diff the band digests.
Whatever moved is what that prop controls.
[`contrast.test.tsx`](../../../examples/todomvc/src/contrast.test.tsx) does this
for seven props of the example design system. Four rows came out as predicted
and three did not:

| Prop | Predicted | Measured |
|---|---|---|
| `Chip.selected` | `semantics`, `style` | `semantics`, `style` |
| `Chip.label` | `text` | `semantics`, `text` |
| `Text.tone` | `style` | `style` |
| `Text.size` | `style` | `style` |
| `Text.as` | `structure`, `style` | `structure`, `semantics` |
| `Button.variant` | `style` | `style` |
| `Toggle.checked` | `semantics`, `style` | `structure`, `semantics`, `style` |

Every surprise has a cause the system already holds, and none of them is a bug:

- `Chip.label` reaches `semantics` because a `<button>` with no `aria-label`
  takes its accessible name from its content. Changing the words changes what a
  screen reader announces, which is correct and was not obvious.
- `Toggle.checked` reaches `structure` because `checked` is on
  `ATTRIBUTE_ALLOWLIST` and `aria-pressed` is not — `aria-*` is resolved into
  role/name/state instead. So two props that look like the same kind of prop land
  in different numbers of bands, for a reason that lives in the rule set rather
  than in the design system.
- `Text.as` reaches no `style`, and that is the profile: jsdom is
  `declaredStyle` only, and the single author rule in play, `.va-text`, matches
  the `<span>` and the `<h1>` alike. What separates them is the user-agent
  cascade — `h1`'s `font-weight: bold`, `display: block` — which reaches nothing
  until `computedStyle` is on. Asserted, so the row cannot be mistaken for a
  finding.

The predictions were wrong in three places out of seven, **which is the argument
for measuring this per component rather than writing it down once.** The table is
a property of a design system's implementation, not of its API.

### What it costs, and what stops it

Nothing, and one field. `boundary.ts` pushes only `frame.propsDigest` into the
value it hashes, so an added field on `OwnerFrame` reaches no stored digest and
invalidates no baseline. What is missing is that the props side is one opaque
digest: two instances can be seen to disagree about their inputs, and nothing
recovers which input. The join in the spike is a table a person wrote, and
replacing that person with a per-key digest is
[spec 0024](../../specs/0024-what-a-prop-controls.md).

The sentence it buys is a negative, and negatives are what the attribution ladder
runs out of: *`Chip` moved in `style`, and the only prop of `Chip` that reaches
`style` did not change* is a far stronger claim than the `unexplained` that
[`composition.md`](../../composition.md) currently ends on.

## What this changes about the argument

The comparison document's honest position has been that this system wins on
*attribution* and matches on *detection*. Two of these four move detection as
well, and in the same direction: they are all instruments that read a page
**before** it is a picture, in the vocabulary the framework already uses.

A tool that only ever sees pixels can build a very good key for a shape of
difference. It cannot build a key for a component, because by the time it looks,
the components are gone.
