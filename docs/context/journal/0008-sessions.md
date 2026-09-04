# 0008 — Sessions: 3.4× by not rinsing, and what that let through

**Date:** 2026-08-01
**Cycle:** helix 3, move M6
**Branch:** B7 (session)

## Move

Stop rebuilding the world between subjects. Detect the cross-pollution that
allows, attribute it to a subject and a selector, and prove the trade pays.

**Expected readback:** a session is materially cheaper, and real leakage is caught
and named.
**Disconfirming readback:** detection costs as much as the isolation it replaces,
or it cannot name a culprit — in which case rinsing is simply correct.

## Result: expected

```
SESSION COST (30 subjects, 302 CSS rules)
  rebuild per subject: 286ms  (9.5ms each)
  one session:          83ms  (2.8ms each)
  speedup:             3.4×
  probe overhead:      1.9% of session time
```

```bash
yarn measure
```

JSDOM construction is the *cheapest* member of the family this stands in for. A
browser launch or a Storybook reload is three orders of magnitude worse, and the
shape is identical: paid once per subject, and avoidable.

24 tests in the package, split deliberately in half. One half asserts the saving
is real — accumulation must be free, or a no-rinse session is unusable noise. The
other asserts the risk is caught. **A detector that only passes the first half is
a detector that has been turned off; one that only passes the second is a rinse
in disguise.**

## The probe had to get 16× cheaper before the trade was worth it

First implementation: 31.7% of session time. It fingerprinted each stylesheet by
serializing every `cssRules` entry — so a design system's sheet was re-serialized
a few hundred times per session to conclude, every time, that nothing had changed.

A `<style>` element's `textContent` *is* its source, so comparing that string
answers the same question in one pass, usually in O(1) because it is the same
reference. That took it to **1.9%**.

Recorded because the first number was nearly a wrong decision, not just a slow
one: at 32% overhead the honest conclusion is that rinsing is fine. The trade only
became worth making after the safety net got cheap, and the bound is now a test
so it cannot regress back across that line.

## A hole this opened up that had nothing to do with sessions

Writing a test for *"a subject reads a custom property another subject
overwrote"* failed, and the reason was not in the session package.

**Under JSDOM, `:root` design tokens never reached any subject at all.** Tokens
are declared on `:root`; `:root` is outside every subject's subtree; applicability
pruning correctly drops the rule that defines them; and `inheritedSeed` returned
`{}` whenever the profile had no computed style. So `var(--brand)` resolved to
nothing, and every token-driven value in a JSDOM snapshot was empty.

The token dimension — the thing the `token` band exists for, the thing "1 token
change, 300 collateral" is about — was **inert on the cheap tier**, and the M0
measurement scored 37/37 without noticing, because the corpus applies its
overrides as *inline* custom properties on the subject root. A real project
declares them on `:root` and would have found the band dead.

Fixed by resolving the ancestor cascade by hand for declared-only profiles:
walk `documentElement → … → root.parentElement`, matching rules and running
`core`'s own `resolveStyle` at each step. Using the same resolver matters — a
bespoke one here would be a second ruleset that could drift from the one
consuming its output, which is the ADR-0001 property applied one level up.

The corpus still scores 37/37 after the change, so nothing regressed. But the
lesson is about the corpus, not the code: **a fixture that is convenient in the
same way the implementation is convenient tests nothing.** Inline overrides were
chosen to make the fixture simple, and they happened to route around the exact
gap they should have exposed.

## Latent coupling

`html.dark .card` contributes nothing today and everything the moment something
puts `dark` on `<html>`. A matched-rules view cannot see it — the rule does not
match, so it is not in the capture.

The collector now records a coupling when a rule's *own* compound matches the
subject while only its ancestor portion fails. That is what makes the theme-leak
test work, and it is the difference between reporting a leak before it bites and
explaining a hash that already moved.

Deliberately narrow: only `html`/`:root`/`body` anchors carrying a class or
attribute qualifier. A rule failing because it needs a different parent component
is ordinary CSS, and reporting it would bury the leaks that matter under every
descendant selector in the stylesheet.

## Cases the tests cover, and why each earns its place

Benign, must stay silent:
- 50 generations of accreted CSS-in-JS — the economic case
- a sheet nothing in the subject matches
- a component injecting its own stylesheet (writes and reads the same key — that
  is how CSS-in-JS works, not pollution)
- a write that happened *after* the subject ran (pollution is directional)

Real, must be caught and named:
- a leaked rule reaching a later subject, with the selector in the evidence
- order-dependence confirmed by re-running and comparing hashes
- a theme class left on `<html>`
- a root custom property overwritten by another subject
- a stray node left in `<body>`
- **a subject unstable on its own, reported with no culprit** — conflating
  non-determinism with pollution would send an agent hunting a leak that does not
  exist

Detector mechanics:
- a rule rewritten *in place* (rule count unchanged — a count-based fingerprint
  misses exactly what a CSS-in-JS theme switch does)
- sheet removal counts as a write
- a rule that matched but *lost* the cascade still counts as a read, because it is
  one specificity bump from winning
- `.card.dark` does not couple to root state; `html.dark .card` does

## Honest limits

- **Module-level state is invisible.** A singleton store or cached client is
  outside the DOM and outside the probe. Confirmation catches the symptom;
  attribution reports no culprit — the correct answer rather than a wrong one.
- **`rinse()` only reverses sheet insertion.** Restoring attributes and custom
  properties needs every prior value retained, which makes the probe grow with the
  session. That is the one thing it must not do.
- **Cross-origin sheets fingerprint as `unreadable`** and compare equal.
- **Suspicion over-reports by design.** A session that never calls `verify()` has
  couplings, not proof, and `confidence` says so on every finding.

## Verification

```bash
yarn build && yarn test
```

289/289 pass. Corpus measurement unchanged at 37/37, 0 false verdicts, after the
ancestor-seed and latent-coupling changes to the collector.
