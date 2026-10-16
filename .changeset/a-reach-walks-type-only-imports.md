---
'@variance-authority/core': minor
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

A reach walks type-only imports unless you name the runtime edges

`dependentsOf`, `dependenciesOf`, `affectedBy` and `carried` in
`@variance-authority/core/relate` now walk every edge kind, `type` included,
when you pass no `through`. A type-only import is still a dependency: a changed
type can break the file that imports it, and the walk said nothing about that
file. Test selection asks what a run loads, so every selection walk in Sense and
the CLI passes `RUNTIME_EDGES`, and what it selects does not change.

If you called one of these and relied on `type` edges being left out, pass
`{ through: RUNTIME_EDGES }`.
