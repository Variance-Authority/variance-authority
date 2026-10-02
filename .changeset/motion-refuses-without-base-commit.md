---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

A base your clone cannot diff from is refused rather than compared. `variance
coverage` against a base, `variance covering --against` and `--cases last`, and
`variance review` with `--against` or `--coverage` exit 2 with an `undiffed`
refusal when the base names no commit, or names one this clone does not have.
The message names the commit and how to get it: `git fetch origin <sha>`, or
`fetch-depth: 0` on `actions/checkout`. A review job in CI fails with it rather
than posting a comment that compared regions which may not be the same code.
They used to pair those regions by their place among regions of one name, which
reads a function written between two siblings as one losing every case and
another gaining them.

`covering --since --against` refuses the same way when git cannot say what the
base's branch changed after the base was recorded, which a shallow clone cannot
answer, instead of comparing without leaving those files out.

`--cases last` after a second run at one commit that ran a test file again is
refused too: that run's replaced cases mix the commit's own cases with the ones
they replaced, so they name no commit to diff from. The first run after a commit
compares with the last run at the commit before.

`caseMotion` and `coverageChange` take `diff` as a required option; it is the
only way they pair regions.
