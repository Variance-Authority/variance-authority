---
'@variance-authority/cli': patch
---

`variance select` and the runner seams place a test by its hops to a file you added since the last `variance index`. On a workstation, a source index that lacks a changed file the checkout holds is updated once before the selection reads it, with a line on stderr. Before, the test had no hops and waited for the leg that runs everything else, so `--at-distance 0-1` skipped it.
