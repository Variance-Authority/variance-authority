---
"@variance-authority/cli": patch
"@variance-authority/help": patch
"@variance-authority/mcp": patch
---

`ask orient --files` shows three declaration entries per external dependency
and counts the rest. Its printed `--declarations` command expands every entry
without changing import evidence or the index.
The expansion is spelled for the calling CLI or MCP surface; standalone CLI
boolean switches are read from the shared question schema.
