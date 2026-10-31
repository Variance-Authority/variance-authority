---
'@variance-authority/core': minor
'@variance-authority/png': minor
'@variance-authority/png-sharp': minor
'@variance-authority/raster': minor
'@variance-authority/store': minor
'@variance-authority/tribunal': minor
---

A kept baseline records `pixels`, the digest of its decoded pixels, and `compareRasters` reads it: the capture is decoded and hashed, and when the digests are equal the baseline is never decoded. `keepImage` in `@variance-authority/png-sharp` now resolves to `{ bytes, pixels }` rather than the bytes alone. The durable, remote and tribunal stores carry the digest through the sidecar; tribunal adds a `pixels` column in schema version 22. A baseline approved through tribunal's Worker records no digest yet, since the Worker cannot load sharp, and is decoded on both sides as before. Two equal images now pair each row with itself from one comparison of their bytes rather than a pass over their rows, which was most of the cost of an unchanged comparison. `pixelDigest` is exported from `@variance-authority/png`.
