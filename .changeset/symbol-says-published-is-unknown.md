---
'@variance-authority/cli': patch
'@variance-authority/help': patch
---

`variance ask symbol` no longer calls a name unpublished when its package declares an entry the reading could not follow to a source file, as a build output no tsconfig names. It says whether the name is published is not known.
