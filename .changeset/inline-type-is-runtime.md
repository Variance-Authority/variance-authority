---
'@variance-authority/sense': patch
---

`import { type X } from './x'` is a runtime import

A request is `type` only when its statement is written `import type` or
`export type`, and a re-export only when every statement naming it is. An import
whose names are all marked `type` inline stays a runtime edge, because under
`verbatimModuleSyntax` TypeScript emits `import {} from './x'` and the module
loads; which setting applies is in a `tsconfig` the scan does not read. Each
binding still says it is a type. The JavaScript and native scans agree on this,
and the source index moves to version 7, so a parse cached under the old rule
is parsed again rather than read.
