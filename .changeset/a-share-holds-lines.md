---
'@variance-authority/core': minor
'@variance-authority/store': minor
---

A share holds lines only. `SharedCache`, `SharedHit`, `neverFails`, `shareKey`, `firstShared`, `memoryShare`, `httpShare` and `HttpShareOptions` are removed from `@variance-authority/core/share`, and `createDirectoryShare` from `@variance-authority/store/share`. Use `httpLineCell`, `memoryLineCell`, `createDirectoryLineCell` or `createGitLineCell` with `publishLine` and `readLine`: a line keeps the latest entries a mainline or a branch published, and a miss says why. `neverFails` in `@variance-authority/raster` is unchanged.
