---
'@variance-authority/cli': minor
'@variance-authority/help': minor
---

`variance ask orient` takes the files you already have, and searches no text

`orient --files <path>[,...]` (`files` on `docs_orient`) answers each file in the order you gave it: its package, or that the source index does not hold it, then what those packages take from other packages and what other packages take from them, and the recorded cases that ran each file. `--query` is gone: finding a file is what `search`, `symbol` and `grep` are for, and a call without files names them. Nothing in the answer reads a file's text, so it no longer runs `git grep` over every tracked file once per word.
