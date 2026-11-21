---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/cli': minor
---

`variance ask orient --files <file>` lists what each file declares at its top level, from the source index: the line, the kind, the name, and `exported` when an export of the file binds it. A class's, an interface's or a type's members follow it, one line each. A file shows at most 40 lines, and the answer counts the declarations and members it left out. A file the index holds without its declarations says so, rather than reading as one that declares nothing. The MCP `orient` tool gives the same answer, and `orientAround` in `@variance-authority/sense` returns the declarations beside the packages and external dependencies.
