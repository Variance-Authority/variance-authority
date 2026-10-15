---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

A repository says which `tsconfig` governs resolution, or that none does

`"typescript": { "tsconfig": … }` in the root `variance.config.json` takes
`"auto"`, the default, which reads the config that governs each file; a path
from the repository root, which reads that config and the projects it
references; or `false`, which reads none, so a scan follows no `paths` and adds
no `customConditions`. A scan, the source index and the taint graph all read
it, and `tsconfig: false` is accepted by `scanRelations` and `resolversFor`
too.

`variance doctor` names the configs in the repository that ask for `paths`,
`baseUrl` or conditions, those that can govern the directory it runs in first, and suggests
`false` only when none in the repository does.
