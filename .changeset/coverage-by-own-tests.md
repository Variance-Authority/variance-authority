---
"@variance-authority/sense": minor
"@variance-authority/cli": minor
---

`variance coverage --packages` counts each package by whose tests ran it: its own, or only other packages'. A tree walks the packages with the most regions only other packages' tests reach down to their files, and `--format json` lists every file under `ownership`. `coverageByOwner` in `@variance-authority/sense/test-selection` makes the count from the case indexes.
