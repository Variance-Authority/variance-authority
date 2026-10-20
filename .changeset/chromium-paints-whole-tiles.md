---
'@variance-authority/playwright': minor
'@variance-authority/playwright-test': minor
---

A Chromium shot no longer depends on what the page painted before it

`CHROMIUM_RASTER_ARGS` adds `--disable-partial-raster`. With partial raster, an
edit repaints only the damaged part of a tile, and those pixels come out one
colour level off a whole-tile paint. A page that mounts subject after subject
could shoot the same subject two ways: a baseline taken after another subject
differed from the same baseline taken first. Every tile is now painted whole:
240 mounts and shots on one page took 23.9 ms each with the flag and 24.0 ms
without it.

The flag is part of the ordered launch recipe, so a baseline recorded under the
old recipe comes back as a change caused by `rasterization`, and `accept`
adopts the new image. If you copy `CHROMIUM_RASTER_ARGS` into your own
`launchOptions`, the next run reports the same `rasterization` cause. A launch
list that spells the flags out by hand keeps the old recipe until you add
`--disable-partial-raster` to it.
