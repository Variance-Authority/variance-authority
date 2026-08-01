# 0003 — The kitchen-sink corpus: manufacturing the noise we intend to delete

**Date:** 2026-08-01
**Cycle:** helix 1
**Branch:** B3 — corpus

## What was asked

Build `examples/kitchen-sink`: a React component library plus a variant system that
renders the same components under deliberate perturbations, each labelled in advance
with its expected effect on the render hash. Produce the cruft ADR-0003 exists to
remove, rather than hoping to find it.

## Why a corpus and not two real libraries

Spec §10 says M0 measures the normalizer "on 2 real component libraries". Real
libraries give real markup and no ground truth. Nobody can say, of an arbitrary pair
of renders from someone else's design system, whether the hash *should* have moved —
so any pass rate computed over them is the normalizer graded against its own output,
and it will score whatever we want it to score.

The missing half is a set of render pairs whose correct answer was fixed before the
normalizer existed. That is `src/corpus.ts`. It contains no hashes: hashes are the
thing being measured. Each row says only whether two renders should agree, which
band the change belongs in if they should not, and — at length — *why*. The rationale
is the part that matters. A reader who thinks a case is wrong needs something to
argue with; a table of assertions offers nothing to dispute and therefore proves
nothing.

Real libraries are still worth running. They answer a different question (does this
survive contact with markup we did not write?) and they cannot answer this one.

## Shape

Eight subjects, thirty variants, forty declared cases: twenty `hash-stable`, twenty
`hash-changed` (11 `geometry`, 9 `token`).

The 20/20 split is deliberate and load-bearing. A corpus of stability cases alone is
passed perfectly by a normalizer that returns a constant; a corpus of change cases
alone is passed by one that hashes raw bytes. Several pairs are built so that the two
members differ by one property and nothing else, so that neither leniency nor
aggression can take both:

| stable case | changed case | difference |
|---|---|---|
| `css-losing-rules/card` | `css-winning-rules/card` | selector specificity only |
| `css-unmatched-media/card` | `css-matched-media/card` | whether the condition holds |
| `id-shift/field` | `break-association/field` | whether a reference still resolves |
| `wrapper-flex-contents/wrappers` | `wrapper-flex-block/wrappers` | one `display` declaration |
| `token-radius/card` | `token-card-scoped/card` | which token name resolved the value |

The last pair changes no verdict — both are `hash-changed`/`token` with the same
resolved delta — and exists only to check that the snapshot records the token *name*
and not just the value. Without the name, "the radius scale moved, 300 subjects
affected" and "this Card overrides its radius" are the same diff, and the docket
sentence the product sells cannot be written.

### The cruft generators

Everything in `src/cruft/` manufactures a specific failure mode:

- **`id-shift.tsx`** advances React's global `useId` counter by mounting throwaway
  components in a detached root. Not a simulation — this is the actual mechanism, and
  the counter never resets, so ids also differ between two runs of the same test file.
- **`css-runtime.ts`** is ~40 lines of CSS-in-JS: hashed class names, a single
  accreting `<style>`, and a `salt` input so the names churn on command. A real
  library was rejected because the perturbation we need — "names moved, declarations
  did not" — is produced there by *unrelated* edits, which a test cannot request and
  cannot reproduce across library versions.
- **`irrelevant-css.ts`** grows harness chrome, dead utilities and stale generated
  rules from previously-rendered stories. The baseline already carries some, so the
  claim under test is the strong one: irrelevant CSS *growing during a session* does
  not move the hash.
- **`spelling.ts`** emits identical styling as shorthands or longhands.

Wrapper insertion lives in `render.tsx` (around any subject) and in
`components/Wrappers.tsx` (inside two different formatting contexts), for reasons
covered below.

### One render path, two profiles

