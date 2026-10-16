---
'@variance-authority/sense': minor
'@variance-authority/help': minor
---

`ask uses` lists the lines of the file that declares a name

A file uses what it declares without importing it, so `ask uses` and
`docs_uses` answered a helper called three times in its own file with "nothing
imports it". The scan now records, with each TypeScript, JavaScript and Rust
file's parse, every line that uses a name the file declares at its top level:
a call, a read, a type, a Rust `self::name` path, and a test module's
`use super::*`. The answer lists them after the imports, under
`Used in the file that declares it`, for a name the file exports and for one it
keeps. The lines follow the language's scope: a parameter, a local or an inner
item of the same name is another name, and the declaration is not a use. A
Python, Swift, Java or Kotlin file is still answered by its imports alone.

The source index format moves to version 24, so the first scan after the
upgrade reads every file again.
