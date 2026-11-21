---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/cli': minor
---

`variance ask orient --files <file>` lists what each file declares at its top level, from the source index: the line, the kind, the name, and `exported` when an export of the file binds it. A class's, an interface's or a type's members follow it, one line each. Members are read from JavaScript and TypeScript only, and a file in another language says so. A file shows at most 40 declaration and member rows, and one line counts the declarations and members it left out. A file the index holds without its declarations says so, rather than reading as one that declares nothing. The MCP `orient` tool gives the same answer, and `orientAround` in `@variance-authority/sense` returns the declarations beside the packages and external dependencies.
