---
'@variance-authority/cli': patch
'@variance-authority/core': minor
'@variance-authority/sense': minor
---

`variance` loads a command's modules only when that command runs. `variance --version` now loads 43 modules, down from 440. `comment --marker` loads 432, down from 915, and none of `distill`, `report` or `vantage`. `index --no-git` loads 274, down from 445.

Two new subpaths let the flag parser load without its package roots: `@variance-authority/core/nearest` exports `didYouMean` and `nearest`, and `@variance-authority/sense/checkout-path` exports `checkoutPath`.
