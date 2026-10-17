---
'@variance-authority/help': patch
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`ask symbol` answers a Java, Kotlin, Swift or Python member, and a member beside its namesake

`variance ask symbol --name premain`, a method of a Java class, answered that
no file declares it: the tree-sitter readers recorded no members. A TypeScript
member was answered only when nothing else declared the name, so a top-level
function or an export of the same spelling hid it.

The Java, Kotlin, Swift and Python readers now record the members of each
type, on the type that holds them: a Java or Kotlin type's fields, methods,
constants and record components; a Swift type's or extension's properties,
functions and cases; a Python class's attributes and methods. A constructor is
left out.

`ask symbol` answers every member declaration after the name's other answers,
whichever comes first: its container, the file and line, the package, and the
line as the checkout writes it, the first five and a count of the rest. The
source index format moves to version 30, so the next `variance index` reads
these files again rather than keep the parses that held no members.

`ask uses` lists these declarations with the TypeScript ones. These readers
record no line that uses a member, so for such a declaration it says those uses
are not recorded, rather than that no line uses it, and routes to the text
search.
