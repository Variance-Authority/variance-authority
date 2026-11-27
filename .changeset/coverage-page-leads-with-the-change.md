---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

The coverage page (`variance coverage --format html`) opens on what the change
did since the base: the whole ratio before and after, each suite's ratio before
and after with the regions that started and stopped running, the test files
whose reach moved and the source files where regions started and stopped
running. `coverageChange` in `@variance-authority/sense/test-selection` names
that per file, in `files`, so each side sums what the suite's parts sum. What no suite loads
is one line under it. Packages are ordered by regions not run, and the Kinds
tables are folded. On a phone the page no longer scrolls sideways: tables become
stacked rows, the header scrolls away, and no text is under 12 px.
