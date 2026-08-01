# ADR-0008 — Per-profile expectations: blindness is not an answer

**Status:** accepted
**Date:** 2026-08-01
**Blocks:** B4 (scoring the `chromium` profile), claim P4
**Amends:** the corpus manifest format only. ADR-0002 stands unchanged.

## Context

ADR-0002 makes `jsdom` and `chromium` separate baselines that are never diffed
against each other. It says nothing about how a *corpus* states an expectation,
and the corpus assumed one ground truth per case — a single `expect` field.

Two cases proved that assumption false, and they are false in two different ways:

- **`wrapper-flex-block/wrappers`.** A `<div>` is interposed inside a flex row.
  Under `chromium` it becomes the flex item, the leaf stops being one, and the
  leaves resize: a real `geometry` change. Under `jsdom` there is no layout
  engine and nothing distinguishes this from `wrapper-block/wrappers`, whose
  correct answer is `hash-stable`.
- **`prop-size/button`.** The verdict is `hash-changed` under both profiles. The
  *band* differs: `token` under `jsdom`, and under `chromium` the button also
  measurably grows, producing `rect-changed` deltas that `bandOf` puts in
  `geometry`.

The corpus's own note on the first case contains the contradiction in one
paragraph: it says the only defensible `jsdom` answer is `hash-stable`, and it
says a harness scoring `jsdom` **must exclude the case rather than record a
miss**. Both cannot be a ground truth. Deciding which is the whole of B6.

Without a decision, scoring `chromium` is meaningless for exactly the cases that
distinguish the profiles, which is to say for the cases P4 exists to examine.

## Decision

A corpus case may carry per-profile clauses. Three states, deliberately kept
apart, because collapsing any two of them destroys the measurement:

```ts
readonly byProfile?: Partial<Record<ProfileId, ProfileExpectation | Undecidable>>;
```

### 1. Undecidable — the profile is structurally unable to decide

```ts
{ undecidable: 'why this profile cannot reach an answer' }
```

The case is **excluded** from that profile's score. Not counted as a pass, not
counted as a miss, reported separately with its reason.

This is the resolution of the contradiction above, and the argument is short:
`hash-stable` under `jsdom` for `wrapper-flex-block/wrappers` is not an
expectation, it is a **consequence of blindness**. Scoring it as a pass would
credit the profile for an answer it reached by not looking, and the number it
inflates — "agreement on the dimensions both can observe" — is precisely the
number that must not be inflated. Scoring it as a miss is equally dishonest in
the other direction: it charges a profile for a limitation it *declares*, which
is what an `ObservationProfile` is for.

So the exclusion is not a convenience. It is the corpus obeying ADR-0002 §3: a
tier that cannot see a band must say so rather than pass it.

### 2. Divergent — the profiles legitimately disagree

```ts
{ expect: 'hash-changed', band: 'geometry', roots: 1, because: 'the argument' }
```

A full expectation replacing the default for that profile. Both are correct;
they describe different observers. `because` is mandatory and is the *argument*,
not a description — a divergence without a stated reason is indistinguishable
from a mistake, and this field is what a future reader disputes.

### 3. Divergence that should not exist — the finding

Not a declaration at all: an **observation**. For every case where both profiles
are scorable and the corpus declares the *same* verdict, the two observed
verdicts must be equal. An inequality there is a defect in one of the two
collection paths, and surfacing it is the entire content of claim P4.

This is why states 1 and 2 must be explicit rather than inferred. If undecidable
cases were silently skipped, and divergences silently tolerated, then "the
profiles disagree" would be unfalsifiable — every disagreement would have an
available excuse. Declaring the legitimate ones in advance is what leaves the
rest exposed.

### Resolution order

`contested` (nobody has decided) outranks everything: a contested case is
unscorable under every profile. Then the profile clause, then the default
`expect`. A profile with no clause inherits the default; the default is not
"the `jsdom` answer", it is "the answer under any profile that has not said
otherwise".

## Consequences

- `SETTLED_CORPUS` grows from 37 to 39 and `CONTESTED_CORPUS` shrinks to 1
  (`dialog-open/dialog`, which is a genuinely open question about the subject
  boundary and not a per-profile one). The `jsdom` score's denominator is
  unchanged at 37 + `prop-size/button` = 38, with `wrapper-flex-block/wrappers`
  now excluded explicitly and by name rather than by being flagged as disputed.
- A harness MUST report undecidable-per-profile counts alongside its score. A
  pass rate whose denominator moved silently is a rumour.
- `band` on a per-profile clause is asserted where declared. It is *not* asserted
  from the default `expect` clause, because no harness has ever asserted it and
  turning 39 unasserted fields into assertions in the same change would mix a
  format decision with a measurement.

## What this forecloses

- **A single ground truth per case.** Cheap, and it makes the profile system
  unmeasurable: the only cases worth measuring are the ones where the profiles
  differ.
- **Scoring a profile on cases it cannot observe.** In either direction. A
  profile is not penalised for a declared limitation and not credited for it.
- **A per-profile `expect` inferred from the profile's capabilities** (e.g.
  "`jsdom` has no layout, so any layout-dependent case is automatically
  `hash-stable` there"). That is the correlation heuristic ADR-0002 refuses,
  rebuilt in the corpus. Undecidability is declared per case, by an author, with
  a reason.
- **One combined agreement number.** Agreement rate, false-`unchanged` count and
  false-`changed` count are reported separately, per profile. A false
  `unchanged` is categorically worse and may never be averaged into a total.

## Open, still

**Band cardinality.** This ADR lets a case declare *a* band per profile. It does
not decide whether a subject reports one band or a set — `prop-size/button` under
`chromium` genuinely produces both `token` and `geometry` deltas, and the single
`band` field records only the dominant one. The corpus can now express the two
profiles' answers; it still cannot express "a set". Resolving that is a change to
`SemanticDiff`, not to the corpus, and is left open.
