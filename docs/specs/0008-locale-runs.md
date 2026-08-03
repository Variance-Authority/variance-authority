# Spec 0008 — Locale runs

**Status:** `built, not wired` — see [the status vocabulary](README.md#status-vocabulary)
**Depends on:** [0003](0003-cli.md)

## Purpose

`compareLocales` answers the two questions a localized UI raises — which string
was not translated, and which box stopped fitting — and nothing calls it from a
run. Today a locale comparison requires writing a test that captures the same
subject twice and passes both snapshots in by hand, which is exactly the shape
`variance run` exists to remove.

The capability is measured (`packages/core/src/judge/locale.test.ts`, and
`cases/incumbent-case/src/locale.chromium.test.ts` against real Chromium
layout). What is missing is the axis: a run that knows it has locales.

## Contract

A subject observed at N locales is **one** subject with N renders, not N
subjects. The distinction is the whole design:

- N subjects means N baselines, N review items, and storage multiplying by the
  number of languages — which is what the category already does and what the
  document representation exists to avoid.
- One subject with N renders means **one** baseline, in the base locale, plus
  N−1 comparisons that are not baseline comparisons at all.

A locale render is never compared against a stored baseline. It is compared
against the base-locale render *of the same run*, so the machine cancels out by
construction and no locale ever needs an approval of its own.

## Behaviour

**The locale is a collector input, not an environment key field.** Two locales of
one subject are meant to be compared, and `diffSnapshots` refuses to compare
across environment keys — correctly, because that refusal is what stops a
`deviceScaleFactor` mismatch reading as a regression. A locale is a property of
what was rendered, not of the machine that rendered it.

**The base locale is declared, not inferred.** "The first one in the list" is a
configuration detail that silently changes every finding when someone reorders an
array.

**Findings never change the verdict**, for the same reason inspection findings do
not: a build that goes red on the day a locale is added gets the locale removed.
A project that wants them enforced writes `blocking: ['content']`.

**A locale that renders a different tree is reported, not guessed at.**
`pairByPosition` stops where shapes diverge, so a plural form with an extra
element simply leaves its strings uncompared. The run MUST say how many nodes
went uncompared rather than reporting a smaller number of findings as a cleaner
result.

`LocaleComparison.uncompared` is that, added on 2026-08-03 — a count per side and
the paths where pairing stopped. **This paragraph was a MUST with nothing behind
it for the whole of B15**, in a capability marked as built, and the failure it
describes is the one this project exists to refuse: a date that renders as
`<time>` in German and `<span>` in English takes its subtree out of the walk, so
the locale nobody translated comes back with *fewer* findings than the one
somebody did. The count is always present, `{ base: 0, other: 0 }` included —
zero is an answer and an absent field is not.

## Acceptance

1. **Unmet, and unmeetable without a caller.** `variance run` on a config
   declaring `locales: ['en', 'de']` produces one baseline per subject and a
   `LocaleComparison` per non-base locale. Nothing reads a `locales` key; the
   word does not appear in `packages/cli/src/config.ts`.
2. **Met, against a render this project did not lay out.**
   `cases/incumbent-case/src/locale.chromium.test.ts` — "names the string nobody
   translated, including the one that is not text" — in real Chromium, with the
   component attached. Still ours to the extent that we wrote the panel.
3. **Unmet.** Storage for a two-locale run is within 5% of a one-locale run — the
   property the whole design rests on, and one only a real run can measure.
4. **Met.** `packages/core/src/judge/locale.test.ts`, "what was not compared" —
   four cases covering a matched tree, a tag change, a longer child list, and two
   roots that disagree. Each asserts the count *and* the findings, because either
   alone passes for an implementation that narrows silently.

## Not in scope

Joining against the message catalogue itself. `untranslated` currently reports
*candidates* — a brand name and a product code are both "identical in both
languages" — and making it exact means reading the ids rather than the values.
That is a second spec and needs a format decided first.
