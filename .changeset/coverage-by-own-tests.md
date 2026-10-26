---
"@variance-authority/sense": minor
"@variance-authority/cli": minor
---

`variance coverage --packages` counts each package by whose tests ran it: its own, or only other packages'. A tree walks the packages with the most regions only other packages' tests reach down to their files, and `--format json` lists every file under `ownership`. `coverageByOwner` in `@variance-authority/sense/test-selection` makes the count from the case indexes.

`variance coverage --at-distance <hops>` counts only the tests within that many import hops of the code they ran, the band `covering --at-distance` takes, so `--at-distance 2-` shows the code only far tests reach and composes with `--packages` and `--from`. A test the import graph does not hold is left out and named. `coverageAtDistance` makes the narrowed index.
