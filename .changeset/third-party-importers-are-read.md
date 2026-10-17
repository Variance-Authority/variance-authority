---
'@variance-authority/sense': minor
---

`thirdPartyImportersOf` reads who imports a name out of an installed package

`@variance-authority/sense` exports `thirdPartyImportersOf(root, name)`, which
lists every import of `name` out of a package no manifest of the workspace
declares: each binding and each read through `import * as` or `import()`,
with its file, line and the specifier as written. It reads the source index as
it stands, by the rule the external-dependency list already keeps: a request
the scan did not resolve to a file, out of a package the file's record says it
imports. The source index format does not change.
