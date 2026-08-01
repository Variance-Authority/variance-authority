# 0005 — The collector: ADR-0003's headline claim, tested

**Date:** 2026-08-01
**Cycle:** helix 2, move M3
**Branch:** B4 (dual-surface)

## Move

Build the collector — one implementation for both observation profiles — and
with it CSS applicability pruning, the step that cannot live in `core` because
deciding whether a rule applies requires asking a live DOM.

**Expected readback:** accreted, unrelated CSS leaves the hash unchanged.
**Disconfirming readback:** pruning cannot be made engine-independent, so the two
profiles need different rules.

## Result: expected

The claim ADR-0003 was written for, and which journal 0004 explicitly recorded as
*unproven*:

> a Storybook canvas carries Storybook's chrome CSS, the preview reset, the whole
> design system, and a CSS-in-JS `<style>` accreting a rule for every story
> rendered since page load — and none of it may invalidate a baseline.

Now tested. Growing the irrelevant stylesheet from 5 to 500 accreted generations
leaves the render hash byte-identical, while a one-character edit to a rule that
*does* apply moves it.

**Measured pruning**, on a page carrying Storybook chrome, a preview reset, dead
utility classes, and 500 generations of CSS-in-JS accretion against a
single-button subject:

```
total rules parsed: 1007
rules reaching core:   1
pruned:            99.90%
```

Reproduce by rendering the fixture in
`packages/collector-dom/src/collect.test.ts` and comparing `StyleIndex.totalRules`
against the summed `matchedRules` of the capture.

That ratio is the whole economic argument in one number. The expensive stages run
on what survives, and on a realistic page almost nothing survives.

## Two things I had wrong

**Whitespace-only text nodes were being dropped as "just formatting".** They are
not. `<span>a</span> <span>b</span>` renders "a b"; without the text node it
renders "ab". Dropping it is a *false `unchanged`* for a visible text change —
the exact failure the whole profile system exists to prevent, committed by me in
a place I had labelled an optimization.

They are now kept, and `core` collapses whitespace runs to a single space without
trimming. Not trimming is the part that matters: a boundary space between inline
elements is rendered, and trimming would merge them. This over-reports in a block
formatting context, where leading and trailing whitespace collapses away — and
telling the two contexts apart needs a layout engine the declared-only profile
does not have. So the tier over-reports, deliberately, and a test says so by name
rather than asserting the convenient thing.

The cost is small in practice because subjects are React-rendered, and JSX
already strips whitespace-only lines and newline-adjacent indentation at compile
time. Hand-written HTML pays more.

**The first test I wrote for this asserted something false.** It compared
`<p><span>a</span><span>b</span></p>` against an indented version and expected
equality — but the indented version also has leading and trailing whitespace
nodes, so the two are not the same tree. The test now varies only the *amount* of
interior whitespace, which is the claim actually being made.

## Engine divergence, and why one collector

JSDOM's CSS object model comes from `cssom`, whose `CSSRuleList` and
`CSSStyleDeclaration` are bare array-likes: `length` and index access, no `item`
method. Browsers have retrofitted both `item()` and `Symbol.iterator` onto these
interfaces; JSDOM has neither consistently. So `for...of` over them works in
Chromium and throws in JSDOM.

Every such access now goes through `dom-list.ts`, which prefers `item()` and
falls back to bracket access. This is not defensive padding — neither form alone
works on both engines, and this is the one component whose entire purpose is to
behave identically on both.

**`window.matchMedia` is deliberately not used.** JSDOM stubs it to always return
`false`, which would drop every `@media` rule and silently snapshot the wrong
breakpoint. Conditions are evaluated in `media.ts` against the *declared*
environment instead, so both profiles resolve them the same way and the answer
does not depend on the host. A test asserts the rule is applied, which would fail
if `matchMedia` were consulted.

Everything ambiguous resolves toward over-reporting, consistently: an unparseable
selector counts as matching, an unknown media feature counts as matching, a
`@supports` block always counts as matching (`CSS.supports` is unreliable in
JSDOM and would diverge), and a selector whose rightmost compound cannot be
bucketed goes in the universal bucket where it is tested against everything.
Over-including costs a review nobody needed; excluding drops a declaration from
the hash.

## Honest limits

**ARIA is partial**, and `aria.ts` says so at the top. Full accname is a
specification in its own right. The bounded consequence: a role or name that
fails to compute becomes *absent*, and an absent role is a weaker match key in
the differ — so the failure mode is a coarser diff and a worse docket label, not
a wrong verdict. A role computed *incorrectly* would be worse, so every mapping
implemented is one where the spec is unambiguous, and ambiguous cases yield
nothing. `<header>`/`<footer>` check for a sectioning ancestor; `<section>` is
only a `region` once it has a name; `<a>` without `href` stays generic rather
than being normalized into a link.

**Font content is not verifiable from inside a page.** The collector can observe
that `Inter` is in use but not *which* Inter, and a font substitution changes
metrics — and therefore geometry — without changing a line of code. `fonts` is a
required-in-spirit caller input, and omitting it emits an `unverified-fonts`
diagnostic rather than a confident-looking default. This is spec §11.1's
environment-key completeness question, answered for one input by refusing to fake
it.

**`inheritedSeed` is empty under a profile without computed style.** There is no
way to read an ancestor's resolved values without an engine, so the declared-only
tier is correspondingly weaker. Reported by the profile rather than papered over.

## Verification

```bash
yarn build && yarn test
```

`tsc --build` clean. 134/134 pass: 90 in `core`, 23 in `provenance-react`, 21 in
`collector-dom`.
