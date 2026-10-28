---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`variance ask uses` lists a name a package passes on as `export * as ns` where a file imports `ns` by name and reads the name off it, `ns.name` or `const { name } = ns`, marked `(namespace, line <n>)` with the line of the import. The source index records the names read off each named import, so an index written by an earlier version is read again.
