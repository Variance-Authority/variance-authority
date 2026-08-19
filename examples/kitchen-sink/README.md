# kitchen-sink

**Showcase:** advanced corpus and observation-profile validation, not an
ordinary visual-regression demo.

**The measurement's ground truth.** 8 subjects, 40 declared cases.

Not a demo. This is the corpus the normalizer is scored against, and its whole
value is that every case declares its expected outcome **before** the pipeline
runs — so a run that agrees is evidence and a run that disagrees is a defect
report rather than a discussion.

**What it proves:** the normalizer and its `jsdom`/Chromium collection paths
answer the declared cases, agree where both profiles can observe, and expose
undecidable or contested cases instead of counting blindness as success.

**Boundary:** one component library written in this repository. The scores do
not establish behavior on a third-party library or provide a false-alarm rate
for no-op edits.

## Running it

```bash
yarn vitest run examples/kitchen-sink/src/measure.test.tsx
```

The `chromium` half needs a browser, and skips itself with a stated reason if
there is none:

```bash
npx playwright install chromium
```

```bash
yarn vitest run examples/kitchen-sink/src/measure.chromium.test.tsx
```

What the persistent harness is worth, cold versus warm:

```bash
yarn workspace @variance-authority/example-kitchen-sink bench
```

## What it has proved

```
jsdom     scorable 38   agreed 38/38   false unchanged 0   false changed 0   undecidable 1   contested 1
chromium  scorable 39   agreed 39/39   false unchanged 0   false changed 0   undecidable 0   contested 1
P4        comparable 38   agreement 38/38   undeclared divergence 0
```

Reading the columns: **scorable** is the declared cases a profile is allowed to be
graded on, and **agreed** is how many of those it got right. A **false unchanged**
is the one that must stay at zero — a real change reported as no change. A case is
**undecidable** where the profile's own `ObservationProfile` already declares it
cannot see the dimension in question, so scoring it either way would measure
blindness rather than the ruleset; `wrapper-flex-block/wrappers` is undecidable
under `jsdom` and scorable under `chromium`, which is why the two totals differ by
one. **Contested** is the case the corpus refuses to grade at all:
`dialog-open/dialog` has no ADR deciding whether portalled content belongs to the
subject, the two defensible readings give opposite verdicts, and it is held out
until one exists rather than settled by whichever answer the implementation
happens to give. 38 + 1 + 1 and 39 + 0 + 1 are the 40 declared cases.

**P4** is the profile-agreement claim, scored in one file and one run so it
compares two observers rather than two runs: of the 40 cases, 38 are *comparable*
— observable by both profiles — and both answer identically on all 38, with no
divergence that was not declared in advance. Both profiles agreeing on the
dimensions both can observe is the claim that the two collection paths implement
**one ruleset** rather than two that happen to look alike.

## It has found defects the implementation's own tests could not

Nine, across two scoring runs — five under `jsdom`, four under `chromium` — and
every one of them real. One fix was **backed out** for producing a false
`unchanged` under the other profile, which is exactly the kind of thing a corpus
catches and a unit test does not.

See journals [0006](../../docs/context/journal/0006-m0-measurement.md) and
[0007](../../docs/context/journal/0007-persistent-harness-and-p4.md).

## Honest limit

**One corpus, built by us.** Both profiles agree on it, which proves the two
collection paths implement one ruleset. It does not prove the ruleset holds on
someone else's component library — and the fixtures were convenient in the same
way the implementation was convenient, which
[journal 0008](../../docs/context/journal/0008-sessions.md) caught: token overrides
applied inline on the subject root routed around a hole where `:root` tokens
reached nothing at all.
