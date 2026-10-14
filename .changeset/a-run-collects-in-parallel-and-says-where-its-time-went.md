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
are files: two on a 4-vCPU CI runner, eight on a 16-core laptop. A `concurrency`
you set holds it lower, since every world keeps a page and a subject in flight.
A `workers` you set still wins over both. Set `workers: 1` for a server under
test that cannot take concurrent pages. A collector with no `openWorker` still
collects in one world, and the run warns about it only when you set `workers`. Verdicts and the order
of observations do not depend on the count, and the report's new `workers` field
records it. `variance collect` takes the same width.

A changed subject read in a second world is now run alone like one read in the
first. A worker opens no clean world of its own, so the run asked the worker and
reported "not re-run alone: collector has no `collectAlone`"; it now asks the
collector that can open one.

The `alone.limit` budget now goes to the first subjects to change in the order
the run takes them. It went to whichever changed subjects reached it first, so
with more changed subjects than the limit, which ones carried `again` and
`alone` evidence depended on the number of worlds and on timing.

Each observation in the report also carries `steps` beside `costMs`: every
phase the subject went through, in the order it ran, with its wall time. The
collector's phases are named `collect.*` (`collect.navigate`,
`collect.wait-for-fonts`, `collect.capture`), the run's own are `compose`,
`inspect`, `settle`, `baseline`, `cache.get`, `cache.put`, `decode`, `compare`,
`write`, `again.collect` and `alone.collect`, and a painted subject adds the
renderer's under `render.*`. The report's `steps` sums each phase over the
subjects that ran it and counts them. A phase a subject skipped is absent, not
zero. Timings are part of no digest, so images, records and baselines do not
move when only timing does.

`settleRecipe`, `stabilizeForObservation`, `compareRasters` and the raster
`Renderer.render` take an optional step clock and report the steps they ran on
it. The route page agent and `readRoute` always return the steps they took.
`stepClock`, `timeOn` and `totalsOf` are exported from
`@variance-authority/core/format`.

A run that is not sharded now reads the mainline's subject costs at every
width, as a sharded run always did, and takes its slowest files first. One
world takes its subjects in the same order as several, so the budget above
reaches the same subjects.

`concurrency` is split evenly across the worlds and rounded up, at least one
per world, so by default the raster tier is as wide as the number of worlds.
