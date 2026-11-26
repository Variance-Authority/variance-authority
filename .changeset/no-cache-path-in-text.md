---
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

A text answer that says which record or report it read no longer prints the
absolute path of the cache file. That covers the `record of "<suite>":` line of
`covering` and `select`, the `report:` line of `ask`, the heading of
`covering --since`, and what `ask orient --files`, `ask slowest-tests`,
`ask retried-tests` and `ask not-run` say of the record and the source index.
The text names the record by its line, its commit and whose it is. The path
stays in the structured answers: `from` under `covering --format json`, and
`journal.at` under `select --format json`.
