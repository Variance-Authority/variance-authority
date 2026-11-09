---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance coverage --packages` gives each package one row of coverage over its own regions, parted into what its own tests ran within one import hop, what only its own tests further away ran, what only other packages' tests ran, and what nothing ran, with a column per kind of suite of what its own tests ran, an `all` row over every package, and a line counting the regions that ran before reach, which are in the coverage and in no part. A package's coverage no longer counts its test files as its code. `coverageByOwner` takes the walked hops and counts `kinds` and `near` per file over the file's own package's tests, and `kinds` is absent when a counted suite has no kind; `withoutTests` leaves out the modules a suite runs as tests.
