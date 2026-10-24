---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

A crate item answers beside a published name of the same name

`ask symbol` and `ask uses` dropped every export no entry publishes as soon as
any package published the name. `ask symbol --name Reached` named
`@variance-authority/core`'s interface and a private struct, and never the
`pub(crate) enum Reached` of `resolve_export.rs`. Every export that reaches a
declaration in another file is now answered after the published one.

`ask uses` answers each exporting file on its own, with the imports whose path
resolves to it, where two exports of one name were one list. A `use
crate::pick::Reached` counts for the `Reached` that `pick.rs` declares and no
other. Two private declarations in two files say their imports per file:
`Imported from <file> in N places.` A Rust answer ends by naming what no path
says, a glob `use`, a method and a macro, and points at rust-analyzer's
find-references for them.
