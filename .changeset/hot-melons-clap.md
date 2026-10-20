---
'@variance-authority/sense': minor
---

`kept(selection, discovered, name?)` from `@variance-authority/sense/test-selection` names the test files a seam runs: those the runner discovered, less those the selection skips. `name` says each of the runner's own handles as the selection names files, and the Vitest and Jest seams both keep files by it. A file the record never saw, or never held whole, is kept.
