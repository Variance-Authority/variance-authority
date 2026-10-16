---
'@variance-authority/sense': patch
---

A file loaded from its build and its source is recorded at the source's own regions

A run that loaded one file twice, once as `src/cart.ts` and once through the
manifest as `dist/cart.js`, recorded it at the regions both readings cut. Which
readings a run loaded depends on the tests it ran, so two shards of one build
could record the same file in different regions, and folding them stopped with
`two shards cut <file> into different regions`. A file is now recorded at the
regions its own text on disk cuts into, and each reading's regions land on the
one of the same shape, else the innermost one enclosing it, else the module.
Every shard records the file alike, whichever readings of it they loaded.
