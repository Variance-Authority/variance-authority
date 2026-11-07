---
'@variance-authority/cli': patch
'@variance-authority/store': patch
---

`@variance-authority/store/durable` loads `@variance-authority/png` only when a baseline is written or read, so `variance --version`, `--help`, `index`, `select`, `ask uses`, `ask symbol` and `ask search` no longer load it before they answer. They still load `@variance-authority/raster`, whose error the store refuses a config's `baselines.path` with.
