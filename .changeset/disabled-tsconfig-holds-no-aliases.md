---
"@variance-authority/sense": patch
---

Skip TypeScript alias collection when `typescript.tsconfig` is `false`. Disabled aliases no longer multiply each import's cached directory witnesses, which could exhaust memory while indexing a large monorepo.
