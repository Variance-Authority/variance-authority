---
'@variance-authority/help': minor
'@variance-authority/cli': minor
'@variance-authority/mcp': minor
---

`ask search` and `ask symbol` take `--limit`

`--limit <n>` sets how many rows each list of the answer shows, so a cut list can be read whole. MCP clients pass it as `limit` to `docs_search` and `docs_symbol`. Without it, each list keeps its own cap. For `search`, that is 40 published names, 20 installed ones, 25 of each other kind, and 15 loose or described ones. For `symbol`, it is 5 declarations or members of each kind, and 100 installed declarations. `--format json` applies the same caps.

Every line that counts the rows left out now says that a higher `--limit` shows them. That line used to read, for example, "2 more declarations of `keyOf` not shown." and now reads "2 more not shown; a higher `--limit` shows them.". Without `--limit`, the rows and the counts are unchanged.

`@variance-authority/mcp/tools` exports `notShownPast` and the `Rows` a cut line names, and `notShown` takes `rows`.
