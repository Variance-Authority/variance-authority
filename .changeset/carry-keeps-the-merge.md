---
'@variance-authority/cli': minor
---

`variance carry keep` keeps beside the records, in `commits.bundle`, the commits they name that `origin/<base>` does not hold, such as the merge `carry merge` made, and `variance carry take` reads them before fetching the rest by name, so a workflow that merges a pull request itself no longer fetches its merges before `take`. `take` removes the suites it left from the directory and names the ones it took in `taken.json`; a later `take` over that directory, in another job of the run, exits 2 when it cannot take one of them.
