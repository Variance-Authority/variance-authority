---
"@variance-authority/sense": patch
"@variance-authority/cli": patch
---

Instrumented code, worker journals and module records name every module by its repository-relative path, and the cache no longer keeps `names.bin`. Every record file already stores its paths in its own sorted table, so a `coverage.bin` or `journeys.bin` reads the same on any machine and needs no table from the one that wrote it. A Jest run no longer transforms a file a second time after its first recorded run, because the module's id is no longer part of the transform's cache key. The first run after upgrading transforms every file once, as Jest's cache key changes.
