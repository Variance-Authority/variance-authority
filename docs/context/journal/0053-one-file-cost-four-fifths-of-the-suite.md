# One file cost four fifths of the suite

The question everyone asks about selection is *how many files did you change*.
Twelve adjacent files in one subtree of Material UI's own recorded suite say that
is the wrong question.

Material UI's suite, run with the instrument installed — 791 modules, 184 test
files, a real recording and not a generated one:

```
node packages/sense/scripts/selection-scale.mjs neighbours {MUI-SNAPSHOT} 12
```

```
alone  cumulative  file
   4%          4%  packages/mui-material/src/Popper/index.js
   5%          5%  packages/mui-material/src/Popper/popperClasses.ts
  16%         16%  packages/mui-material/src/Portal/Portal.tsx
  16%         16%  packages/mui-material/src/Portal/index.js
   2%         17%  packages/mui-material/src/Radio/Radio.js
   2%         17%  packages/mui-material/src/Radio/RadioButtonIcon.js
   2%         17%  packages/mui-material/src/Radio/index.js
  78%         82%  packages/mui-material/src/Radio/radioClasses.ts
   2%         82%  packages/mui-material/src/RadioGroup/RadioGroup.js
   2%         82%  packages/mui-material/src/RadioGroup/RadioGroupContext.ts
   2%         82%  packages/mui-material/src/RadioGroup/index.js
   2%         82%  packages/mui-material/src/RadioGroup/radioGroupClasses.ts
```

**Eleven of those files cost 17% of the suite between them. The twelfth costs
78% on its own.** The cumulative column does not move after it, because there is
nothing left to add.

`radioClasses.ts` is nine lines of generated class names. It is not the component,
it is not complicated, and nothing about reading it suggests it decides anything.
It is imported by the styling utility that every component imports, so every test
that mounted anything entered it.

## The band table was measuring the wrong axis

This is why the file-count sweep has a knee and why the knee is a lie:

| clustered files | share of the suite run |
|---|---|
| 1 | 4% |
| 5 | 16% |
| 10 | 81% |
| 20 | 81% |
| 50 | 83% |
| 100 | 85% |

Between five files and ten, selection stops working. It looks like a threshold in
the number of files and it is nothing of the kind — the tenth file was the hub,
and a run of a hundred files that misses every hub would sit at 4%.

**The axis is whether the change set touches a hub, and the file count only
correlates with it because more files means more chances.**

## How many hubs there are

```
node packages/sense/scripts/selection-scale.mjs hubs {MUI-SNAPSHOT}
```

```
791 modules x 184 tests
one pass over the repository : 4 ms (5.1 us per file)
share of the suite one file costs : p50 7.1%  p90 84.2%  p99 85.3%  worst 89.7%
files costing half the suite or more : 250 (31.6%)

worst:
   90%  packages/mui-utils/src/useEnhancedEffect/index.ts
   86%  packages/mui-utils/src/exactProp/exactProp.ts
   86%  packages/mui-utils/src/clamp/clamp.ts
   85%  packages/mui-material/src/colors/blue.js
```

The median file costs 7% of the suite and the 90th percentile costs 84%. There is
no middle: the distribution is bimodal, a file is either local or it is
everybody's, and **31.6% of this repository is everybody's**.

`clamp.ts` is a three-line arithmetic helper. That is the honest shape of a
component library, and it is the number to hand anyone who asks whether selection
is worth adopting — along with the other half of it, which is that the median
pull request does not touch one of those files, and when it does not, it runs 4%
of the suite.

## The scan is cheap enough to ship

One pass unions the audiences of every region of every module, with a mark array
of `TESTS` reused across modules and stamped with a generation rather than
cleared, so the whole scan allocates one array and nothing else.

| | modules | one pass | per file | peak rss |
|---|---|---|---|---|
| Material UI, recorded | 791 | 4 ms | 5.1 µs | 69 MB |
| the target shape | 200,000 | 3,714 ms | 18.6 µs | 345 MB |

Under four seconds and inside the budget for a repository of two hundred thousand
modules, once per snapshot. That makes *which files are hubs* a thing a run can
know and say — which is a better report than a number of tests, because the
answer to "why did this run everything" is a file name.

## What the target-shape fixture is not allowed to say

The same scan on the 200,000-module fixture reports p50 26%, p90 27% and hubs at
**0.3%**. Do not quote that. The fixture's closures are generated from a uniform
barrel graph, so every module has nearly the same audience by construction, and
the distribution above is a property of the generator rather than of any
repository.

Latency and memory come from that fixture, because those depend on the size and
the shape of the file and it is a real file. **Selectivity comes only from
Material UI**, because that is a real recording of a real suite. Mixing the two
produces a sentence that is defensible line by line and false as a whole.
