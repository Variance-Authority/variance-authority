---
'@variance-authority/sense': patch
---

`ask symbol` counts a name's importers through `export *` the way ECMAScript resolves it

`ask symbol` counts each export's importers by following the files that pass
the name on. A bare `export *` now passes a name on only where the module's
export resolves to it: the file's own export of the name, and its named
`export … from` of it, come before its stars; two stars that reach different
declarations pass the name on from neither; and `default` never passes through
a star. A file with `export * from './base'` and
`export { taxOf as levy } from './tax'` is now listed as an export of `levy`
with its own importers, instead of being dropped and its importers counted
under `base`. The importers `ask uses` lists through a barrel follow the same
rule.
