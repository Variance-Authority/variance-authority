---
'@variance-authority/cli': minor
'@variance-authority/help': minor
'@variance-authority/mcp': minor
---

`variance ask symbol --name a,b,c` answers each name in the order given, the way it answers one name, with a blank line between the answers. A name nothing declares gets the answer it would get alone, in its place, and the other names still answer. A list in which no name is declared is refused the way one such name is refused. The MCP `docs_symbol` tool takes `name` as a list of names and answers it the same way; a single name given as a string is still read.
