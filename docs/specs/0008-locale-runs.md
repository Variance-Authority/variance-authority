# Spec 0008 — Locale runs

**Missing:** the axis. Nothing reads a `locales` key, so a locale comparison
still means hand-writing a test.
**Built on:** the command line
([ADR-0017](../context/adr/0017-the-exit-code-is-the-interface.md)).
`compareLocales` ships in `core/judge` and is measured against real Chromium
layout.

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

**The base locale is the config's `locale`, and it is part of the environment
key.** A baseline is a render in one language, so the language joins the
environment key and the render identity: an image painted in another language is
`incomparable` against the baseline, and a snapshot diff names the locale as its
one environment root. Unlike `deviceScaleFactor`, which only the raster key
carries, the locale is in the semantic key too, because text is laid out and
another language moves the box tree. The other
locales are collector inputs. A `locales` list names the renders compared
against the base and declares no base of its own, so there is never a second
one.

**The base locale is declared, not inferred.** "The first one in the list" is a
configuration detail that silently changes every finding when someone reorders an
array, which is why the base is the singular key and not a position in the list.

**A locale render is not diffed against the base.** `diffSnapshots` would read
the pair as `changed`, with the locale as its environment root, and that is a
verdict on two renders that are both right. The question is whether they agree
about everything but their language: `compareLocales` asks it, and refuses only
a pair of two subjects.

**Findings never change the verdict**, for the same reason inspection findings do
not: a build that goes red on the day a locale is added gets the locale removed.
A project that wants them enforced writes `blocking: ['content']`.

**A locale that renders a different tree is reported, not guessed at.**
`pairByPosition` stops where shapes diverge, so a plural form with an extra
element simply leaves its strings uncompared. The run MUST say how many nodes
went uncompared rather than reporting a smaller number of findings as a cleaner
result.

`LocaleComparison.uncompared` is that — a count per side and the paths where
pairing stopped. The failure it exists to refuse is the one at the centre of this
project: a date that renders as
`<time>` in German and `<span>` in English takes its subtree out of the walk, so
the locale nobody translated comes back with *fewer* findings than the one
somebody did. The count is always present, `{ base: 0, other: 0 }` included —
zero is an answer and an absent field is not.

## Acceptance

1. **Unmet, and unmeetable without a caller.** `variance run` on a config
   declaring `locale: 'en-US'` and `locales: ['de-DE']` produces one baseline
   per subject, in `en-US`, and a `LocaleComparison` per entry of `locales`.
   `packages/cli/src/config-region.ts` parses `locale`, the base; nothing reads
   a `locales` key.
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
