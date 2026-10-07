---
'@variance-authority/raster': patch
'@variance-authority/observe': patch
'@variance-authority/report': patch
'@variance-authority/mcp': patch
'@variance-authority/cli': patch
'@variance-authority/playwright-test': patch
'@variance-authority/vitest-browser': patch
---

An `incomparable` verdict names what differs, and a recipe change can be re-baselined

The reason now names only the identity fields that differ between the baseline
and this run, and says whether they are the machine (renderer, engine, platform,
scale, fonts) or only variance-authority's recipe (the stabilization or
rasterization digest). It used to print both identities in full and blame the
machine either way. `incomparableBecause` and its `IncomparableSides` wording,
whose `replaceable` says whether the reason may offer a re-baseline, are
exported from `@variance-authority/raster` for a caller that writes the same
sentence.

When only the recipe differs, which an upgrade or a changed renderer option does
on an unchanged machine, the run still paints each subject. The reason says
whether the document is the one the baseline was painted from. If it is, only
the recipe moved: review the images and adopt them with `variance accept --all`,
or with `--update-snapshots` in Playwright or `--update` in Vitest. If the
document changed too, the new image is a change no comparison has read, and the
reason says so. Before, the run left no image, so `accept` had nothing to
promote and the old baselines had to be deleted by hand.

The refusal stands for another machine's baseline, for a side that recorded no
recipe digest, and for an identity that differs in a field this version does
not name: in each, nothing shows the machine is the same. `settle` takes the
run's identity as an optional third argument, as before, and refuses a recipe
re-baseline when it is absent.

`variance accept --all` passes by an `incomparable` subject whose document moved
and names the command that adopts it alone; `variance accept <subject>` adopts
it. In `@variance-authority/report`, `promotionOf` takes a `PromotionOptions`
with `bulk` for that rule, and its refusal for a subject with no image now says
the baseline is another machine's or cannot be shown to be this machine's. In
`@variance-authority/playwright-test`, `--update-snapshots=changed` passes the
same subject by and `=all` adopts it; `VarianceRun` carries `overwriting`, set
under `=all`. Deferred capture paints against an older recipe, so both flags
have an image to adopt.

An incomparable observation from `@variance-authority/observe` carries
`signals.document`, saying whether the document is the one the baseline was
painted from, and `signals.pixels` is optional, since no pixels were compared.

`variance ask summary` prints a reason that several subjects share once, with a
count, and lists the subjects under it, so an upgrade that leaves every subject
`incomparable` reads as one line rather than one per subject. It groups the
same way the pull-request comment does, through `byReason`, exported from
`@variance-authority/report`.
