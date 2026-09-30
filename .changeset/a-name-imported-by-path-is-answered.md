---
'@variance-authority/package': patch
'@variance-authority/help': patch
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`variance ask uses` and `ask symbol` answer for a name that no entry publishes but that another package imports by the path of its file, such as `addTax` from `@acme/lib/src/internal/math`. They no longer refuse it. Each import is listed with its file and line and marked as a deep import, past the entry the package declares, or as an import by path from a package that declares none. `symbol` also says where the name is declared and why nothing publishes it. A name that is exported without being published and that nothing imports is still refused, and the refusal names the file and line that export it.

A workspace package with none of `exports`, `main`, `types` or `typings` is no longer skipped. `ask packages` and `ask entrypoint` list it by the files and names other packages import from it, each with the importer's file and line, and none of those imports are called deep. A `.js` `main` with no `types` and no `.d.ts` beside it opens at the `.ts` or `.tsx` source of the same stem, as TypeScript reads it.
