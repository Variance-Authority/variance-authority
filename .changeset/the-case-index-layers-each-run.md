---
"@variance-authority/sense": patch
---

A run of one test file no longer erases every other case from the case index

`cases.bin` held the last run's cases and nothing else. After `vitest run
src/cart.test.ts`, `covering` and both editors marked every region that file did
not reach as unwalked, even though the rest of the suite reaches it. The index is
now updated the way the snapshot is. A test file that ran to the end has its
cases replaced. A file that did not finish keeps its old cases, and the ones that
ran again are updated. A test file that is gone from the checkout loses its
cases. Every other case is kept. Kept cases are matched to the regions recorded
now by name, structural path and kind. A region that no longer matches drops
them instead of moving them to a guessed place.

Two files now sit beside the index. `cases.last.json` names the run that wrote it
last: its commit, time, test files and cases. `cases.before.bin` holds what the
index had for those test files before the run replaced them.
