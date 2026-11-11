---
'@variance-authority/cli': minor
'@variance-authority/sense': patch
---

`variance select --since <mainline> --tested <commit>` selects a merge queue's group of one by what both sides of its merge reach: a test file only the pull request's change or only the mainline's change reaches is skipped and named with the side that ran it, a lockfile change on either side runs what it reaches, and anything but that clean merge at HEAD selects as without `--tested`, with a note saying why. A side reaches a test through the record's lines and through HEAD's imports, and a side that changes a file the record holds nothing about selects as without `--tested`. `readByInstall` from `@variance-authority/sense/test-selection` says whether a path is a lockfile or a manifest.
