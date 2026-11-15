---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`variance select --local`, and `VARIANCE_AUTHORITY_LOCAL=1` at a runner's seam,
no longer run every test file, or every test file in a package, when the record
cannot narrow. They run only the test files that import a changed file, by the
source index, and name the doubt on the first line; a changed file the index
does not hold, such as a lockfile, selects none and is named. A test file the runner
finds that neither the index nor the record holds does not run; `--format json`
names the files that run under `only`. With no diff from
any base, `--local` exits non-zero. A change to a file the suite declares in
`before` runs the whole suite. Without `--local`, every doubt still runs every
test file.
