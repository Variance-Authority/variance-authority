---
'@variance-authority/help': patch
'@variance-authority/sense': patch
---

`ask search` puts a name that is the question first — as written, then the same name in another case — ahead of names that only hold the word and however few packages import it. `ask symbol` answers a name a file exports and no entry publishes the way it answers a published one: with its kind, its signature and its doc, read off the declaration the export binds — under another name, or through any `export … from` that passes it on — not the raw line it is written on. `@variance-authority/sense` exports `declarationExported`, that declaration with its kind and the spans of its signature and doc, in place of `declarationPassedOn`.
