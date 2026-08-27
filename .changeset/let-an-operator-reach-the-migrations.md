---
'@variance-authority/tribunal': minor
---

Export `MIGRATIONS` and `INITIAL_VERSION` from the package entrypoint.

The README sends an operator whose database is already deployed to `MIGRATIONS`
— "what an existing database needs is the part it is missing" — and the constant
lived in a private module. The entrypoint offered `SCHEMA`, which fails on the
first `CREATE TABLE` against that database by design, and nothing else. There
was no way to reach the steps from outside the package.

`INITIAL_VERSION` goes with it, because `MIGRATIONS` is indexed against it: step
`i` lands on `INITIAL_VERSION + i + 1`, so a database reporting `schema_version`
`n` needs every step from `n - INITIAL_VERSION` on.
