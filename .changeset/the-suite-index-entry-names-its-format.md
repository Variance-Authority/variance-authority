---
'@variance-authority/cli': patch
---

`variance share --publish` writes the suite index as `suite-index-v2`, the
format its bytes are in. It was written as `suite-index-v1`, so a CLI that reads
only version 1 fetched it and failed to decode it, instead of saying `it holds
suite-index-v2, a format this version does not read`. `variance share`, and
every command that reads the mainline's suite index, reads `suite-index-v2` and
still reads a line that holds `suite-index-v1`.
