---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
'@variance-authority/mcp': patch
---

A `grep` start point that answers nothing is answered from the folder around it that does

`variance ask grep` and `docs_grep` asked with one start point that is not
found, or that reaches no match, say so in the first line and list the lines that
match from the nearest folder around that path with one. The folder always holds
the path and is never the root, and the exit code is as it was. An answer asked with several start points, with
`limit` or with `offset`, around which no folder has a match, or whose path has
a `.` or `..` folder in it or a `*` other than a last `/*`, is unchanged.
