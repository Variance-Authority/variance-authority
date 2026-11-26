---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

A text answer that says which record or report it read no longer prints the
absolute path of the cache file. That covers the `record of "<suite>":` line of
`covering` and `select`, the `report:` line of `ask`, the `--since` heading of
`covering` in `text` and `refs`, the empty whole-file `covering` answer, the
`covering --cases last` line that says no run came before to compare, and
what `ask orient --files` says of its recorded cases and the source index. The
text names the record by its line, its commit and whose it is. The path stays
in the structured answers: `from` under `covering --format json`, and
`journal.at` under `select --format json`.
