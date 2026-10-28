---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`variance ask uses` follows a namespace destructured off a namespace import, `const { ns } = lib` and then `ns.name`, and `const { ns: { name } } = lib`, as it follows `lib.ns.name`. A binding destructured off a module the file holds is that module's value under a local name, as an import binds one, so it is no longer listed as a `[const]` declaration of its own beside the name it takes.
