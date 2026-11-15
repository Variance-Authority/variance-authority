---
'@variance-authority/sense': minor
'@variance-authority/help': patch
---

`ask symbol` reads who imports a name once for all the files that declare it
and that no entry publishes, default exports included, rather than once per
declaration, with the same answer.

`importersOf` in `@variance-authority/sense` now takes groups of
`{ file, name }` pairs in place of files and one name: each group is followed
as one question, and `apart` says what each group answers alone. A caller that
passed `(root, files, name)` passes `(root, [files.map((file) => ({ file, name }))])`.
