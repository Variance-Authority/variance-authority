---
'@variance-authority/sense': minor
---

`outsideImportersOf` reads who imports a name from outside the workspace

`@variance-authority/sense` exports `outsideImportersOf(root, name)`, which
lists every import of `name` out of a package no manifest of the workspace
declares, or out of a built-in module: each binding, each read through
`import * as` or `import()`, and each `export … from` that passes the name on,
marked `passesOn`, with its file, line, the package and the specifier as
written, and, for a binding, the `lines` its file uses it on, as
`importersOf` gives them. An `export *` names no name and is not listed. It reads the source
index as it stands. A package is told by the rule the external-dependency list
already keeps: a request the scan did not resolve to a file, out of a package
the file's record says it imports. A built-in module is told by its
specifier, a name in Node's `builtinModules` with or without `node:`, unless the scan
resolved the request to a file; it comes back as `node:path`, marked
`runtime`. The files whose imports cannot be read come back as `unread`, since
any of them may import the name. The workspace's manifests are read only when
a binding of the name waits on them. The source index format does not change.
