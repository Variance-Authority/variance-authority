---
'@variance-authority/cli': minor
---

`variance view` writes the whole execution record as one page to open from disk

The page carries the record compressed and reads it in the browser, with
nothing cut: every test file, case, source file, region and precondition, the
run before where the record kept it, and every other section as it is stored.
Each table filters and sorts, and every name opens what it holds. The file is
self-contained, asks no network, and the command prints its path and starts no
browser.
