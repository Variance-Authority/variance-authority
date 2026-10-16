---
'@variance-authority/cli': minor
'@variance-authority/mcp': minor
'@variance-authority/sense': minor
---

`variance covering` answers a run of lines and a scope, and says when an answer is at file grain

`--line 40-60` asks which cases entered a run of lines. It lands on the
regions an edit to those lines charges, the same ones `variance select` reads.
`--function Cart` asks about a class or any other scope: every case that entered
a recorded function under it, such as `Cart/total`. The `variance_source_tests`
MCP tool takes a scope the same way.

A line held only by the module's own top-level region, such as a module-level
statement, is answered with the cases that loaded the file, and the answer now
says it is at file grain: `At file grain` in text, `grain: "file"` in JSON. In a
run that also holds finer lines, the file-grain lines are listed in
`fileGrain`. In a run asked against edited text, the lines written since the
recording are listed in `written` and left out.
