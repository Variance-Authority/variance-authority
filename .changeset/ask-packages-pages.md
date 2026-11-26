---
'@variance-authority/help': minor
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`variance ask packages` and `docs_packages` take `--limit` and `--offset` (`limit` and `offset` over `serve` and MCP), and show 20 rows of each list when neither is said. A list cut short ends with how many rows it left and the offset of the next page, `1168 more not shown; --offset 20 shows the next 20.`; one offset skips the same number of rows at the top of every list. On a workspace of over a thousand packages the first answer was every row of every list.
