---
'@variance-authority/playwright': minor
---

A Chromium shot no longer depends on what the page painted before it

`CHROMIUM_RASTER_ARGS` adds `--disable-partial-raster`. With partial raster, an
edit repaints only the damaged part of a tile, and those pixels come out one
colour level off a whole-tile paint. A page that mounts subject after subject
could shoot the same subject two ways: a baseline taken after another subject
differed from the same baseline taken first. Every tile is now painted whole, at
no measured cost to a mount and shot.

The flag is part of the ordered launch recipe, so a baseline recorded under the
old recipe comes back as a change caused by `rasterization`, and `accept`
adopts the new image. If you copy `CHROMIUM_RASTER_ARGS` into your own
`launchOptions`, the next run does the same.
