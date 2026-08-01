# ADR-0009 — Sessions detect cross-pollution instead of preventing it

**Status:** accepted
**Date:** 2026-08-01
**Origin:** direct steer —

> *"Think how we can 'save money', like do not expect rinse between jest tests and
> keep PW/Storybook running. This solution should be faster and more affordable.
> That means it should be cutting corners AND provide a possibility for agent to
> spot 'cross polution', attribute to code and fix."*

## Context

The dominant cost in a visual-regression run is not diffing. It is **setup paid
once per subject**: a fresh JSDOM per test file, a browser launch per story, a
Storybook iframe reload between stories, the design system's stylesheet parsed
again every time. Measured here, rebuilding the world per subject costs 9.5 ms
against 2.8 ms for reusing it — and JSDOM construction is the *cheapest* member
of that family. A browser launch is three orders of magnitude worse.

The reason everyone pays it anyway is isolation. A clean world per subject makes
cross-pollution impossible by construction: no subject can see what another left
behind.

That guarantee is bought at a price nobody prices. It is paid on every subject,
forever, to prevent a problem that occurs on a handful of them.

## Decision

**Do not rinse. Photograph, and detect.**

One document, one browser, one Storybook, for a whole session. Between subjects
the session clears only the subject container — the one teardown proportional to
the last subject rather than to everything.

Cross-pollution then becomes possible, so it is made **detectable and
attributable** by treating it as a read-write conflict on shared state:

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
cannot attribute. Together they produce the sentence the steer asked for:

> `story:card` is order-dependent; `story:button` wrote `sheet:<style:3>`, which
> `story:card` matched via `.card`.

Which is *"we do change → code attribution"*, with the fix left to the agent.

### Latent coupling

A rule like `html.dark .card` contributes nothing today and everything the moment
something puts `dark` on `<html>`. A matched-rules-only view cannot see it, so
the collector additionally records rules whose *own* compound matches the subject
while only their ancestor portion fails. That makes theme leakage visible
**before** it bites rather than diagnosable after a hash mysteriously moves.

### Repair is surgical

Detection's payoff is that the fix is targeted. A rinse-everything regime costs
one teardown per subject; here a confirmed leak costs one removal, and only the
affected subject re-runs.

## Consequences

- Measured: **3.4× faster** on 30 subjects against a 302-rule stylesheet, with
  probe overhead at **~2%** of session time.
- The probe must stay cheap or the trade collapses, so it is asserted, not
  assumed — a test fails if probe overhead exceeds 15% or if per-subject cost
  grows with session length.
- Sheet fingerprints memoize on `<style>` source text. Serializing `cssRules` on
  every probe cost 32%; comparing source text costs ~2%. The bound exists to stop
  that regressing.
- A session that never calls `verify()` gets suspicion only, which is honest but
  unproven. The API does not hide this: `confidence` is on every finding.

## Known blind spots

- **Cross-origin stylesheets** fingerprint as `unreadable` and compare equal, so a
  change inside one is invisible. The alternative — treating every unreadable
  sheet as changed on every probe — would mark every subject as polluted by every
  other and make the report worthless.
- **`rinse()` only reverses sheet insertion.** Restoring attributes and custom
  properties would require retaining every prior value, which makes the probe
  grow with the session — the one thing it must not do.
- **Module-level state** (a singleton store, a cached client) is outside the DOM
  and outside the probe entirely. A session cannot see it. Confirmation catches
  the symptom; attribution will report no culprit, which is at least the correct
  answer rather than a wrong one.

## What this forecloses

- Per-subject isolation as a default. Isolation is now something a project opts
  into for a specific subject, not the regime.
- Treating a flaky hash as a retry candidate. In this design an unstable hash is
  a finding with a named cause, not noise to paper over with a re-run.
- Any probe that reads computed style or measures layout. That would make the
  safety net cost what the setup it replaces costs, and the trade would be
  pointless.
