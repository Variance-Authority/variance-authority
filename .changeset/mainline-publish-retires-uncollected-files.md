---
"@variance-authority/cli": patch
"@variance-authority/sense": patch
---

A mainline publish with `--collected` retires every test file the record holds
and the runner no longer collects: its row, what it crossed, its cases and
their Eyes journals leave the published record, and `variance share --suite`
says how many it retired and names one. A record is laid over the one before
it, so a test file that was deleted, renamed or moved to another suite kept its
row in every record after, and every reader carried it: `variance select` read
each file changed since it last ran as changed for it. A runner list that
names none of the record's test files is refused, rather than retiring every
row.
`collectedRecord` in `@variance-authority/sense/test-selection` makes the cut.
