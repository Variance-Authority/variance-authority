---
'@variance-authority/cli': minor
'@variance-authority/sense': patch
---

`variance select --since <mainline> --tested <commit>` selects a merge queue's group of one by what both sides of its merge reach: a test file only the pull request's change or only the mainline's change reaches is skipped and named with the side that ran it, a lockfile change on either side runs what it reaches, and anything but a HEAD whose tree is that clean merge, by a merge commit or a squash, from one merge base and with a clean working tree, selects as without `--tested`, with a note saying why. A side reaches a test through the record's lines and through HEAD's imports; a side that changes a file the record holds nothing about or cannot place, reaches a file whose imports HEAD's graph cannot all read, or changes a file the merge holds under another path, selects as without `--tested`. When the selection without it reads no record or already runs every test file, a note says `--tested` did nothing. `readByInstall` from `@variance-authority/sense/test-selection` says whether a path is a lockfile or a manifest.
