# ADR-0012 — Observability is bought, and the price is bounded and recorded

**Status:** accepted
**Date:** 2026-08-02
**Extends:** ADR-0010 (tier-specific environment keys), ADR-0011 (retention)

## Context

A subject that is still changing cannot be compared. Every visual-regression
system therefore intervenes: it pauses animations, waits for fonts and images,
hides carets and scrollbars, and in some designs replaces runtime primitives —
wrapping `Promise`, substituting the framework's suspense boundary — in order to
know when work has finished.

None of this is optional. A system that refuses to intervene observes subjects
mid-flight and reports differences nobody caused. The question is not whether to
pay, but what is paid with, and whether the payment is visible afterwards.

Two costs are distinct and are routinely conflated.

**The gap.** Every intervention widens the distance between what was measured
and what a person will see. An image of a page whose animations are frozen is
not an image of the product.

**Test-induced design damage.** An intervention that requires the product to
change — an attribute a component must attach, a hook it must expose, a
primitive it must not use — is carried by the product forever, including by the
people who never run the tool.

A third failure follows from the first and is worse than either: if two runs
intervene *differently*, their images differ for a reason that is not the code.
The comparison is then a false positive with a confident explanation, because
attribution will name whichever component happens to sit under the pixels.

## Decision

**Interventions are enumerable, applied from outside wherever possible, scoped
to the tier that needs them, and folded into the identity of what they produced.**

### 1. Interventions are a value, not a behaviour

The applied set is an explicit record — animations, caret, scrollbars, fonts,
images — rather than a collection of flags checked at call sites. A set can be
digested, reported, and compared; a scattering of conditionals cannot.

### 2. Applied from outside the subject, unless the outside cannot know

Ordered by increasing cost, and the earliest sufficient option MUST be taken:

| Mechanism | Design damage | Notes |
|---|---|---|
| Injected CSS, browser configuration | none | Nothing in the product imports it; removing the tool removes the intervention |
| Runtime substitution — patching `Promise`, replacing a suspense boundary | none, but | Moves the damage from design into semantics: the subject runs on primitives the product does not use, and a difference caused by the patch is indistinguishable from a difference caused by the code |
| A contract the subject implements — a readiness marker | real, small | Reserved for what the outside genuinely cannot determine |

Whether a component has finished its own asynchronous work is the honest case
for the third row: no observer outside it can tell. It is therefore opt-in, and
a project that declines gets weaker evidence and is told so.

Runtime substitution is available to implementations and is not used here. The
knowledge it buys is real; the failure it introduces is undiagnosable.

### 3. Scoped to the tier that needs the answer

An intervention is applied only by a tier that can observe what it fixes.

| Tier | Applied | Because |
|---|---|---|
| structure + declared style | nothing | An unloaded font cannot change which rules match or what they declare; an undecoded image cannot either |
| layout | animations, scrollbars, fonts, images | All four change metrics, intrinsic sizes, or resolved values |
| raster | the above, plus caret | A caret paints and does not lay out |

The cheap tier paying for the expensive tier's stabilisation is not a small
waste. Asset waits are per subject and they land on the rung the tier ladder
exists to make cheap.

### 4. Recorded in the identity

The digest of the applied set is part of `RenderIdentity`. A baseline stabilised
one way and a run stabilised another are `incomparable` — never `changed` — by
the same mechanism that refuses a cross-machine comparison (ADR-0011).

Absence of the field means the renderer did not record what it did, which is not
the same claim as "it did nothing", and two such renderers will compare. That
hazard is the argument for every renderer setting it.

### 5. The gap stays visible

The applied set is reportable as a sentence, so a reader is never left to assume
an image is the product when animations were frozen to obtain it.

## Consequences

- Adding an intervention without adding it to the set is a defect: it changes
  images while leaving the identity that addresses them unchanged, which is the
  silent false positive this ADR exists to prevent.
- A project may decline the one contract that requires a change to the product,
  and gets a weaker readiness signal that names itself as weaker.
- Two teams stabilising differently cannot share baselines. That is correct and
  is stated rather than discovered.

## What this forecloses

- A hidden intervention. Anything done to the page is in the set or is a bug.
- Requiring the product to change for anything the outside can determine.
- Uniform stabilisation across tiers, which would charge the cheap tier for the
  expensive tier's needs.

## Known limits

- Pausing animations pins them at their first frame. A component whose settled
  appearance is its *final* frame is therefore captured in a state a user never
  sees. Holding the last frame instead is not expressible in CSS alone.
- Hiding scrollbars removes their width, so a layout that reflows around a
  scrollbar is measured without one. The alternative — keeping them — imports a
  platform and preference difference into every comparison.
- The set describes what was *requested*. A page that overrides the injected
  rules with higher specificity is not detected.
