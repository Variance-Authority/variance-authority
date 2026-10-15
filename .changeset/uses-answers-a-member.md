---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/cli': minor
---

`ask uses` answers for a member of an interface, a type literal or a class

A method or property declared on an interface is never imported, so
`variance ask uses --name resolveSources` refused it as a name the workspace
does not publish. `uses` now lists where a member by that name is declared,
each line ending with its container, and names the search that finds its
callers: `ask grep --query '\bresolveSources\b' --to <declaring file>`, which
runs ripgrep over the files that import the declaration. For a name an export
has as well, such as a wrapper function named like the member, the
declarations follow the imports under `` `prepareJourneys` is a member too ``.
When the source index cannot be read, the refusal says so.

`variance index` records every member declaration with each file's parse, so
the answer is a lookup in the source index, and `memberDeclarationsOf` in
`@variance-authority/sense` reads it. The source index format moves to version
20; the first `variance index` after upgrading writes it again.
