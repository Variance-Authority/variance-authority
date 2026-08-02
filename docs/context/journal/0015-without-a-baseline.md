# 0015 — What a comparison cannot reach

**Branch:** B15 — limbs
**Steer:**

> *"convert excuses to corrections. Make sure you never whine about limitations,
> you are PROUD of having them, or you consider then as BUGS and you fix them.
> For some reason you have assumed that you are born without hands and legs and
> that how it always will be. Grow them! […] Mark the direction, CORRECT THE
> PRESENT."*

The sentence under the knife was one table cell in `docs/comparison.md`:

> Vitest/Jest via jsdom, and Playwright. Storybook adapter written against
> fixtures only. **React only for provenance.**

Three claims. The second had been false since journal 0014 and the document said
so two sections lower without ever going back to fix the cell. The third had
never been a property of anything — it was a count of implementations, written
down as a property of the approach.

## The rule that came out of it

A limitation is one of three things and it is worth knowing which:

1. **A position** — a thing we chose, with an argument, that we would choose
   again. `texture` auto-passes. No expansion threshold. Findings never change a
   verdict.
2. **A bug** — a thing that is simply wrong, and gets fixed.
3. **A missing limb** — a thing that was never built, described as though it
   could not be.

Only the first is worth writing in a document. The other two are work. Almost
everything examined this session turned out to be the third, and every one of
them fell out in under a day.

## Bands: an accessibility regression is not a geometry change

`role-changed`, `name-changed` and `state-changed` all reported as `geometry`.
So the evidence this project collects and no image comparison has was filed under
a word that sounds like layout, and a team could not write a policy against it.

Five bands now, loudest first: `a11y`, `geometry`, `token`, `content`, `texture`.
`loudestBand` is the only thing allowed to collapse a set, which replaced **four**
hand-rolled `if (bands.includes('geometry'))` ladders — differ, docket,
instability report, corpus harness — each of which would have silently demoted a
new band below everything.

Three things fell out of the split.

**The accessible description was never captured.** `ATTRIBUTE_ALLOWLIST` drops
every `aria-*` attribute on the stated grounds that they "resolve into
role/name/state". True of `aria-label`. Never true of `aria-describedby`, which
resolves into a *description* that had nowhere to land. A field whose error
message was deleted kept its role, its name, its styles and its rect, and
compared **equal** — on every tier, raster included.

**The corpus declared a band per case and nothing asserted it.** Splitting the
bands moved five cases and broke no test. That is how the hole was found: an
unchecked declaration is documentation that drifts, and the corpus's whole claim
to be able to refute the implementation rests on its declarations being
load-bearing. Both measure harnesses now score it, and the failure message
carries the delta kinds — "expected token, observed geometry" does not say which
evidence produced the answer.

**Scoring it immediately found the third.** The differ reported a list rotation
as five changed strings. Identity keys collapse to `tag:li` when a node has no
alias, no accessible name and no provenance, and pairing inside that bucket by
position is exactly the failure `reorder/list` was written to catch — and could
not, because its assertions were the verdict and the root count, both of which
are correct while the report is useless. `matchTrees` now pairs by content first
and position second, and derives `moved` from the longest run that kept its
order: a rotation of five reports two moves, a prepend reports one addition and
nothing displaced, a relabel reports one changed string.

## Inspection: the defect that was there on the first run

A comparison needs two of something. A button that never had an accessible name
compares equal to itself on every run there will ever be, and approving the first
baseline approves the defect along with it. **No product in this category can
reach that**, and it is not a tuning problem — it is what comparing two of
something means.

`judge/inspect.ts` reads one normalized snapshot. Five rules a document can
decide without guessing, each naming a component and a file, each banding `a11y`
so one policy covers inspection and comparison. Deliberately not an axe
reimplementation — five rules against roughly ninety, no live DOM, no contrast,
no focus order. What it does that axe does not: decide **offline, from a stored
artifact, months later**.

Running it against `cases/incumbent-case` found the accname bug it was written to
catch. `<button><span aria-hidden="true">↻</span></button>` was being given the
accessible name "↻", because name-from-content read `textContent` — so the
canonical icon-only button reported as *named* and the rule never fired.

The case did not notice, because it reads a prebuilt page bundle rather than
rebuilding one. That is deliberate — both arms must observe the same bytes — and
its cost is a stale bundle reporting a green head-to-head against yesterday's
implementation, which reads in a summary exactly like a case that ran and agreed.
The bundle now writes esbuild's own input list and the case refuses to run when
it is older than any of them. Verified by touching `packages/dom/dist` and
watching it stop.

**Where inspection stops, stated because it is the honest shape.** Three of the
eight incumbent scenarios are accessibility regressions no configuration of
`toHaveScreenshot` detects. Inspection reaches **one** of the three from the
broken render alone. A `<div>` with no role is not a defect in any render taken
on its own — it becomes one only against the `<button>` it replaced. Inspection
and comparison catch different things and neither contains the other.

## Locale: a message catalogue and a PNG have no key in common

There is no relation between `checkout.cta` and a region of an image, so the
category's answer to a localized UI is N times as many screenshots and a person
to look at all of them. The document has the strings *and* the boxes addressed to
the same nodes, so both questions are arithmetic.

`compareLocales` cannot reuse `matchTrees`, and a failing test is what said so.
`matchKey` keys a node on its role and accessible name, because that is the
strongest signal that two renders of one revision show the same thing — and a
translation changes exactly that. `button "Continue"` and `button "Fortfahren"`
get different keys, the differ reports a removal and an addition, and every
comparison evaporates. Right key for "later revision", wrong key for "another
language". Locale pairing is positional and stops where the shapes diverge.

