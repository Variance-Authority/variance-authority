---
'@variance-authority/help': patch
'@variance-authority/cli': patch
'@variance-authority/mcp': patch
---

`variance ask uses --name <module>` decides that the name is a module by what your checkout holds at it, not by how it is spelled: a file of the checkout, `tsconfig.json` or `./src/tax.ts`, or a package Node resolves from the root, `react` or `@acme/kit`. It is then asked as `discover --imports`, which reads no workspace. A package is answered as a name too, after its importers, where the name is found. A name written as a path that no file is at, `./packages/x.ts`, is refused as no path in the checkout instead of answered with nobody importing it.
