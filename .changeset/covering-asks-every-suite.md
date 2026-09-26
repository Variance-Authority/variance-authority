---
'@variance-authority/cli': minor
---

`variance covering` asks every suite the root `variance.config.json` declares, and answers under each suite's name and kind: a suite that never loaded the file is refused as `unloaded`, and one with no recording as `unrecorded`. `--suite <name>` asks one record alone.
