---
'@variance-authority/mcp': minor
'@variance-authority/help': minor
'@variance-authority/cli': patch
---

`variance ask discover`, `grep` and `intersection` take `--offset` (`offset` over `serve` and MCP). When an answer has more rows than its page, it ends with how many remain and the offset that shows the next page, `2023 more not shown; --offset 50 shows the next 50.`, instead of pointing to a higher `--limit`, which showed the whole list again. A page that does not start at the first row says which rows it shows, `Rows 51–100 of 2073.`, and an offset past the last row says so. `ask grep --test` pages each suite's ran, not taken and written lines as one list. `ask stack` writes the same lines, so over `serve` and MCP it names `offset` rather than `--offset`. Questions whose answer holds several lists, such as `symbol`, `uses` and `search`, keep `--limit`.
