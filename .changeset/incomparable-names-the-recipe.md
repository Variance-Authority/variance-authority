---
'@variance-authority/raster': patch
'@variance-authority/observe': patch
'@variance-authority/mcp': patch
'@variance-authority/cli': patch
'@variance-authority/vitest-browser': patch
---

An `incomparable` verdict names what differs, and a recipe change is a re-baseline

The reason now names only the identity fields that differ between the baseline
and this run, and says whether they are the machine (renderer, engine, platform,
scale, fonts) or only variance-authority's recipe (the stabilization or
rasterization digest). It used to print both identities in full and blame the
machine either way.

When only the recipe differs, which an upgrade or a changed renderer option does
on an unchanged machine, the run still paints each subject and the reason says
the difference is a re-baseline: review the images and adopt them with
`variance accept --all`. Before, the run left no image, so `accept` had nothing
to promote and the old baselines had to be deleted by hand. Another machine's
baseline is still refused without painting.

`variance ask summary` prints a reason that several subjects share once, with a
count, and lists the subjects under it, so an upgrade that leaves every subject
`incomparable` reads as one line rather than one per subject.
