---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/mcp': minor
---

`ask uses` answers from the imports the index resolved, and guesses nothing else

`variance ask uses`, `ask symbol` and `docs_uses` no longer end with the files
whose import the source index resolved to no file and that "could take the
name", nor, for a name no file here declares, with the packages outside the
workspace it is imported from and a `discover --imports` question. An import
the index resolved to no file resolves to none when the question is asked
either, so both lines were a guess at question time; the answer now lists the
resolved uses alone. Breaking: `outsideSourcesOf` is gone from
`@variance-authority/sense`, and `importersOf` no longer returns `unresolved`.
