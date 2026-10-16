---
'@variance-authority/sense': minor
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

A Rust path written in a type or an expression is a use, and `super` follows `#[path]`

`variance ask uses` now counts `crate::graph::Limits` in a field type and
`super::reach()` in a body, as well as a `use`, each resolved through the module
tree the crate's `mod` lines declare. A `self::` or `super::` path is read from
the module it is written in, an inline `mod` included, and a file a `#[path]`
loads keeps its children beside it, so a `use super::catalogue::Catalogue` in a
file put beside its parent reaches the parent's sibling. A test or example
target that no module declares is its own crate root. The item a path names is
the one segment past its modules: `crate::map::JourneyMap::new()` counts
`JourneyMap`, and neither a private `fn map` nor a module's `fn new`.

`ask uses` and `ask symbol` answer a name a file keeps to itself beside an
export of the same name in another file: the kept declaration, and for a Rust
item the modules inside its own that import it, follow the export's answer
instead of being dropped.

The source index format is version 25. It keeps whether a reader guessed a
request and whether it asked for an item, so a parse read back from the index
is the parse the reader made. An index written by an earlier version is rebuilt
on the next read.
