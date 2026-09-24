---
'@variance-authority/cli': patch
---

Selection asks the repository's `package.json` files for `sideEffects`, so a
module a package declares is charged to every test that loads it or an importer
of it.
