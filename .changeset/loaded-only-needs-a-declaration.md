---
'@variance-authority/distill': patch
---

`distill` no longer proposes mocking a module that declares nothing below its top level, such as a file of constants or a barrel of re-exports. Loading such a module runs everything it has, so `loadedOnly` is now false for it and it is not listed under "Loaded but not covered".
