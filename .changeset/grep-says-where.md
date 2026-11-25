---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/mcp': patch
'@variance-authority/cli': patch
---

A `grep` answer past 200 lines says where they are

`variance ask grep` and `docs_grep` asked with a start point answer more than
200 matching lines with the folders and files that hold them: at most 20 rows,
most lines first, whose counts add up to the total. Where one folder holds most
of the lines in more parts than there are rows, the widest parts have a row each
and the others share one. The answer names the `limit` that lists every line
and, with one start point, the `discover` question that lists the files of the
first folder or file. An answer of 200 lines or fewer, or
one asked with `limit` or `offset`, is unchanged.

`Tree.scopedGrep` is required, takes `limit` and `offset` only where the
caller said them, and takes the caller's `shell` in place of `offsetFlag`.

A question an answer prints joins a flag to a value that starts with `-` with
`=`, so the printed command runs as it is. The commands `search`, `packages` and
the dependency answers print are quoted as the others are: `^`, `,`, `%` and `#`
stand plain, and an empty value or one that starts with `#` or `=` is quoted.

`@variance-authority/mcp/tools` exports `shellWord`, the quoting every printed
command shares.
