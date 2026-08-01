# 0006 — M0 measured: 37/37, zero false verdicts

**Date:** 2026-08-01
**Cycle:** helix 2, move M4
**Branch:** B1 + B4 + B5 (the measurement crosses all three)

## Move

Run every corpus case through the real pipeline — `collect` → `normalize` →
`diffSnapshots` — and score the result against ground truth that was declared
before the pipeline existed.

**Expected readback:** the declared answers and the observed answers agree.
**Disconfirming readback:** a rule cannot satisfy the corpus without either
over-collapsing or over-reporting, meaning the ruleset needs redesign — which is
M0's stated exit condition.

## Result

```
M0 CORPUS MEASUREMENT
  settled cases:        37  (20 stable, 17 changed)
  contested (excluded):  3
  agreed:               37/37
  false unchanged:       0
  false changed:         0
```

Reproduce:

```bash
yarn build && yarn vitest run examples/kitchen-sink/src/measure.test.tsx
```

Against spec §10's targets: `<2% false semantic misses on no-op refactors` —
observed 0/20. The screenshot-skip target is not measurable yet; no raster stage
exists to skip.

**This is the only test in the repository whose expectations were not written
alongside the code they check.** That is what makes the number mean anything: a
ruleset scored against expectations derived from its own output scores 100% and
proves nothing. The corpus was built by a separate agent from ADR-0003 and the
spec, before the normalizer's behaviour was observable.

The first run scored **30/37**. Every one of the seven misses was a real defect,
and none was a case where the ground truth turned out to be wrong.

## The five defects it found

**1. Name from content applied to generic elements.** `accessibleName` fell back
to `textContent` for *any* element. accname does that only for roles that support
name-from-content; a `<div>` has no accessible name however much text it
contains.

The consequence was disproportionate to the mistake: every wrapper `<div>` was
handed the concatenated text of its subtree as a name, which made it non-inert to
the wrapper-collapse rule — so **no wrapper anywhere ever collapsed**. One
over-eager accname fallback silently disabled an entire normalization rule, and
took four corpus cases with it. Wrapper insertion and removal is among the most
common refactors in a React codebase, so this would have been the single largest
source of false invalidation in production.

Nothing in the collector's own 21 tests caught it, because they asserted on roles
and names directly and never asked whether collapse had happened.

**2. `@supports` was hard-coded to match.** On the belief that JSDOM lacked
`CSS.supports`. It does not — it is present and correct there, rejecting
`display: nonsense-value` and accepting `display: grid`. So a `@supports` block
guarding an unsupported value was always included, its rules applied, and a no-op
perturbation reported as a change.

Worth separating from the general over-reporting policy: over-including is the
right default for something genuinely unknowable, and the wrong answer for
something we simply had not checked. The two profiles may now answer `@supports`
differently, and that is not divergence to avoid — it is the truth being
reported, and it is why the engine is in the environment key.

**3. `display: contents` was not treated as inert.** It generates no box, so a
wrapper carrying it is inert by definition.

**4. Inheritance laundered away token attribution.** A text node inheriting a
token-driven colour produced a delta with no token and no owner chain, so it
became its own `unattributed` root. One token edit fanned out into a docket entry
per inheriting text node — destroying precisely the "one root, N collateral"
claim the token band exists to make. Attribution now rides along with inherited
values.

**5. Token attribution ignored which property it explained.** `changedTokenFor`
tagged a delta as token-collateral if *any* token on the node had moved. So a
rule that *overrode* a token-driven value got attributed to the token it had just
stopped using, splitting one root into two. A property is now collateral of a
token only when the same token drives it on both sides and that token's value
moved.

Defects 4 and 5 pull in opposite directions — one under-attributes, the other
over-attributes — and only a corpus with both token cases and cascade-override
cases could have surfaced both. Fixing either alone would have looked correct.

## What the misses had in common

Every one was a **false `changed`**, never a false `unchanged`. That is the
survivable direction and it was not luck: every ambiguous decision in the
codebase was deliberately resolved toward over-reporting. The corpus confirms the
policy worked as a safety property — and shows the price, which is that the
over-reporting has to be paid down case by case with evidence.

The measurement asserts the two categories separately rather than reporting one
pass rate, so a single number can never average a missed regression into the
merely noisy.

## Three cases remain contested

Run and reported, never scored. `dialog-open/dialog` was settled by ADR-0007
during this cycle and now observes `hash-changed` as declared, but stays flagged
until the corpus's own note is updated. The other two are genuinely open:

- **`wrapper-flex-block/wrappers`** — real `geometry` under `chromium`,
  necessarily `hash-stable` under `jsdom`. The manifest has no per-profile
  expectation field.
- **`prop-size/button`** — the band is profile-dependent. Nothing normative says
  a subject reports one band rather than a set, and a policy blocking on
  `geometry` behaves differently under each reading.

Both are the same underlying gap: **the corpus can declare one ground truth, and
some truths are per-profile.** ADR-0002 says the two profiles never share a
baseline; it does not say how a corpus expresses an expectation that differs
between them. That needs deciding before the chromium collector is scored.

## M0 exit criterion

> *normalization quality is achievable, or the ruleset needs redesign before
> anything else is built.*

**Achievable.** No rule had to be abandoned. Five were wrong and all five were
fixable within the existing structure, each with a test that fails without the
fix. The ruleset stands.

What is *not* established: this is one corpus, built by us, under one profile. It
proves the rules are coherent and that the measurement apparatus works. It does
not prove they hold on someone else's component library, and the chromium profile
has not been scored at all.