`renderCase(container, subject, variant)` is called by both the JSDOM tests and the
browser page. Stylesheets are injected from TypeScript strings rather than `<link>`ed
in one place and read from disk in the other, because two loaders is two chances for
the two profiles to see different bytes — and if they do, P4 ("both profiles agree on
what both can observe") measures the fixture instead of the collectors.

`tokens.css` is nonetheless a real file, because the attribution side-channel promises
`tokens.css:41` and a token with no file and no line cannot be named that way.
`styles/sheets.ts` holds a byte-identical copy and `sheets.test.ts` fails if they
drift. Duplication guarded by an equality check, rather than an async fetch in the
render path.

## Three findings that changed the fixtures

These are the reason the corpus was built by measuring rather than by reasoning.

**1. The flex-wrapper case did not do what it claimed.** The fixture was written to
show that whether an inserted `<div>` is inert depends on its parent's formatting
context. Measured in Chromium, wrapping a flex child changed nothing: the wrapper
shrink-to-fits to exactly the width the leaf had.

```
flex_base:     8,123,56,20 / 72,123,55,20 / 135,123,65,20
flex_block:    8,123,56,20 / 72,123,55,20 / 135,123,65,20   ← identical
```

Adding `flex-grow: 1` to the leaf fixed it. The declaration never moves; what moves is
whether the leaf is still a flex item for it to apply to.

```
flex_base:     8,123,253,20 / 269,123,252,20 / 529,123,263,20
flex_contents: 8,123,253,20 / 269,123,252,20 / 529,123,263,20   ← inert, as claimed
flex_block:    8,123,56,20 / 72,123,55,20 / 135,123,65,20       ← real geometry change
```

Had this shipped unmeasured, the corpus would have asserted a contested ground truth
for a case that was not contested at all, and the eventual disagreement would have
been read as a collector bug.

**2. JSDOM discards a shorthand whose value contains `var()`.** `padding: var(--x)
var(--x)` is dropped by JSDOM's declaration parser; the four longhands survive as
literal text. So the two spellings the corpus calls equivalent are *not* equivalent
through `getComputedStyle` under that profile:

```
base (shorthand):   borderTopLeftRadius = "0"
spelling-longhand:  borderTopLeftRadius = "var(--ks-card-radius, var(--va-radius-md))"
```

The ground truth is unaffected — Chromium renders them identically, measured below —
but the consequence for B1/B4 is concrete: the JSDOM collector must expand shorthands
from the declared rule text, not trust `getComputedStyle` to have done it.

**3. JSDOM does not evaluate `@media` while resolving styles.** `css-matched-media`
applies in Chromium (`rgb(91, 102, 112)`) and is invisible to JSDOM's
`getComputedStyle`. This does not make the case wrong: ADR-0003 step 2 has the
collector flatten conditions itself against the declared environment, reading
`CSSMediaRule.conditionText`, which JSDOM's CSSOM does expose. It converts the case
into a test of whether step 2 was implemented or quietly delegated to the engine.
`corpus.test.tsx` asserts the limitation explicitly, so if JSDOM ever gains media
evaluation the suite tells us.

A fourth, smaller one: React 19 emits `_r_0_` where 18.x emitted `:r0:`. ADR-0003
names the old spelling. Nothing breaks, because aliasing rewrites every id rather than
recognising generated ones by shape — but a normalizer built on the shape would have
stopped working on a minor React upgrade, which is a decent argument for the decision
already taken.

## Cases where the ground truth could not be decided

Three. They are marked `contested` in `corpus.ts`, excluded from `SETTLED_CORPUS`, and
a harness **must not** fold them into a pass rate without saying so. Reporting them as
failures and reporting them as successes both hide the same fact: nobody has decided.

### `dialog-open/dialog` — what is the subject subtree when there is a portal?

ADR-0003 scopes aliasing and pruning to "the subject subtree". Every other fixture
makes that unambiguous, because the subtree is the container. A portal splits it:

- **DOM reading** — the dialog panel is a child of `document.body`. Nothing inside the
  container changed, so the hash is stable, and *a modal dialog appearing is reported
  as `unchanged`*. ADR-0002 calls that the one thing the tool must never do.
- **Fiber reading** — the panel belongs to the subject because its owner chain leads
  back into it. The hash moves.

Declared `hash-changed`, on the argument that a rule which can report a dialog as
unchanged is not shippable. That is an argument from consequences, not from anything
written down, and it should not stay in a fixture comment. **This needs an ADR.**
`renderCase` returns the portal host alongside the container specifically so a
collector can implement either reading and the case can discriminate between them.

Measured, so the shape of the problem is not in doubt:

```
dialog/base:       container nodes = N, portal host innerHTML = 0 bytes
dialog/dialog-open: container nodes = N, portal host innerHTML = 342 bytes
```

The container is byte-identical across the two renders. Everything that changed is
outside it.

### `wrapper-flex-block/wrappers` — the profiles disagree, and both are right

Under `chromium` the inserted `<div>` becomes the flex item, the leaf stops being one,
and the rects move: a real `geometry` change. Under `jsdom` there is no layout engine,
nothing distinguishes it from the block-flow case, and `hash-stable` is the only
defensible answer. Declared for the `chromium` reading; a harness scoring `jsdom` must
*exclude* the case rather than record a miss.

This is not a defect in ADR-0002 — it is ADR-0002's premise made concrete. A profile
that is structurally unable to decide a case is exactly why the two profiles do not
share a baseline. But it does mean the corpus is not profile-neutral, and the manifest
has no field for that yet. Adding one (`profiles?: readonly ProfileId[]`) was resisted
on the grounds that one case does not justify a schema; if a second appears, it does.

### `prop-size/button` — is a band a value or a set?

A size change moves padding and font-size (`token`) and, under a real engine, the
button's rect (`geometry`). `band.ts` says the attributor folds rect movement under
the style change as collateral, which yields `token`. But nothing normative says a
subject reports *one* band rather than a set, and a policy that blocks on `geometry`
behaves differently under the two readings. Declared `token`; an extra `geometry`
finding under `chromium` should be scored as a pass.

## What the corpus deliberately does not cover

- **Raster.** Nothing here reaches Stage 2, so the `texture` band is absent by
  construction — `ExpectedBand` excludes it in the type. Texture is defined as raster
  residue after semantic explanation, and there is no raster.
- **Hazardous shorthands.** Only shorthands with a clean longhand decomposition are
  used. `background:` also resets `background-image`, `border-radius: 4px 8px`
  distributes to corners in an order that is easy to get wrong, and `font:` resets six
  properties including `line-height`. These are real normalizer hazards, but a fixture
  that got the equivalence subtly wrong would assert `hash-stable` for two genuinely
  different renders — a corpus bug that reads as a normalizer bug, the most expensive
  kind. They belong in a dedicated fixture with per-property assertions, not here.
- **Token changes at their real source.** `tokenOverrides` are applied as inline custom
  properties on the subject root. The resolved value is identical to editing
  `tokens.css`, but the *attributed source* is not: a collector will report an inline
  declaration, not `tokens.css:41`. So the corpus can measure token-keyed collateral
  counting and cannot yet measure source attribution. Fixing it means mutating the
  sheet between renders, which introduces ordering coupling the fixtures currently
  avoid.
- **Shadow DOM and adopted stylesheets.** ADR-0003 step 1 enumerates both. No fixture
  produces either. This is a real gap — shadow roots change what "reachable from the
  document" means — and it is the first thing to add.
- **Cross-subject collateral.** P2 is measured *within* one subject: `token-space-3`
  reaches four nodes across three components inside `hero`. The docket claim is about
  300 subjects sharing one root, which needs many subjects sharing a token and a
  manifest to compare against. That is M2 machinery.
- **Provenance.** No fixture asserts anything about owner chains, so P3 is untouched.
  `displayName` is set on every component so B2 has something to resolve to, and that
  is all.
- **Text-content volatility.** Timestamps, locale-dependent formatting, and declared
  volatile regions are all masking-policy cases with no fixture.
- **Animation settle points.** The allowlist excludes `transition-*`/`animation-*`
  because snapshots are taken at a settle point. Nothing here animates, so the settle
  point is untested.
- **Storybook.** Simulated, not depended on. `irrelevant-css.ts` reproduces the CSS
  conditions of a story canvas without the dependency, so the corpus stays under our
  control and the perturbations stay deterministic.

## Verification

```bash
yarn install --no-immutable && yarn build && yarn test
```

```
 ✓ examples/kitchen-sink/src/styles/sheets.test.ts (2 tests) 2ms
 ✓ packages/core/src/canonical.test.ts (16 tests) 3ms
 ✓ examples/kitchen-sink/src/corpus.test.tsx (65 tests) 673ms

 Test Files  3 passed (3)
      Tests  83 passed (83)
```

`tsc --build` is silent. The 65 corpus tests cover: manifest integrity (unique ids,
real subject/variant references, a band declared exactly when the hash is expected to
move, both outcomes populated); every case rendering both its variants under jsdom;
each perturbation demonstrably perturbing; the cascade fixtures actually losing and
winning; and — for all eight subjects — that every selector in every sheet declared
inapplicable matches zero nodes in the subject and in the portal host. That last one
exists because a "hash-stable" case built on a sheet that secretly *did* match would
be false, and would fail in a way indistinguishable from a normalizer defect.

### Real-engine verification

The claims about a real cascade cannot be checked under JSDOM, for the reasons above.
Served the page and measured Chromium directly:

```bash
python3 -m http.server 8931 --bind 127.0.0.1   # from examples/kitchen-sink
yarn workspace @variance-authority/example-kitchen-sink bundle
# then, per variant, computed styles over every semantic node of the subject
```

Ten computed properties over the twelve semantic nodes of `hero`, base vs. each
variant, counting rows that differ:

```
wrapperBlock  0/12      tokenAccent  2/12
allCruft      0/12      tokenSpace3  4/12
classChurn    0/12
accretion     0/12
spelling      0/12
idShift       0/12
```

Every no-op perturbation is a no-op in a real engine — including `allCruft`, which
applies all six at once. The two token edits move exactly the nodes the manifest
claims, which is what backs the `minCollateral` values (2 and 4) rather than leaving
them as guesses.

Cascade fixtures, `.ks-card__body` colour:

```
base              rgb(16, 20, 24)
css-losing-rules  rgb(16, 20, 24)     ← matched, lost, correctly invisible
css-winning-rules rgb(179, 38, 30)    ← matched, won
css-unmatched-media rgb(16, 20, 24)   ← condition false, dropped
css-matched-media rgb(91, 102, 112)   ← condition true, applied
css-accretion     rgb(16, 20, 24)     ← 15x the CSS, no effect
```

And the box, confirming shorthand/longhand/class-churn equivalence:

```
base              16px|16px|6px|rgba(16, 20, 24, 0.12) 0px 1px 2px 0px
spelling-longhand 16px|16px|6px|rgba(16, 20, 24, 0.12) 0px 1px 2px 0px
class-churn       16px|16px|6px|rgba(16, 20, 24, 0.12) 0px 1px 2px 0px
```

## Readback

**Expected:** a corpus that produces the cruft ADR-0003 removes, with declared ground
truth. **Observed:** produced, and it immediately found three things wrong with its
own assumptions (§"Three findings"), one of which would have shipped a false ground
truth. The corpus is doing its job before the normalizer exists.

**Not expected:** that the sharpest unresolved question would be a scoping one —
portals — rather than anything about CSS. ADR-0003 spends its length on stylesheets
and defines "the subject subtree" in passing, and that is the definition with a hole
in it.

**Result:** continue. B1 has an input; the portal question needs an ADR before B4's
collector picks a reading by accident.
