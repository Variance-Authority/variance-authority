---
'@variance-authority/package': patch
---

A workspace package with no `exports` publishes its bare name through `types`, `typings` or `main`, the first of them the manifest writes, in the order TypeScript reads them. `variance ask packages` lists it with the imports of it, and an import of any of its other files, such as `@acme/lib/src/internal/math`, is listed as reaching past its entrypoint. `ask symbol`, `ask uses` and `ask entrypoint` answer for the names its entry exports. Before, such a package opened nothing and was missing from every answer.
