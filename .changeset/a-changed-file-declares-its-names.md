---
'@variance-authority/sense': patch
---

`symbol` and `uses` answer for a name declared in a file you changed since the last index

`variance index` on a branch reads again only the files that changed, and it
read them without their top-level declarations. A function a changed file
declares and does not export was then unknown to `symbol` and `uses`, which
said *The declarations of N files were not read into the source index* and
named exactly the branch's changed files. The update now reads each changed
file's declarations with it, from the working tree's content, so those
questions answer for the files a branch is working on.
