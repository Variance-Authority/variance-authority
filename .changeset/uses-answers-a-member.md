---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/cli': minor
---

`ask uses` answers for a member of an interface, a type literal or a class

A method or property declared on an interface is never imported, so
`variance ask uses --name resolveSources` refused it as a name the workspace
does not publish. For a name no export has, `uses` now lists where a member by
that name is declared, each line ending with its container, and names the
search that finds its callers: `ask grep --query '\bresolveSources\b' --to
<declaring file>`, which runs ripgrep over the files that import the
declaration. A name an export has is still answered by its imports alone. When
ripgrep or the addon cannot read the declarations, the refusal says so.

`memberDeclarationsOf` in `@variance-authority/sense` reads them: it parses the
files it is given from the working tree and keeps the property and method
signatures, class members and constructor parameter properties by that name.
`uses` hands it only the files ripgrep finds a possible declaration in.
