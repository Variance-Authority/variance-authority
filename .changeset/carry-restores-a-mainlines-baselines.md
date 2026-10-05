---
'@variance-authority/cli': patch
---

`variance carry restore` ends the restore keys for baselines and for an `actions-cache` report with each other mainline, as it does for a recording. A pull request into a branch that saves nothing, for example the base of a stacked pull request, restores what a mainline saved, instead of finding no store and reporting every subject as `new`.
