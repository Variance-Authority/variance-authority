# A hundred percent bought one witness per region

**Date:** 2026-09-20

`yarn test:coverage` had just landed — V8's counters over our own suite, a
second instrument with no stake in our answer — and the open question was what
it can and cannot say that the record can. The way to find out was to take one
package to 100% and then read the same package through the record.

[`packages/jsx-source`](../../../packages/jsx-source) was the specimen: five
modules, eighty-three countable lines, small enough to finish in an afternoon
and real enough that the tests written for it are tests somebody would want.

## Reaching it

Four test files — `record.test.ts`, `vite.test.ts`, `production.test.ts`,
`entrypoints.test.ts`, twenty-four tests. The package went from 73.49%
statements / 71.87% branches / 71.42% functions to **100% on all four columns**.

```bash
yarn test:coverage
```

## What the record says about the same package

```bash
yarn test
node packages/sense/scripts/witnesses.mjs packages/jsx-source
```

Before those tests the record held **three modules, 31 regions, 25 of them
entered**. After, **five modules, 41 regions, all 41 entered** — and the median
region has **two** witnesses, while **16 of the 41 (39%) rest on exactly one
test**.

The two instruments agree that the package is now fully covered. They disagree
about what that sentence is worth, and the disagreement is legible region by
region.

**`jsx-runtime.ts` is the whole argument in one file.** Two statements, a type
re-export and `export * from 'react/jsx-runtime'`. The counter read 0%, and it
now reads 100%, because `entrypoints.test.ts` imports the file and asserts that
`jsx`, `jsxs` and `Fragment` come back identical to React's. Nothing was tested;
a module was loaded. The record's reading of that same file is one `module`
region with one witness, and *no function region and no branch region at all* —
because there is no behaviour in the file for a region to be cut around. The
counter's 100% and the record's single row describe the same fact, but only one
of them describes it as thin.

**The same work bought three regions that carry weight**, and the record names
them and their only witness:

```
under.ts    93-93  branch        under/jsxDEV   → production
under.ts    95-96  continuation  under/jsxDEV   → production
record.ts   95-102 handler       record         → record
```

The first two are the production fallback — a development runtime asked to
create an element with no `jsxDEV` in it. The third is the handler for a config
the runtime cannot write to. Each is a real failure mode, each is now observed,
and each is observed exactly once. Delete one test file and the counter drops a
few points; the record says which failure mode stopped being watched.

**And all nine of `vite.ts`'s regions have `vite.test.ts` as their only
witness.** The counter reads 14/14 lines. The record reads: this module's entire
evidence is one file.

**The record's zero is an absence, not a zero.** Before the new tests,
`jsx-runtime.ts` and `vite.ts` were not modules at 0% in the record — they were
not in it. A counter pointed at a directory with `all: true` lists a file no run
ever loaded and scores it; the record holds a row only for a module some run
imported, and a changed path it has no row for widens selection to the whole
suite rather than answering. Those are two different honest behaviours and it is
worth not confusing them: the counter can tell you a file is untouched, and the
record cannot, which is exactly why both are installed.

## The same pair over the whole repository

```bash
node packages/sense/scripts/witnesses.mjs
```

478 test files, 5,312 tests, 22,434 regions under `packages/*/src`.

| | V8 lines | regions entered | median witnesses | one witness |
| --- | --- | --- | --- | --- |
| whole repository | 87.4% | 84% | 1 | — |
| `ioc` | 100.0% | 100% | 1 | **100%** |
| `jsx-source` | 100.0% | 100% | 2 | 39% |
| `route-collector` | 71.8% | 74.9% | 2 | **21%** |
| `distill` | 93.1% | 83.8% | 1 | **84%** |
| `presentation` | 88.4% | 85.9% | 3 | 11% |
| `storybook-collector` | 13.4% | 82.6% | 1 | 83% |

`ioc` and `jsx-source` are both at 100%. Every region in `ioc` has exactly one
test behind it; `jsx-source` has a median of two. `route-collector` is one of
the worst-covered packages in the repository and has the best-witnessed regions
in it. `distill` at 93.1% has 84% of its regions resting on a single test.

Ranked over the 31 packages with fifty regions or more:

```
spearman(v8 lines, regions entered) = 0.62
spearman(v8 lines, median witnesses) = 0.65
spearman(v8 lines, single-witness share) = 0.26
```

So the line percentage is a decent predictor of *whether* a region was entered —
the two instruments are looking at overlapping things, and their aggregate
readings, 87.4% and 84%, are close for a reason. It is not a predictor of how
thinly the evidence is spread. That column is independent of the number
everybody quotes.

## What this settles

**The counter is not wrong and it is not weak — it answers a different
question.** *Was this line executed* is worth knowing, it is cheap, and a file
at 0% is a real finding no reasoning replaces. The 87.4% is a check on us, and
that is the job it was installed for.

**What it cannot express is a unit.** There is no way to say *this region has
one witness* in a percentage of lines, so a suite cannot be ranked by the
property that actually predicts what happens when a test is deleted or a module
is changed. Our record can say it, because a region carries the test files that
entered it and those files have names a person can read.

**The two failure modes are opposite and both are ours to report.** A high
percentage over single-witness regions is a suite that looks finished; the
record's `1-wit` column is the one that says otherwise. A low percentage over
well-witnessed regions — `route-collector` — is a suite that looks unfinished
and is not, and the record is what defends it.

Nothing in this changes what ships. `yarn test:coverage` stays ungated and stays
a second opinion; `witnesses.mjs` prints both columns and gates nothing. What
was missing before today was the data to say any of this, and the shape of a
report worth building is now visible: **witnesses per region, not lines per
file.** Who else has built one is
[`prior-art.md`](../prior-art.md#coverage-adequacy).
