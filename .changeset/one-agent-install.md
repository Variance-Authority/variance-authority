---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/mcp': patch
---

The docs print one way to connect an agent in a git repository with no config: install, `variance index`, an MCP entry that launches through `npx`, and a line that lists the tools. MCP entries no longer name a bare binary, which a client cannot find on its own `PATH`, and `variance serve` and `variance doctor` are named with the config they need.
