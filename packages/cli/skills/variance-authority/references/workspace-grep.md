# `grep`

Use it when there is no name to ask for: a local variable, a string literal, an
error message, a comment. It needs `--from` or `--to`, and searches the files
that start point names and reaches along the imports, and the modules a test
loads for real beside its mocks, so say the file or folder
you are working in, or a top folder at the widest. The root is no start point.
A file outside the source is never searched, and a path that holds only such
files is refused as not found: run `rg` on it. The query is a ripgrep regular expression: to match a literal, escape each of
`\.+*?()|[]{}^$` with a backslash, as `--query 'a\(b'` matches `a(b`.
Binary files contribute no text matches; BOM-encoded text is decoded by
ripgrep's search engine before matching.

The answer opens with how many lines matched in how many files. Lines come
grouped by how many imports away from the start point their file is, then by
path and line. A file with one matching line is `path:line: text`; a file with
several is its path, then each line indented as `line: text`. The area it
searched follows as a trailing `note:` line. The imports are the
ones `variance index` resolved, so the answer names its generation; it is asked
again of the checkout as it is when a file of the area changed since. A file
written since, under a folder it starts from or importing into its area, waits
for the next `variance index`.

200 matching lines or fewer are all listed. Past that the answer says where they
are: at most 20 rows, each a folder or a file with how many lines match under it,
most lines first. Where the matching files are not all equally far from the start
point, a row also says how many imports away its nearest file is. The rows count
every matching line once: a folder with most of the lines and more parts than there are
rows gets a row for each of its widest parts, and one row, `the rest of <folder>`,
for the others. Below them it names the `--limit` that lists every line and,
where one start point was given, the `variance ask discover` question that lists
the files of the first row that is not a rest. Say `--limit` or `--offset` and it lists that many
lines, counts the rest, and its last line names the `--offset` of the next page.

```
$ variance ask grep --query spell --from packages/help/src/index.ts
781 matching lines in 243 files, by path, most lines first:
packages/sense/native/src/ — 291 lines in 95 files, nearest 6 imports away
packages/help/src/tools/ — 237 lines in 27 files, nearest 1 import away
packages/sense/src/ — 142 lines in 71 files, nearest 2 imports away
packages/mcp/src/tools/ — 57 lines in 17 files, nearest 3 imports away
…
note: In 1089 file(s) reachable from `packages/help/src/index.ts` along the imports, at any depth — 1 named by the path itself. 4 file(s) in it import something the scan could not resolve, so what lies behind those is not enumerated.
`variance ask discover --from packages/help/src/index.ts --path '^packages/sense/native/src/' --text spell`: the 95 matching files under `packages/sense/native/src/`
`--limit` 781: every line, nearest first
```

With `--test`, 200 lines are listed and the rest counted. The answer opens
with how many lines match in how many of the files the test entered, then lists
them under `Ran:`, `Not taken:` and `Written since the recording, so no test has
run it:`, in the same row grammar. A line not taken carries, indented under it,
the branch or function it sits in, which the test did not enter. The files the
recording did not instrument, and anything that bounds the reading, follow as
trailing `note:` lines; the three lists are paged as one.
