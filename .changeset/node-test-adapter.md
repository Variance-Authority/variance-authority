---
'@variance-authority/sense': minor
---

`@variance-authority/sense/node-test` records a `node:test` suite and leaves out what a change did not reach. `runNodeTest({ files })` runs the files with `node:test`'s own `run()`, one process per file, records each case under its `describe` path, and reads `VARIANCE_AUTHORITY_SINCE`: a file the record proves the change did not reach is not started, the run prints `selected N of M`, and a file that failed is recorded as incomplete and kept by the next selection. It needs Node 22.15 or newer. Bun has no `module.registerHooks`, so `bun test` is not recorded.
