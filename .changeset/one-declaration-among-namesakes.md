---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`variance ask uses --file <path>` answers for the declaration in that file alone when several files declare the name. Without it, the answer names each file that exports the name without publishing it, and a `--file` that declares nothing by the name is answered with the files that do.
