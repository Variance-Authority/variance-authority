---
'@variance-authority/sense': minor
'@variance-authority/cli': patch
---

The edit loop's budget takes a changed file's own tests first, and a test is now a file's own only when it enters it: a test that imports the file beside another module that imports it too is ranked as an importer. `TestDistance` names the changed files a test enters as `enters`, and `select --json` carries it.
