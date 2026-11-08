---
'@variance-authority/cli': patch
---

The documented workflow accepts a change by the tick in the pull request's comment, by a dispatch with `accept`, and by a push to `main`, with no label and no `gh api` step. `docs/placement.md` prints that job, and shows a committed store accepting by a dispatch with `accept` on the pull request's branch, through `commit-baselines`. The descriptions of `Variance-Authority/action`'s `accept`, `commit-baselines` and `to-accept` inputs name the tick and the dispatch instead of a label.
