---
'@variance-authority/sense': minor
---

Jest selects from a change.

`@variance-authority/sense/jest` wraps a Jest configuration the way the Vitest
seam wraps one: the project's transformer — `@swc/jest`, `ts-jest`,
`babel-jest` — still runs first, its setup files and reporters stay in their
order, and probes land on the transformed text. The probes ride Jest's own
transform cache, so an unchanged module is neither transformed nor parsed again
on a later run or in another worker, and the record of what its probes mean
lives beside the cached text under the same key. Each test file journals to
disk from `afterAll`, the reporter folds the journals when the run completes,
and the result lands in the snapshot the Vitest and journal seams write. A
file two projects of one run transformed under different options has two
inventories, and the reporter records it as one the build could not read rather
than fold one project's tests into the other's regions.
