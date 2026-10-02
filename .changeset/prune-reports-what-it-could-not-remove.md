---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A cache prune that cannot remove an entry now says so. `applyPrune` returns each such entry in `unremoved`, with its error, and `prunedLine` prints one line for it: `cache: could not remove <path>, <rule>: <error>`. `variance prune` exits 2 when any entry stayed, where it used to print `cache: nothing to prune` and exit 0.
