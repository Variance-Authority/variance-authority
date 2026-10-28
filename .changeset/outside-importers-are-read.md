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
any of them may import the name: every file whose record did not read, and a
file whose record does not line up with its parse only when that parse takes
the name. The workspace's manifests are read only when
a binding of the name waits on them. The source index format does not change.

The help reading applies the same rule to exports: an `export … from` a
package the workspace installs, or from a built-in module, is no export of the
workspace, and the reading leaves it out of `exported`.

`outsideRequestsOf(root, indexed, files)` decides, for each file's requests
as the first scan holds them, which are out of a package the workspace does
not hold or a module of the runtime's, by the same rule, or that the file's
record cannot say. The first reading of a workspace and the refresh after it
now count an `export … from` a workspace package the scan did not resolve the
same way, so the refresh applies where it used to fall back to a full read;
a file the rule cannot decide is named as unreadable rather than read as
exporting from the workspace.
