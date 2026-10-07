---
"@variance-authority/sense": patch
---

The components a module declares are read from its code. A declaration written
in a block comment, a JSDoc example or a template literal no longer names a
component, so a commented-out `function Retired()` no longer makes its file
the one that declares `Retired`. A name is declared by a statement of the
module itself: a function, class or binding inside a function body belongs to
that function and no longer counts. An `export async function Page()` is now
declared, as every other function is. Both ways sense builds a record give the
same answer.

The source index format moves to version 17, so an index written before this
release is rebuilt once instead of keeping the names it read from comments.
