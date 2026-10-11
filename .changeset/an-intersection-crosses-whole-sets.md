---
'@variance-authority/cli': minor
'@variance-authority/help': minor
'@variance-authority/mcp': minor
---

`variance ask intersection` answers the files in every one of several sets

Each set is read whole, with no cap: what a path reaches (`--from`) or what
reaches it (`--to`), who imports a name (`--imports module#name`, through the
barrels that pass it on when the module is a file, as `ask uses` reads it), who
declares a name matching a pattern (`--declares`), and a path pattern (`--path`). Each
has an `--except-` twin that takes its files out, and `--text` runs ripgrep over
the files the other sets kept. The answer lists the files nearest the paths
first, each with the line that put it in each set.

`readTree` hands each file's declared and imported names to a `names` callback
during the same scan, read off the parse it already made; a file whose parse
holds no declarations, as on a checkout large enough for the addon to read
whole, is read again for them, and the source index keeps what that read
found. `readNamedTree` takes the question and reads names only for an operand
that needs them. Over MCP,
`docs_intersection` answers `from`, `to`, `path` and a name imported out of a
repository file, and refuses `declares` and any other `imports`, because the
reading an MCP host serves holds no names.
