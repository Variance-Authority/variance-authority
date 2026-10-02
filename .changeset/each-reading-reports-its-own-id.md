---
"@variance-authority/sense": patch
---

A Vitest run that loads one module as its source and as its build credits each
test with the regions it ran. Both readings are recorded under `src/cart.ts`,
and reading the build's crossings against the source's region table credited a
test that ran the build with a branch it never took. Each
reading's probes report under the file the transform was handed, and the record
holds the regions both readings cut, with each reading's crossings read through
its own table.
