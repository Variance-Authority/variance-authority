---
'@variance-authority/cli': minor
---

`variance review --suite <name>` reads the record of the suite you name. Without it, `review` reads the only suite the root `variance.config.json` declares, and refuses when several are declared, the same rule `select` and `run --since` follow.
