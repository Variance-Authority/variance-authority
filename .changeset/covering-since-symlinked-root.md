---
'@variance-authority/cli': patch
---

`variance covering --since` resolves a symlinked `--root`

`variance covering --since` resolves a symlinked `--root` before making paths
relative to it, so changed paths no longer print as `../../private/var/...`.
