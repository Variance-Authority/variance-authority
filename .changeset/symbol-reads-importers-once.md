---
'@variance-authority/sense': minor
'@variance-authority/help': patch
---

`ask symbol` reads who imports a name once for all the files that declare it
and that no entry publishes, default exports included, rather than once per
declaration, with the same answer.

`importersOf` in `@variance-authority/sense` now takes groups of
`{ file, name }` pairs in place of files and one name, and follows each group
as one question: its `uses` and `through` are in `groups`, one entry per group
in the order asked, where they were at the top of the answer. A caller that
passed `(root, files, name)` passes `(root, [files.map((file) => ({ file, name }))])`
and reads `groups[0]`.
