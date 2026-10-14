---
'@variance-authority/cli': minor
'@variance-authority/core': minor
'@variance-authority/dom': patch
'@variance-authority/observe': patch
'@variance-authority/playwright': patch
'@variance-authority/png': patch
'@variance-authority/raster': patch
'@variance-authority/route-collector': patch
---

A run collects in parallel by default, and the report says where each subject's time went

Without `workers` in the config, a run collected in one browser world, so a
route suite read its pages one after another on any machine. It now collects in
half the machine's logical cores, at least one and never more worlds than there
are files: two on a 4-vCPU CI runner, eight on a 16-core laptop. A `workers` you
set still wins. Set `workers: 1` for a server under test that cannot take
concurrent pages. A collector with no `openWorker` still collects in one world,
and the run warns about it only when you set `workers`. Verdicts and the order
of observations do not depend on the count, and the report's new `workers` field
records it.

Each observation in the report also carries `steps` beside `costMs`: every
phase the subject went through, in the order it ran, with its wall time. The
collector's phases are named `collect.*` (`collect.navigate`,
`collect.wait-for-fonts`, `collect.capture`), the run's own are `inspect`,
`settle`, `baseline`, `decode`, `compare` and `write`, and a painted subject adds
the renderer's under `render.*`. The report's `steps` sums each phase over the
subjects that ran it and counts them. A phase a subject skipped is absent, not
zero. Timings are part of no digest, so images, records and baselines do not
move when only timing does.

`settleRecipe`, `compareRasters`, the raster `Renderer.render` and the route
page agent take an optional step clock and report the steps they ran.
`stepClock`, `timeOn` and `totalsOf` are exported from
`@variance-authority/core/format`.
