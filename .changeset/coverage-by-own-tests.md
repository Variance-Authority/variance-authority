---
"@variance-authority/sense": minor
"@variance-authority/cli": minor
---

`variance coverage --packages` counts each package by whose tests ran it: its own, or only other packages'. A tree walks the packages with the most regions only other packages' tests reach down to their files, and `--format json` lists every file under `ownership`. `coverageByOwner` in `@variance-authority/sense/test-selection` makes the count from the case indexes.

`variance coverage --at-distance <hops>` counts each region by the nearest test that ran it, across every suite, in the band `covering --at-distance` takes, so `--at-distance 2-` shows the code no test within one hop reaches, and the bands split what ran. It composes with `--packages` and `--from`. A test the import graph does not hold is left out and counted, with the regions no walk placed. `coverageAtDistance` makes the narrowed index.
