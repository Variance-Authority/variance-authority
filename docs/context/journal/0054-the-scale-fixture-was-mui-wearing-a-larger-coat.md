# 0054 — the scale fixture was MUI wearing a larger coat

**Date:** 2026-09-16

A review pass looking for what a sceptic would say about "journeys are physically
possible" returned the objection this project deserved most:

> The only figures where selection wins big at scale come from a fixture that was
> generated to have no hubs, so they do not transfer to my monorepo.

and, separately and more sharply:

> The only 200k-scale fixture is built at 8 regions per module; real TypeScript in
> this repository instruments at 46. Every scale figure rides on a region axis
> roughly 5.8x too low.

The second one would be fatal if true. A snapshot's size is regions, not files —
200,000 modules is a row count, 2,047,441 regions is the thing actually encoded —
so a fixture with an understated region axis would make the 77.2 MB headline a
number about nothing.

Both objections came from reading the *label* I had written, and the label was
wrong. So the first thing to do was stop arguing and measure the fixture.

## The measurement

There was no arm for this, which is why the label went unchecked for a day. There
is one now:

```
node packages/sense/scripts/selection-scale.mjs regions {200K} {MUI}
```

```
this snapshot           200000 modules    2047441 regions   mean  10.2  p50   2  p90  23  p99  124  max 509
against                    791 modules       8143 regions   mean  10.3  p50   2  p90  23  p99  133  max 509

regions      this   against
      1    42.09%    41.97%
      2    19.66%    19.60%
      3     2.51%     2.53%
      4     3.83%     3.92%
      5     4.44%     4.42%
      6     1.78%     1.77%
      7     1.12%     1.14%
      8     1.36%     1.39%
      9     1.53%     1.52%
     10     1.38%     1.39%
     11     1.27%     1.26%
     12     1.14%     1.14%
     13     1.01%     1.01%
     14     0.90%     0.88%

distinct region-counts: 70 and 70
total variation distance: 0.47%
```

`against` is `mui-full.v8.bin`, which is not a fixture at all: it is Material UI's
own Vitest suite, run with the instrument installed. **Seventy distinct
region-counts on each side, the same seventy, and the two distributions are 0.47%
apart in total variation.** The module paths agree with that reading — the
fixture's first row is `packages/Accordion.js/src/AccordionActions.js/…` and its
last is `packages/zero-styled/src/useTimeout/…`, which is MUI's own vocabulary.

So the fixture is not generated at 8 regions per module. It is **the Material UI
recording's region shape, sampled and scaled 253 times**. The "8" in the objection
is real but belongs to a different script: `snapshot-scale.mjs` writes a flat
eight per module at line 262, and my own `measurements.txt` had named that script
as this fixture's producer. It is not.

## What the objection got right anyway

The sceptic was wrong about the region axis and right about everything the label
had blurred, and the honest split is per-axis rather than per-fixture:

| axis | where it comes from | transfers? |
|---|---|---|
| module paths | MUI's own vocabulary, scaled | yes |
| regions per module | MUI's recording, TVD 0.47% | **yes** |
| region spans | MUI's recording | yes |
| which test entered which module | synthesized, uniform | **no** |

The crossing relation is the synthesized half, and it is uniform by construction:
the hub scan over it returns p50 26.0%, p90 27.1%, p99 27.8%, with 0.3% of files
costing half the suite or more. A real repository does not look like that —
[0053](./0053-one-file-cost-four-fifths-of-the-suite.md) measured MUI at p50 7.1%,
p90 84.2% and 31.6% of files over half — so **every latency, byte and memory
figure from this fixture stands, and not one selectivity figure does.**

That is the same conclusion 0053 reached from the other end, and it is now true
for a better reason. It was a house rule about which numbers to quote. It is a
measured property of the fixture.

## The 46

The objection's 46 regions per module came from calling `instrument()` on this
repository's own source and counting what the transform cuts. That number is real
and it is not the same quantity: a snapshot holds the regions a run **entered**,
and MUI's real recording carries 10.3 of them per module — 42% of its modules
carry exactly one. The gap between 46 cut and 10.3 recorded is the instrument
declining to write down regions nothing reached, and a claim about snapshot size
has to use the second number. A claim about *transform cost* has to use the first,
and that one has no measurement yet.

## What this cost

One line of a scratch file, written from memory rather than from the artifact, put
a wrong provenance on the strongest scale evidence in the project and handed two
independent reviewers the same wrong reading. The repository's rule — a number
without a reproduction is a rumour — turns out to need a second half: **a fixture
without a reproduction is a rumour too.** The `regions` arm exists so that the
next person checks the snapshot instead of the sentence beside it.
