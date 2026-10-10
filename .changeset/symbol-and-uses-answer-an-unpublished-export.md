---
'@variance-authority/help': minor
'@variance-authority/sense': minor
'@variance-authority/cli': patch
---

`variance ask symbol` and `ask uses` answer a name a file exports and no entry publishes

They used to refuse it. `symbol` gives the file and line that export it, the
line as the checkout holds it, and how many imports resolved to that file.
`uses` lists each of those imports, within the package as well as from another
one, read from the source index. A name nothing exports is still refused.
`@variance-authority/sense` adds `importersOf`, every import of a name out of
given files that the source index resolved.
