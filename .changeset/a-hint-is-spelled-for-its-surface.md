---
'@variance-authority/mcp': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

A hint names what you can type where you asked

`variance ask` and `variance-authority-help` printed the hints in their answers
the way the MCP server takes them: `a higher \`limit\` shows them`, `docs_symbol
has its signature`, `ask \`search\` with it as the query`. From a shell those
are now `--limit`, `variance ask symbol` and `--query`, and a whole question
such as the `grep` that finds an underscored name is printed as the command that
asks it. Over MCP the answers are unchanged, apart from tool names now in
backticks. A tool invocation carries the shell it was asked from as `shell`.

`--package` given a directory, such as `packages/remote`, answered that the name
was not published by it. It now says that `--package` takes a package's name or
a specifier, and names the package whose directory it is.
