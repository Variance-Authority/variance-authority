# 0004 — The normalizer: ADR-0003 made executable

**Date:** 2026-08-01
**Cycle:** helix 1, move M2
**Branch:** B1 (normalizer)

## Move

Implement `normalize(RawCapture) → SemanticSnapshot`: aliasing, attribute
projection, shorthand expansion, cascade resolution, custom-property resolution,
value canonicalization, wrapper collapse, and the three hashes.

**Expected readback:** the ADR-0003 no-op refactors produce identical hashes and
the negative controls do not.
**Disconfirming readback:** a rule cannot be stated without either dropping a
value from the hash or over-collapsing two visually different renders.

## Result: expected, with one rule the ADR got wrong

67/67 tests pass. Every ADR-0003 claim now has an assertion and a negative
control beside it — a normalizer that returned a constant would pass every
stability test, so each is paired with a case that must still differ.

The rule the ADR got wrong is **shorthand expansion**. ADR-0003 step 4 says
"discard declarations for properties outside the allowlist", and the allowlist is
longhands only. Applied literally that drops `font: bold 12px/1.5 serif`
entirely, because `font` is not on the allowlist and its grammar is genuinely
ambiguous to decompose — four optional keyword slots before a required size. A
dropped declaration is a value missing from the hash, which is a false
`unchanged`: changing the font would read as no change at all.

So expansion is now **all-or-nothing**, and a shorthand that cannot be decomposed
with certainty is admitted under its own name rather than partially expanded or
discarded. `background` and `font` are both declared unexpandable. Under a
profile with computed style this costs nothing — the engine supplies longhands
that supersede it — so it only widens the declared-only tier, where an
un-normalized value is a correct description of what that tier actually knows.

The principle generalizes, and is worth stating once: **every normalization rule
is allowed to lose information only in the direction of over-reporting.** Keeping
an un-normalized value costs a review nobody needed. Dropping one costs a missed
regression. Where the two trade off, the rule takes the first.

## Two bugs found, both instructive

**The fixture builder silently emptied child rules.** `NodeSpec.children` was
typed as `NodeSpec[]` and mapped through the builder, but callers write
`node({children: [node({...})]})` — so children arrived already built, and
re-running the builder read `spec.rules` off a `RawNode`, which has
`matchedRules`. Every child came back with no style.

This is worth recording because of *how* it presented: 60 tests passed. Style
assertions below a child node were comparing an empty map to an empty map, which
is equality. Only the negative controls caught it — four tests asserting two
trees must differ, failing because both had been reduced to nothing. **The
positive tests were structurally incapable of failing.** That is the same failure
shape as a false `unchanged`, reproduced in the test harness, and it is the
argument for pairing every stability assertion with a control.

**Aliasing was applied to every attribute, not just id references.** The fallback
branch mapped any attribute value through the alias table, so `type="button"`
became `#extern:?6`. Caught by an assertion that a surviving attribute keeps its
value — a check that existed only because "class is dropped" needed a companion
showing something else was kept. The same test also found `aria-label` and
`aria-hidden` being read as IDREFs, which would have emitted a dangling-id
diagnostic for every labelled node in every tree.

## Design notes

**Inheritance under declared-only.** Implemented for the allowlisted inheritable
properties. Without it, `color` set once on a container is invisible on every
descendant that renders text — the most common styling pattern there is, and its
absence would have made the JSDOM tier close to useless for the token band.

**Custom properties resolve through an inherited scope**, and the *names* are
recorded beside the resolved values. That is what makes the docket sentence "1
token change, N collateral, structure intact" computable: `structureHash` holds
while `styleHash` moves, and the token name groups the collateral. Test
`leaves structure untouched by a pure token change` asserts exactly that pair.

**Wrapper collapse re-paths during the walk, not after.** Promoted children must
get their final paths immediately, or every downstream reference is stale. Its
inertness test is deliberately conservative: an unrecognized property on a
wrapper keeps the wrapper, because this is the one rule that *removes* a node and
a wrong answer deletes evidence.

**Style provenance is outside the hash.** Moving a rule between files renames a
source without changing a render, and must not invalidate a baseline — asserted
by `does not let a rule moving between files invalidate a baseline`.

## Not yet done

Applicability pruning (ADR-0003 steps 1–3) is **not** in `core`, and cannot be:
matching a rule against a subtree needs `Element.matches` or CDP. `core` receives
only already-matched rules. The headline claim — accreted Storybook and
CSS-in-JS noise does not invalidate anything — is therefore still unproven, and
belongs to the collectors. That is the next move, and until it lands the claim is
not made.

Also absent: the differ, banding of concrete deltas, and attribution. The
snapshot format supports them; nothing computes them yet.

## Verification

```bash
yarn build && yarn test
```

`tsc --build` clean. 67/67 pass (16 canonical/hash, 51 normalizer).
