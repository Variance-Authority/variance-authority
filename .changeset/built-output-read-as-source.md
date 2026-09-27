---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

An import that resolves into a workspace package's built output is read as the source file it is emitted from, taken from the `outDir` and `rootDir` the package's `tsconfig` names. A workspace whose manifests export only `./dist/index.js` now has file edges between its packages, so `variance reach` walks from a changed source file into the packages that import it, and the answer is the same whether or not the packages were built. Output whose source was deleted is not a target. A config that sets `noEmit` is skipped, so a package that type-checks with `tsconfig.json` and builds with `tsconfig.build.json` is read through the second. When two configs write into one `outDir`, the first whose `rootDir` holds the source answers. A config that sets `emitDeclarationOnly` maps only declarations, so code a bundler writes beside them is read as it is. A package under `node_modules` is never read this way. A `sideEffects` pattern that names built output, such as `./dist/register.js`, matches the source it is built from. Stored records are read again once, because the rule is part of their key.
