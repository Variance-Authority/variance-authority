---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance coverage --packages` gives each package one row of coverage over its own regions, parted by its own tests, by each kind of suite, by how many imports away the nearest test that ran a region stood, and by what only other packages' tests ran; `own tests` and `only others'` are now shares of the package's regions, not of what ran. A package's coverage no longer counts its test files as its code. `coverageByOwner` takes the walked hops and counts `kinds` and `nearest` per file.
