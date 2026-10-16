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

An exact `--function X` now also answers the callbacks recorded under it, as
`X/…`, since they run inside `X`.

A line whose edit charges the module's own region is answered with the cases
that loaded the file, and the answer now says it is at file grain: `At file
grain` in text, `grain: "file"` in JSON. That is a module-level statement, and
also the first or last line of a top-level function, which selection charges to
the module as well. In a run of lines, the lines at file grain are listed in
`fileGrain`, and the lines no recorded region holds, such as imports or types,
in `outside`. In a run asked against edited text, the lines written since the
recording are listed in `written` and left out.

`--hops` measures a run of lines and every `--function`, exact name or scope,
from the file: a hop runs from the file to a test file.
