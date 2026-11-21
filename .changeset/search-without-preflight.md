---
'@variance-authority/help': minor
'@variance-authority/cli': patch
---

Answer source searches without a speculative candidate pass

The CLI and help binary count published importers lazily during the requested
search, using the workspace value already opened with its search index.

`readSearchForAnswer` returns that value as `help`. Callers using the removed
`SearchReading.value`, `ValueRead`, `countingShown` or `ShownCounting` API should
use `reading.help` and `importingOf(reading.help, root)` from the tools export.
