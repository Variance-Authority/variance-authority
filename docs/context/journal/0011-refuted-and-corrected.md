# 0011 — The headline example was wrong; what replaced it

**Date:** 2026-08-01
**Cycle:** helix 4, move M9
**Branch:** B10 (pixel arm) — corrections following journal 0010

## What happened

Journal 0009 and the TodoMVC comparison claimed `broken-toggle` — swapping an
`<input type="checkbox">` for a `<div>` carrying the same classes — was
**pixel-identical by construction**, and used it as the headline case a pixel
differ structurally cannot report.

Real Chromium screenshots refuted it:

```
broken-toggle    6 of 15 stories changed    5482 px (default)   11489 px (strict)
                 ds/toggle--states also RESIZED 1264x22 -> 1264x18
```

The construction argument was wrong on every clause. An `<input
type="checkbox">` is a **native control**: under `appearance: auto` the engine
paints a platform widget — its own accent fill, a checkmark glyph, a UA margin —
and the author's `.va-toggle` rules barely participate. Swapping it for a `<div>`
swaps a painted widget for a flat rounded square, and changes the box height by
4px, so it reflows as well.

I had reasoned about what the CSS said and never asked what the engine painted.

## Why the proxy agreed with me

The jsdom-side comparison models the pixel arm with an `appearanceHash` — style,
text, arrangement — and it reported `broken-toggle` as invisible too. It was
wrong in exactly the same way and for exactly the same reason: it models what an
author *declares* about a box, not what an engine *paints*.

That is worth stating as a property rather than an incident. **The proxy is
optimistic for the pixel arm's blind spots**: where it says "invisible" it may be
under-reporting. The direction is the tolerable one — it understates how often
pixels see something, in a table being used to argue against pixels — but it is
now written where the proxy is defined rather than left to be rediscovered.

## The replacement

`label-detached`: rename a field id, miss the matching `htmlFor`. The label still
renders, identically. The input still renders, identically. **The only thing that
changes is an attribute value**, so no pixel can move — this needs no argument
about painting, which is where the previous case went wrong.

Measured: **0 of 15 stories, 0 px at both policies.** Caught as one root,
attributed to `TextField`, with the accessible name lost and a
`dangling-id-reference` diagnostic.

`broken-toggle` stays, with `visible: true` and a weaker claim that survives: a
pixel differ *sees* it and cannot *classify* it. Six changed screenshots from an
accessibility regression look exactly like six changed screenshots from a
rebrand.

## The test that should have existed

The refutation was a one-off assertion about one mutation. It is now an
**invariant over every swept mutation**: declared `visible` must match what the
camera measured. A one-off refutation documents a past mistake; an invariant
prevents the next one.

It reads `CHANGED.get(id)` without a `?? []` fallback, deliberately. An unswept
mutation would otherwise read as "the camera saw nothing" and quietly satisfy any
`visible: false` claim — the same shape of vacuous pass that journal 0004 found
in the fixture builder.

## Two allowlist gaps, closed; one that cannot be

The pixel arm found three changes it sees and the snapshot did not:

| probe | px | now |
|---|---|---|
| `accent-color` | 114 | **caught** at `ALLOWLIST_VERSION` `a2` |
| `-webkit-text-stroke-width` | 463 | **caught** at `a2` |
| `canvas-repaint` | 857 | **still blind, and not fixable this way** |

The canvas case is different in kind: the bitmap lives in a rendering context,
not in the document. No amount of style collection reaches it. Same class covers
`<video>`, WebGL, and an image swapped behind a stable URL. It stays asserted and
visible rather than quietly dropped.

**A third property was added and immediately removed.** I added
`-webkit-text-stroke-color` alongside its sibling on the assumption that one
implied the other. Its initial value is `currentcolor`, so it moves whenever
`color` moves — which split a colour-token root in two, because the derived
property resolves through no token and looked like an independent cause. Nothing
had measured it. Properties whose computed value derives from another need the
derivation modelled before they can be admitted.

The general finding is recorded in `ruleset.ts` and is not fixed by two
additions: **the allowlist models what an author declares about a box and models
platform painting poorly.** Both gaps were found in an afternoon of probing,
which is weak evidence they are the only two. The response should be a systematic
audit against the CSS property index, not more ad-hoc additions.

## What the pixel arm is genuinely good at

Recorded because the comparison is worth nothing if the loser is strawmanned.

- **It is not flaky.** Shooting the same mounted story twice is 0 differing
  pixels, every round, both policies. The folklore is wrong. The noise that
  exists appears only across a *remount*, only at strict policy, only on
  antialiased text — 90–130 px across fifteen stories.
- **It needs no instrumentation.** No fiber walk, no provenance, no allowlist.
- **It sees everything, including what we do not model** — the canvas case above.

## What it cannot do, measured

- **It cannot distinguish layers.** `token-radius` and `token-accent` change
  *exactly the same eight stories*. A radius edit and a brand-colour edit produce
  a byte-identical review queue.
- **A screenshot costs 65.4 ms against 3.4 ms for a semantic collection** on the
  same page in the same process — 19×, with the pixel arm given our own
  persistent harness.

## A process note

An earlier ordering in the pixel runner took baselines *before* the flakiness
rounds, and `noop-refactor` reported 35 strict pixels on two buttons it does not
touch. Had that shipped quoting strict alone, it would have been a published
false detection on the one case where a pixel differ is unambiguously right. The
flakiness pass now runs first, so the noise floor is known before any result is
read.

Separately: one of my scripted patches silently did not apply, because the merged
code had restructured the function it targeted and the replacement was not
asserted. Every scripted edit now asserts its anchor.

## Verification

```bash
yarn build && yarn test
yarn workspace @variance-authority/example-todomvc pixel
```

436 passed, 3 skipped. Both corpus measurements unchanged after the `a2`
allowlist bump: `jsdom` 38/38, `chromium` 39/39, zero false verdicts.
