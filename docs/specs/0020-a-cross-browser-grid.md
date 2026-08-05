# Spec 0020 — A cross-browser grid

**Missing:** the corpus run twice, and any stabilization trick verified outside
Chromium. `browser` selects an engine; nothing runs more than one.
**Built on:** the `browser` config field, and
[`packages/playwright/src/engines.chromium.test.ts`](../../packages/playwright/src/engines.chromium.test.ts),
where all three engines paint one document at identical dimensions.

## Purpose

A selectable engine is not a grid, and the difference is not a missing loop.
Selecting an engine is safe by construction: the engine is part of the identity a
baseline is stored under, so a run under a new engine finds nothing under its key
and reports every subject `new` — loudly — instead of diffing two engines and
blaming a component for a font stack.

A grid is a different question. It asks whether the normalization ruleset holds
where it has never been measured, and the honest state is that every intervention
in the `prepare` set was written, tuned and verified against Chromium. Three
engines painting one document at identical dimensions is encouraging and is one
document.

## What would discharge it

**The corpus, under each engine, scored the way Chromium was scored.** 39/39
under `chromium` is the number to beat, and the interesting outcome is not
matching it — it is finding which rules are Chromium-shaped.

1. **Score `firefox` and `webkit` against the same declared ground truth.** A
   case the corpus declares as changed must be reported changed under every
   engine that can observe the band. Divergence is a finding, not a failure, and
   [ADR-0008](../context/adr/0008-per-profile-expectations.md) already has the
   vocabulary for declaring one.
2. **Verify each `prepare` trick per engine.** Each declares the cheapest tier
   that can observe its effect; none declares which engines it was tested on.
   The `text-smoothing` probe is the worked example of why that matters — it
   perturbs `-webkit-font-smoothing`, which only macOS implements, so it moves
   177 pixels on one machine and 0 on another while looking identical in the
   recipe.
3. **Decide what a grid costs the operator.** Two engines are two identities, so
   two sets of baselines and two approvals. Whether that is one run with N
   renderers or N runs is a workflow question, and the answer determines whether
   `browser` stays one word.

## What is out of scope

No Edge, no mobile, no real devices. Those are a device farm, which is a supplier
relationship rather than a feature, and pretending otherwise is how a config
field becomes a promise.

## Leaves behind

An ADR on whether the environment key is per-engine or per-grid, and on what a
run reports when one engine in a set cannot observe a band the others can. Both
are extensions of ADR-0002's refusal discipline into an axis it does not
currently model.
