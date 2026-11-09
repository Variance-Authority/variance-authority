---
'@variance-authority/help': patch
---

`ask grep` and `docs_grep` answer a query that matches more than about 120,000 lines in one `rg` call, such as `--query a --from packages/cli/`, where they had stopped with `Maximum call stack size exceeded`. `ask intersection` holding a `grep` or a `discover` answers the same way.
