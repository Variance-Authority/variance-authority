---
'@variance-authority/sense': minor
---

`thirdPartyImportersOf` reads who imports a name out of an installed package

`@variance-authority/sense` exports `thirdPartyImportersOf(root, name)`, which
lists every import of `name` out of a package no manifest of the workspace
declares: each binding, each read through `import * as` or `import()`, and
each `export … from` that passes the name on, marked `passesOn`, with its
file, line, the package and the specifier as written. An `export *` names no
name and is not listed. It reads the source index as it stands, by the rule
the external-dependency list already keeps: a request the scan did not
resolve to a file, out of a package the file's record says it imports. The
files whose imports that rule cannot read come back as `unread`, since any of
them may import the name. The workspace's manifests are read only when a
binding of the name waits on them. The source index format does not change.
