---
'@variance-authority/cli': minor
---

`variance select --since <mainline> --tested <commit>` selects a merge queue's group of one by what both sides of its merge reach: a test file only the pull request's change or only the mainline's change reaches is skipped and named with the side that ran it, a lockfile change on either side runs what it reaches, and anything but that clean merge at HEAD selects as without `--tested`, with a note saying why.