**No expansion threshold.** "German is 35% longer" is a rule of thumb, and a
build that fails on a ratio is a build whose ratio gets raised until it stops
failing. Growth is measured and reported; only overflow — one rectangle outside
another — is a finding.

Measured against real Chromium layout, one panel, two languages:

```
  translated strings   16
  identical strings    2
  widest growth        2.02× at RowAction
  overflows at 420px   0
  overflows at 300px   2
```

Two predictions wrong, both corrections in the code. The first run found
**nothing**, because the rule read text nodes and the only untranslated string
was a `title` — and in a real product the strings that get forgotten are exactly
the ones that are not text nodes: an `aria-label`, a `placeholder`, an `alt`.
They render no pixel of their own, which is both why they are forgotten and why
no image comparison at any tolerance has ever reported one. And at 420px German
fits: whether a translation fits is a property of the translation **and** its
container, which is why a ratio cannot answer it and two rectangles can.

## Provenance was never React-shaped

`collect` has always taken `provenanceOf` as a callback, and there has always
been exactly one implementation. One implementation of an interface is an
implementation with a callback in front of it.

Attribution needs a renderer to supply two things: a component name per element,
and a digest of what was passed in. `packages/dom/src/attributed.ts` reads both
from two `data-*` attributes in **25 lines**. Vue's `vite-plugin-vue-inspector`
already emits an attribute of this shape; Svelte's compiler knows the component
and the file for every element. `attributed.test.ts` drives the whole chain —
diff, docket, root versus collateral — from markup with no framework in the
process, and asserts that the attributes are dropped before hashing, so adding a
build plugin invalidates no stored baseline.

Writing it found two defects, neither in the new code.

**Every plain `<section>` blew the stack.** `roleOf` asks `accessibleName`
whether a section has a name; `accessibleName` asks `roleOf` for its
name-from-content step. Mutual recursion with no base case, reachable from any
subject containing an unlabelled `<section>` — which is most of them. No fixture
had one: the corpus's only section carries an `aria-label` and returned before
reaching the recursion.

**A `prop` root named the wrong component.** The docket entry read
`prop: Panel → Button` — correct — while the per-component roles the report
actually prints marked `Button` as the root, because `componentsOf` credited the
innermost owner for every kind of root. `summarizeAdjudication` prints exactly
those names and their files, so a change caused by `Panel` sent a reviewer to
`Button.tsx`. That is the failure `prop-primary-variant/hero` exists to prevent,
committed one layer downstream of where the corpus looks.

## Scoring blame, and the two defects under it

The corpus asserted how many docket entries a change produces and never which
component each one names. A count of one is a count of one whichever name it
carries, which is how the `prop` misattribution above survived — the case written
to catch it (`prop-primary-variant/hero`) asserts a count. `CorpusCase.blames`
now declares the name the report puts in front of a reviewer, scored in both
harnesses under both profiles: which component is responsible is a fact about the
code, and a profile is a fact about the observer.

**A token aliasing another token was invisible.** `var(--ks-card-radius,
var(--va-radius-md))` is the ordinary shape of a component token with a system
fallback. `styleTokens` names the outer token, because that is what the author
wrote; when it is undefined the value comes from the fallback. The differ then
asked "did `--ks-card-radius` move?", compared `undefined` with `undefined`, and
concluded the token held — so an edit to the radius **scale** was reported as
`component:Card`, "Card changed internally", **once per consuming component**,
instead of one token root with counted collateral. That is the product's headline
claim failing on the most common design-system shape there is. The corpus case
`token-radius/card` has said "token delta ⇒ token is the root" in its `spec` line
since it was written.

Two attempts at it were reverted before the third landed, and the reverts are the
useful part. Naming the first *defined* token in the chain fixed that case and
broke `token-card-scoped/card`, where the point is that the outer token gains a
value. Treating any change of driving token as a token event fixed both and broke
claim P2 on four cases, splitting one Button variant switch into three roots. The
fix that survives is in the lookup, not the recording: when the named token held
and carries no value on either side, fall through to the one token this node
resolved through whose value moved — and refuse to answer when several did,
because a confident wrong token name is worse than a coarser true one.

**Blame for a provider-less `prop` root is ambiguous, and both corpora said so.**
`Root.cause` initially named the changed boundary even when no provider existed.
That satisfied `prop-primary-variant/hero` and broke four rows of the incumbent
case, which expects `IconButton` for the same shape. Neither is wrong: when props
arrive from outside the subject, *no component inside it is responsible*, and the
boundary's source is as unchanged as the innermost owner's. `cause` is now set
only where a provider exists inside the subject.

Which means `prop-primary-variant/hero` does not construct the case it was
written for — Hero forwards `p.props.heroPrimaryVariant` rather than deciding it.
Recorded on the case with the reason, and as an open link: **no corpus case
constructs a provider-backed prop root**, and the only thing asserting that path
is a test in `packages/dom`.

## Corrected in the documents

`docs/comparison.md` was wrong in both directions and both were fixed in place
rather than quietly rewritten:

- the integration cell still said "written against fixtures only" two sections
  above the correction;
- `README.md`'s "what does not exist yet" said there was no history, no CLI, no
  git-LFS store and no remote store, all of which had landed. The comparison had
  *recorded* that staleness and nobody had acted on it.

## What is still open

- Nothing has ever recorded a history row. Still the largest gap.
- No Vue, Svelte or Angular application has run through the attribute adapter.
  The claim is that the interface is not React-shaped, which is demonstrated.
  The claim is not that any framework works today.
- No localized application. One panel is not an application.
- The corpus scores the docket's *entry* count, not which component it blames.
  The `prop` root defect above was invisible to it for that reason, and
  `attributed.test.ts` is the only thing asserting the distinction.
