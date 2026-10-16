---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`ask uses` follows a name through `export type … from`

`variance ask uses --name Greet` stopped at a barrel that wrote
`export type { Greet } from './greet'` or `export type * from './types'`, and
listed the barrel as the use. Nothing that imported the name through it was
listed. Now a type-only re-export passes its names on like any other: the
barrel is not listed, each import through it is, marked `(type only)` whatever
the importer wrote, and an import reached both through a type-only re-export
and through a value one is a value use.

`variance ask orient` reads re-exports the same way. With `--files`, a name a
barrel passes on with `export { type T } from` across a package line is
counted, as any other name it passes on. The code map no longer counts a name
passed on with `export type { T } from` as what its package is taken for,
since passing a name on takes nothing.

Test selection still walks no type-only edge, so a test that reaches a file
only through `export type` is not selected for it.

The source index records, per request, whether it republishes, since
`export type … from` and `import type` of the same file share a kind. The
format moves to version 24, so an existing index is rebuilt once.
