---
"@variance-authority/sense": minor
"@variance-authority/cli": minor
---

`variance coverage` counts how much of the code your suites load each declared suite runs, from the case index each suite already records: one share per suite, all over the same total, how many regions more than one kind of suite runs, and how many only one kind runs. With a base, which is each suite's mainline record in the share, or `--suite <name> --against <record>`, it prints each count at the base and now, and the regions gained, lost, written and deleted that add up to the change. `--format markdown` prints a table for a job summary. It exits `0` whatever the numbers are. `countCoverage` and `coverageChange` in `@variance-authority/sense/test-selection` are the counts it prints.
