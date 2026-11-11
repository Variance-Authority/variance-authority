---
'@variance-authority/cli': minor
---

`variance select --local` gives a smaller answer where the record cannot narrow. In place of every test file, it selects the test files that import a changed file, by the source index, or the test files in a changed file's package. stderr names which of the two it used and the test files it left, `--format json` carries them under `fell`, and the files left keep the commit they last ran at. Without `--local`, every reason still runs every test file.
