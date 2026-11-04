---
'@variance-authority/cli': patch
---

`variance review --root <path>` reads the change of the checkout it names. It took the record from `--root` and the diff from the directory the process started in, so a review run from another checkout reported that checkout's edits. Each file's link now starts at `--root` too.
