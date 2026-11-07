---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`ask orient` keeps a root library on the map beside a package nested in it, and its file count covers the root's sources. A root is a library when it offers an entry, in `exports`, `main`, `module` or `bin`, and is not `private`. Any other root stays out, and that repository's map does not change.
