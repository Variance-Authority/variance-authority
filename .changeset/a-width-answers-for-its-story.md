---
'@variance-authority/cli': patch
---

A merged run no longer fails a story that splits by width: an observation at a width now answers for the story another shard left to its owner. A width the owner could not read still fails.

A visit that fails under a `--subjects` glob naming one of the story's widths is now reported as `failed`, where it was recorded as outside the glob and the run passed.
