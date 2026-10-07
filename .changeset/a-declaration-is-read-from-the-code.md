---
"@variance-authority/sense": minor
"@variance-authority/cli": patch
"@variance-authority/storybook-collector": patch
"@variance-authority/core": patch
---

The components a module declares are read from its code. A declaration written
in a block comment, a JSDoc example or a template literal no longer names a
component, so a commented-out `function Retired()` no longer makes its file
the one that declares `Retired`. A name is declared by a statement of the
module itself: a function, class or binding inside a function body belongs to
that function and no longer counts. An `export async function Page()`, an
abstract class, a generator, and a name that starts with a non-ASCII capital or
carries a `$` are now declared too. A file the parser cannot read declares
nothing, and its record says why.

`variance run`, `variance collect` and the Storybook collector resolve a
component to its `file:line` from the same reading, through
`indexDeclarations`, which `sense` now exports. `indexSource` in `core` stays the text scan for a caller without
`sense`.

The source index format moves to version 18, so an index written before this
release is rebuilt once instead of keeping the names it read from comments.
