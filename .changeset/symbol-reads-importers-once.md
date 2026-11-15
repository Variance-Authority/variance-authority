---
'@variance-authority/sense': patch
'@variance-authority/help': patch
---

`ask symbol` reads who imports a name once for all the files that declare it,
rather than once per declaration, with the same answer. On a workspace of about
107,000 files, a name 65 files declare went from 2.8 s to 0.6 s.
`importersOf` takes `byFile`, and then also says what each file asked about
answers alone.
