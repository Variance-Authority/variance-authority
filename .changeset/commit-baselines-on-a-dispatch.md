---
'@variance-authority/cli': patch
---

`Variance-Authority/action`'s `commit-baselines` pushes the accepted images to the dispatched branch on a `workflow_dispatch` of a branch, as it does to the head branch on a `pull_request` event, so a committed store can accept from a dispatch. Any other run, such as a push or a dispatch on a tag, still exits 2, and the error now names the event and the ref it ran on.
