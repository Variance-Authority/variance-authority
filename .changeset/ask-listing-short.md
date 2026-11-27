---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

Bare `variance ask` prints each question in two lines: what it takes, and the
first sentence of what it answers. The listing is about half its former size.
A question's whole description is the one its MCP tool carries at `tools/list`,
which the listing's footer names.
