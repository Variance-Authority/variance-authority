---
'@variance-authority/help': patch
'@variance-authority/mcp': patch
'@variance-authority/cli': patch
---

The MCP tool definitions are shorter. Each says what the tool answers, what it takes and when to pick it over its neighbours; the layout of each answer is left to the answer and the skill references. `tools/list` on `variance-authority-help .` sends 19,617 bytes for its 19 `docs_*` tools, down from 34,766, and `variance serve` sends 32,266 bytes for its 34 tools, down from 48,186.
