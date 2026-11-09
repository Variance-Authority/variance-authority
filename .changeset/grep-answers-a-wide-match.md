---
'@variance-authority/help': patch
---

`ask grep` and `docs_grep` answer a query that matches more than about 120,000 lines, where they had stopped with `Maximum call stack size exceeded`. `ask discover --text` and `ask intersection` answer such a query the same way.
