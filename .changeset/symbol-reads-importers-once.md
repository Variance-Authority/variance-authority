---
'@variance-authority/sense': patch
'@variance-authority/help': patch
---

`ask symbol` reads who imports a name once for all the files that declare it,
default exports included, rather than once per declaration, with the same
answer. `importersOf` takes the asked files as `{ file, name }` pairs and also
says, in `byFile`, what each pair answers alone.
