---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/mcp': patch
'@variance-authority/sense': patch
'@variance-authority/server': patch
'@variance-authority/tribunal': patch
'@variance-authority/playwright-test': patch
---

What the CLI, the MCP tools, the servers and the GitHub action print is shorter. An explanation that repeated on every row now prints once, as a header or on the first line that needs it. The reasoning behind an answer stays in the source and is no longer printed. The source snapshot footer is one line, `Snapshot <time>.`

A changed file in a language the verdict does not read, such as Rust or Python, now reads as `unread (not a JavaScript or TypeScript module)` instead of as a file that does not parse. It is charged the same way.
