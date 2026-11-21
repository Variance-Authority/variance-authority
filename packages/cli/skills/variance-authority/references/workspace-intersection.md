# `intersection`

Use it when each fact is already a question you could ask alone, and the
answer is the files all of them agree on: *the declaration of `selectBalance`*
is `symbol`, *what the wallet reaches* is `discover --from`, and the one
declaration the wallet can reach is the file both answer. Each operand is a
whole question, typed in quotes the way it would be asked alone, and any
question whose answer is a set of files can be one: `symbol`, `uses`,
`search`, `grep`, `discover`.

```bash
variance ask intersection 'symbol --name selectBalance' 'discover --from src/Wallet.tsx'
variance ask intersection 'search --query token --from src/' 'search --query refresh --from src/'
```

Each question is read whole, before display caps: the file two questions agree
on can sit past the cap of either. A `search` operand includes the same
workspace candidates as the standalone search: declarations, import aliases,
recorded test names, and described or loose candidates when those sections
run. Every matching file of a grouped name participates. Each common file labels
near and loose search matches beside the operand they came from. A file with both
query matches and near candidates lists both; composition does not make a candidate
exact. Installed dependency names
identify no workspace file. The query's area and fallback rules still apply. The
answer opens with how many files are in all of them, `N files in all of them:`,
then counts each question's files, then lists one row per file: its path, then
the lines that put it in each question, numbered by question and split by `·`,
or `the file` when a question answers a file without a line, as in
`src/Wallet.tsx — 1: line 4 · 2: the file`. It shows 50, and the count is always
of all of them; `--offset` shows the next page, as its last line names.
`--changed-file` and `--taint-file` are said once, after `intersection`,
outside the quotes: every question is answered over one reading.

A question about a name nothing declares answers no file: the answer says so
beside that question, with what was read, and that no file is in all of them,
on stdout with exit `0`, as the question alone would.

A question whose answer is not a set of files — `packages`, `stack`, another
`intersection` — is refused with the questions that are, and so is a question
about a run. Crossing `discover`'s own sets is cheaper asked as one `discover`.
