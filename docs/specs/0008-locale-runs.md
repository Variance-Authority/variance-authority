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

## Acceptance

1. `variance run` on a config declaring `locales: ['en', 'de']` produces one
   baseline per subject and a `LocaleComparison` per non-base locale.
2. An untranslated string in a real application is named, with its component and
   its file.
3. Storage for a two-locale run is within 5% of a one-locale run — the property
   the whole design rests on.
4. A run whose subject tree differs between locales reports the uncompared count
   rather than silently narrowing.

## Not in scope

Joining against the message catalogue itself. `untranslated` currently reports
*candidates* — a brand name and a product code are both "identical in both
languages" — and making it exact means reading the ids rather than the values.
That is a second spec and needs a format decided first.
