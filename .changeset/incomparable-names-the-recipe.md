---
'@variance-authority/raster': patch
'@variance-authority/observe': patch
'@variance-authority/report': patch
'@variance-authority/mcp': patch
'@variance-authority/cli': patch
'@variance-authority/playwright-test': patch
'@variance-authority/vitest-browser': patch
---

A moved identity names only the fields that differ

When the baseline was painted under another identity, the `because` sentence
names only the identity fields that differ between the baseline and this run,
and says whether they are the machine (renderer, engine, platform, scale, fonts)
or only variance-authority's recipe (the stabilization or rasterization digest).
`recipeOnly`, exported from `@variance-authority/raster`, answers which.

An observation from `@variance-authority/observe` carries `signals.document`,
saying whether the document is the one the baseline was painted from, so a
recipe change over an unchanged document reads apart from one that moved the
page too. `signals.pixels` is optional, since a subject that occupies no pixels
has none to measure; TypeScript code that reads `Observation.signals.pixels`
must handle it being absent.

`variance ask summary` prints a reason that several subjects share once, with a
count, and lists the subjects under it, so an upgrade that moves every subject
reads as one line rather than one per subject. It groups the same way the
pull-request comment does, through `byReason`, exported from
`@variance-authority/report`.
