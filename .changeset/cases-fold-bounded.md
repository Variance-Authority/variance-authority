---
'@variance-authority/sense': patch
---

Write the per-case execution index with far less time and memory

When a Jest or Vitest run records cases, the reporter now writes the index
beside the snapshot with the bounded fold, which reads the case journals a
slice at a time. On a 200-case run over a thousand ambient modules it takes
51 ms and 7 MB of heap, where building the whole index as objects first took
440 ms and 158 MB, at the end of the run, when workers have used most of the
memory. A late second frame for a case that had already settled is joined into
that case, as before. An `executionFile` ending in `.json` is written as it was.
