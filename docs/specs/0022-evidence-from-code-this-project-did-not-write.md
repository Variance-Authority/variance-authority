# Spec 0022 — Evidence from code this project did not write

**Missing:** generality, and a false-alarm rate. One corpus, built in-house,
scored by the people who wrote the rules.
**Built on:** the corpus itself — 8 subjects, 40 declared cases, 38/38 under
`jsdom` and 39/39 under `chromium` — and the two confrontations that already
exist in [`cases/`](../../cases).

## Purpose

Both profiles agreeing on the corpus proves that the two collection paths
implement one ruleset. It does not prove the ruleset holds on somebody else's
component library, and no amount of agreement between two of our own
implementations ever will.

The measured false-**miss** rate is 0/20. The false-**alarm** rate has never been
measured at all, and one false alarm is demonstrated: reindenting JSX inside a
block element renders at 0px and still moves the structural hash. A tool whose
miss rate is known and whose alarm rate is unknown is a tool nobody can size the
review cost of.

## What would discharge it

**A component library this project did not write, scored the way the corpus is
scored** — ground truth declared before the run, per case, with its argument.

1. **A third-party library, edited deliberately.** Not a fixture shaped like one.
   The value is entirely in meeting normalization decisions nobody here made:
   CSS-in-JS generations, utility frameworks, portals, shadow roots, and the
   accretion that made 1007 rules prune to 1 in the first place.
2. **A false-alarm rate with a denominator.** N no-op refactors — reformatting,
   reordering imports, renaming a local, extracting a subcomponent — over a real
   library, counted. The reindent case says the number is not zero. Knowing what
   it is decides whether the structural hash needs a normalization step it does
   not have.
3. **A run over the `list` arm, end to end.** `route-collector` is exercised
   against pages a real server serves, by its own browser test. What has never
   happened is `variance run` reaching a verdict through that arm, the way
   [`cases/storybook-case`](../../cases/storybook-case) does for Storybook.
4. **A localized application, not a panel.** `compareLocales` is measured on one
   panel in English and German against real Chromium layout. One panel is not an
   application, and the axis that would carry it is
   [spec 0008](0008-locale-runs.md).

## The measurements that no test asserts

Three figures the documentation leads with were quoted to a decimal place and
reproducible only by hand: **1007 CSS rules → 1**, **7.5 ms warm against 205 ms
cold**, and **3.4 ms semantic against 65.4 ms for a screenshot**. Running the
three producers found that all three had drifted — to 1010 → 1, 9.0 against
233.3 ms, and 3.0 against 54.0 ms — which is what a figure quoted as a constant
does when only prose is holding it.

The pruning ratio is now asserted where it is measured
(`packages/dom/src/collect.test.ts` bounds it at 100× rather than pinning the
count). The two timing figures cannot be: both need Chromium and half a minute,
so neither belongs in a gate that has to stay fast and browserless. What was
done instead is to stop quoting them as constants — the prose carries the
**ratio**, which is machine-independent, and names the command that reproduces
it. Whatever asserts a figure should assert a **bound**; the session speedup
demonstrated why, having been recorded as 3.4×, 3.5× and a 3.1×–3.9× range in
three different places for one quantity that reads 3.2× today.

## Leaves behind

An ADR only if the ruleset has to change to survive contact. If it holds, the
evidence belongs in a case and a journal entry, and the corpus's authority stops
resting on who built it.
