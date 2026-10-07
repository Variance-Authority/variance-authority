---
"@variance-authority/core": minor
"@variance-authority/mcp": minor
"@variance-authority/help": patch
---

`didYouMean` and `nearest` are exported from `@variance-authority/core` and no
longer from `@variance-authority/mcp/tools`. Import them from
`@variance-authority/core`. A mistyped command or flag is refused, with the
nearest right one, without loading the MCP server's tools.
