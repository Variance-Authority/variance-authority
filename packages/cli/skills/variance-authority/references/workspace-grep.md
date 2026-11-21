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
for the next `variance index`. It shows 200 lines and counts the rest; the last
line names the `--offset` of the next page. With `--test`, the answer opens
with how many lines match in how many of the files the test entered, then lists
them under `Ran:`, `Not taken:` and `Written since the recording, so no test has
run it:`, in the same row grammar. A line not taken carries, indented under it,
the branch or function it sits in, which the test did not enter. The files the
recording did not instrument, and anything that bounds the reading, follow as
trailing `note:` lines; the three lists are paged as one.
