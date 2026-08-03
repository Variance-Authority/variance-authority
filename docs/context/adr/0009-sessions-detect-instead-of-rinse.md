# ADR-0009 — Sessions detect cross-pollution instead of preventing it

**Status:** accepted
**Date:** 2026-08-01

## Context

The dominant cost in a visual-regression run is not diffing. It is **setup paid
once per subject**: a fresh JSDOM per test file, a browser launch per story, a
Storybook iframe reload between stories, the design system's stylesheet parsed
again every time. Rebuilding the world per subject costs 9.5 ms against 2.8 ms
for reusing it, and JSDOM construction is the *cheapest* member of that family.
A browser launch is three orders of magnitude worse.

That cost buys isolation. A clean world per subject makes cross-pollution
impossible by construction: no subject can see what another left behind. The
guarantee is paid on every subject, forever, to prevent a problem that occurs on
a handful of them.

## Decision

**A session does not rinse. It photographs, and detects.**

One document, one browser, one Storybook, for a whole session. Between subjects
a session clears only the subject container — the one teardown proportional to
the last subject rather than to everything.

Cross-pollution is therefore possible, and MUST be **detectable and
attributable**. It is treated as a read-write conflict on shared state:

- **Writes** come from a probe taken around each subject's mount: stylesheet
  fingerprints, root custom properties, root and body attributes, stray body
  children, title.
- **Reads** are derived from the subject's own capture: every sheet with a rule
  that *matched* (not merely one that won), every custom property it resolved
  through, its inherited seed, and its latent couplings.
- A later subject reading what an earlier one wrote is a conflict, reported with
  the writer named and the selector that connected them.

### Two tiers, and neither is redundant

| Tier | Cost | What it gives | What it cannot do |
|---|---|---|---|
| **Suspicion** — read/write overlap | ~2% of session time, always on | Names a culprit and the evidence | Over-reports: a coupling may exist and never bite |
| **Confirmation** — re-run and compare hashes | one extra run per sampled subject | Proof: same code, same subject, different hash | Says a subject is unstable, not who made it so |

Suspicion without confirmation over-reports. Confirmation without suspicion
cannot attribute. Together they produce a finding of the form:

> `story:card` is order-dependent; `story:button` wrote `sheet:<style:3>`, which
> `story:card` matched via `.card`.

The change is attributed to code; the repair is left to the agent.

### Latent coupling

A rule like `html.dark .card` contributes nothing until something puts `dark` on
`<html>`. A matched-rules-only view cannot see it, so the collector additionally
records rules whose *own* compound matches the subject while only their ancestor
portion fails. Theme leakage is therefore visible **before** it bites rather
than diagnosable after a hash moves.

### Repair is surgical

Detection's payoff is that the fix is targeted. A rinse-everything regime costs
one teardown per subject; here a confirmed leak costs one removal, and only the
affected subject re-runs.

## Consequences

- Sessions are **3.4× faster** on 30 subjects against a 302-rule stylesheet,
  with probe overhead at **~2%** of session time.
- The probe must stay cheap or the trade collapses, so the bound is asserted
  rather than assumed: a test fails if probe overhead exceeds 15% or if
  per-subject cost grows with session length.
- Sheet fingerprints memoize on `<style>` source text. Serializing `cssRules` on
  every probe costs 32%; comparing source text costs ~2%. The bound exists to
  stop that regressing.
- A session that never calls `verify()` gets suspicion only, which is honest but
  unproven. The API does not hide this: `confidence` is on every finding.

## What this forecloses

- Per-subject isolation as a default. Isolation is something a project opts into
  for a specific subject, not the regime.
- Treating a flaky hash as a retry candidate. An unstable hash is a finding with
  a named cause, not noise to paper over with a re-run.
- Any probe that reads computed style or measures layout. That would make the
  safety net cost what the setup it replaces costs, and the trade would be
  pointless.

## Amended 2026-08-04 — what "attributable" was worth

This ADR's decision line says cross-pollution "MUST be **detectable and
attributable**", and the two halves turned out to be worth very different
amounts. The correction is recorded here rather than in a new ADR, because the
decision — do not rinse — is unchanged; what changed is the claim made for it.

**Detection is cheap, general, and now shipped.** It is not the probe. A subject
whose change disappears when it is collected in a world nothing else has touched
was moved by the session, and that holds for *every* cause — including the ones
below, which no probe can see.

**Attribution is neither.** The probe's entire field of view is stylesheets,
root custom properties, root and body attributes, stray body children, and the
title. That set was chosen for cost and it is the right set for the cost, but it
is a small fraction of the ways one subject reaches another. A module-scope
store, a cached client, a memoized selector, a mocked clock, a registry
populated on import — none of them touch the DOM, and the "Known limits" below
already said so. What that section did not say is the consequence: **the tier
that names a culprit answers a narrow question, and the tier that proves one
exists answers the general one.**

Nor is there a fallback. There is no stack to consult: the write happened during
some earlier subject's render, in a frame that returned long before this
subject's comparison, and nothing in the system captures one for this purpose —
which is checkable, since no observation path in the repo reads `.stack` at all.

So the shipped path does not photograph anything. It observes an outcome and
resolves it the way this project resolves every outcome: **outcome → DOM node →
fiber → component → file**, which is machinery that already existed for
comparing against a baseline. What it hands over is a difference with a region,
a component, and a source file attached, plus the fact that a clean world does
not show it. Narrowing from there to the writer is a bisection over run order,
it is cheap once you know that is the question, and it is the agent's to do.

The probe remains correct and remains unwired. It is a *sharpener*: where the
leak does travel through a stylesheet or a custom property, it turns one
bisection into zero. It is no longer the thing the argument rests on.

## Known limits

- **Cross-origin stylesheets** fingerprint as `unreadable` and compare equal, so
  a change inside one is invisible. The alternative — treating every unreadable
  sheet as changed on every probe — would mark every subject as polluted by
  every other and make the report worthless.
- **`rinse()` only reverses sheet insertion.** Restoring attributes and custom
  properties would require retaining every prior value, which makes the probe
  grow with the session — the one thing it must not do.
- **Module-level state** (a singleton store, a cached client) is outside the DOM
  and outside the probe entirely. A session cannot see it. Confirmation catches
  the symptom; attribution reports no culprit, which is at least the correct
  answer rather than a wrong one.
