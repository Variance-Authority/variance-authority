---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance coverage --packages` leads with each package's coverage over its own regions, parted by its own tests, by each kind of suite, and by how many imports away the nearest test that ran a region stood. `coverageByOwner` takes the walked hops and counts `kinds`, `nearest` and `unmeasured` per file.
