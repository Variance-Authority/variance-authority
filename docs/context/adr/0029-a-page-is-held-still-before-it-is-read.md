# ADR-0029 — a page is held still before it is *read*, not only before it is painted

**Status:** accepted
**Date:** 2026-08-06
**Extends:** ADR-0001 (core holds no DOM), ADR-0003 (normalization and the allowlist), ADR-0011 (environment keys partition baselines)

## Context

The computed-style allowlist excludes `animation-*` and `transition-*`, and
[`ruleset.ts`](../../../packages/core/src/rules/ruleset.ts) gives the reason:

> snapshots are taken at a declared settle point with animation disabled, so
> these describe a journey the snapshot does not contain

Nothing disabled it. `holdAnimations` is a *screenshot option* — `animations:
'disabled'`, handed to Playwright at the moment it takes a picture — and the
cheap tier takes no picture. It acquires a document and collects a capture from a
live page, straight into `getComputedStyle`.

So the premise was false in the one direction that costs correctness.
`transform`, `opacity`, `filter`, `color` and every geometric longhand *are*
admitted. A subject read 120ms into a 300ms fade produced a snapshot of a frame
nobody would recognise, and the next run, read at 180ms, reported a change —
with a component name and a source file attached, on a commit where nobody
edited anything.

That is worse than an unexplained pixel diff, and the difference is the whole
argument of this project turned against itself. A reviewer reads *`Card` moved at
`opacity`*, with the file and line that rendered it, and goes looking for the
edit. Attribution makes a false alarm credible.

[`flakiness.md`](../../flakiness.md) had this row filed under **absorbed by
nothing** and noted it was "the one of the five a reader is most likely to hit on
their first run". It was right, and it sat there for three days as a confession
rather than a bug — which is the failure mode
[limitations are bugs or positions](../../../README.md) exists to prevent.

## Decision

**A collection recipe is applied to the live page before the subject is read,
by default, and its identity is part of the environment key.**

Three parts, and the third is what makes the first two safe.

### 1. The recipe that runs at collection is not the one that runs at render

`COLLECT_RECIPE` is `pin-animations`, `hide-scrollbars`, `wait-for-fonts`,
`wait-for-images`. `LAYOUT_RECIPE` and `RASTER_RECIPE` keep `hold-animations`.
The two differ in exactly one trick and the difference is not a preference:
`hold-animations` contributes a *screenshot option*, so in a stage where nobody
takes a screenshot it is a trick that silently does nothing. The CSS variant is
the one that works where there is no camera.

Both remain separate values in one open registry rather than one switch with two
behaviours, because they produce different states — a browser settling animations
fast-forwards a finite one to where a user comes to rest, and CSS pinning holds it
at its first frame — and choosing between them is the caller's.

Filtered by tier, so jsdom applies nothing: no layout engine, no animation clock,
and a `fonts.ready` wait per subject on the rung that exists to be cheap.

### 2. The damage is one marked sheet, and the collector skips it

One `<style data-va-stabilize>`, rewritten rather than appended so a session
running thirty subjects through one document does not accumulate thirty of them,
and skipped by `indexStyleSheets`.

The skip is not tidiness. The recipe's rules are `*, *::before, *::after` by
construction, so collecting them would attach a matched rule to every node in
every subject, churn every hash, and put a declaration nobody wrote into the
attribution of a component that did not write it. Skipping it is what makes the
intervention *outside the subject* damage in the sense the vocabulary already
claims: delete the module and the intervention is gone, with nothing left behind
in anybody's baseline.

What survives into the capture is the recipe's **effect** — `transform` reads its
first frame instead of a frame off the clock. That is the point.

### 3. `EnvironmentInputs.stabilization`

The recipe digest is a render input, in `shared`, so it reaches the semantic key
as well as the full one.

Without it, a baseline collected untouched and a run collected held still are one
baseline, and every animated node in the subject disagrees. The report for that
is a change, with a component and a file — the same credible-false-alarm failure,
arriving on the day somebody turns the recipe off. With it, the two are different
baselines and never meet.

Absent rather than an empty-recipe digest when nothing was applied. *Observed
untouched* is a real state, and `undefined` is omitted from the canonical form,
so it hashes as the absence it is.

## Consequences

**The vocabulary moved from `@variance-authority/raster` to
`@variance-authority/core/format`.** Holding a page still looked like something
you do before photographing it; it is a render input on every tier, and it now
lives beside the key it is part of. `raster` keeps the plan that names a recipe.

**`core` gained a settle closure that reads a document, and did not gain
`lib.dom`.** A settle step never runs in `core` — it is handed to
`SettleTarget.evaluate`, which ships it into a page. What it may touch is
enumerated in one `PageGlobals` declaration, which is stricter than the ambient
`window` it replaced: a trick that wants more of the DOM has to widen it in
public.

**A page agent's `acquire` became asynchronous**, and `PageAgent.capture` may now
return a promise. Fonts have to land and two frames have to pass before a pinned
animation has come to rest, so a bundle that could only answer synchronously is
one that reads a page mid-flight.

**Every baseline in every repository using this is invalidated**, by the new
environment field. That is spec §7.3's mass-invalidation event and it is the
correct one: the old baselines were taken at an arbitrary frame.

**The category does not do this.** Argos stabilizes a dozen mechanical concerns
and relies on Playwright's `animations: 'disabled'` for animation — a screenshot
option, so their semantic layer would have the same hole if they had one; Percy
freezes animations server-side, at render. Nobody holds a page still before
*reading* it, because nobody else reads one. Nor does anyone record which
stabilizers ran in the identity of what they produced, which is the part that
makes turning one off safe rather than silently wrong.

## What this does not close

`pin-animations` pins at the **first frame**, which is where a fade-in is
invisible. That is deterministic and it is not where a user sees the component,
and the trick says so in its own `because` string. A recipe wanting the resting
state needs a trick that fast-forwards, which CSS cannot express — so on the
cheap tier it would have to be a runtime substitution, the tier of damage this
project declines to ship and leaves expressible.

JavaScript-driven animation — `requestAnimationFrame` writing inline styles, or
the Web Animations API — is untouched by CSS and reaches the representation
exactly as before. Percy disables JS entirely on re-render, which it can afford
because it re-renders from a serialized DOM; here the page is the adopter's own
and disabling their JS would be disabling the subject.

Neither is measured. What is measured is
[`stabilization.chromium.test.ts`](../../../packages/route-collector/src/stabilization.chromium.test.ts):
one page with a 4s linear infinite animation, read twice about a second apart
through the real collector, on a real compositor. Untouched, the render hash
moves; under the default recipe it holds; the environment records which of the
two happened; and the injected sheet appears nowhere in the subject. The first of
those four is asserted as a *failure to reproduce* — if the flake ever stops
reproducing, the suite goes red rather than quietly guarding nothing.
