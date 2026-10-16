---
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

`search` finds a name its file keeps to itself by words its name or doc holds apart

`variance ask search` found a declared, unexported name only when its name or
its doc comment held the query as one run of text. A private helper is
looked for by what it does, in your own words and your own order, so
`variance ask search --query 'process the program again'` missed:

- `function relaunch` under "Start the program again in a process of its own.";
- the same doc on a Rust `fn rerun`;
- the same doc on a Python `_reopen`.

Such a name now joins the section that follows an empty answer. The section
lists the names holding at least half of your words by stem, and the private
name is read by the same rule as an exported one:

```text
relaunch [function] — @acme/kit · packages/kit/src/money/restart.ts:4 [holds: again, process, program]
```

The section is now ordered by how many of your words a name holds, and only
then by how many its own name holds. A doc that says every word you asked now
ranks above a name that says half of them. In `--format json`, a `described`
row of such a name has `source: "declared"`.
