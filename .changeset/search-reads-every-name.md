---
'@variance-authority/cli': minor
'@variance-authority/help': minor
'@variance-authority/sense': minor
---

`variance ask search` finds what `ask symbol` finds: a member by its name, by `container.member` or by the doc above it, a function inside a function by its name, and an import's `as` name. A member's doc span is now in the source index, so the index format moves to 40 and rebuilds once. A search that finds nothing says what it read: ``No export, top-level declaration or member of a class, an interface or a type in this repository, nor the doc of one, nor a function inside a function, writes `x`.`` A script that matches the old `No name in this repository` sentence matches the new one instead. As JSON, the answer gains `held` and `aliases`.
