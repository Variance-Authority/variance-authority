---
'@variance-authority/help': patch
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`ask symbol` answers a member in every language the scan reads, beside any namesake

`variance ask symbol --name doc_of_symbol`, a method in a Rust `impl`, answered
that no file declares it, and so did a Java method such as `premain`: the
tree-sitter readers recorded no members. A TypeScript member was answered only
when nothing else declared the name, so a top-level function or an export of
the same spelling hid it.

The Rust, Java, Kotlin, Swift and Python readers now record the members of each
type, on the type that holds them: a Rust struct's fields, an enum's variants,
the items of a trait and of an `impl` (on the type the `impl` is for); a Java
or Kotlin type's fields, methods, constants and record components; a Swift
type's or extension's properties, functions and cases; a Python class's
attributes and methods. A constructor is left out.

`ask symbol` answers every member declaration after the name's other answers,
whichever comes first: its container, the file and line, the package, and the
line as the checkout writes it, the first five and a count of the rest. The
source index format moves to version 27, so the next `variance index` reads
these files again rather than keep the parses that held no members.

`ask uses` lists these declarations with the TypeScript ones. Only the
JavaScript and TypeScript reader records the lines that use a member, so for a
declaration in another language it says those uses are not recorded, rather
than that no line uses it, and routes to the text search.
