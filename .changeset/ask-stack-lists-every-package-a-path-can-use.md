---
"@variance-authority/cli": minor
"@variance-authority/help": minor
"@variance-authority/sense": minor
---

`variance ask stack --from <path>` lists every third-party package a path can use

It takes no words. `variance ask stack`, and the `docs_stack` tool on the workspace API server, read the manifest that owns the path and list each package it declares or that the code under it imports: the version, the role (`runtime`, `dev` or `types-only`), how the manifest declares it, and how many times the code imports it, with the first import as `file:line`. Imported packages come first, then the ones declared and not imported, then the ones whose imports were not read. A declaration the resolver could not read is listed with the reason. A page is 40 rows unless `--limit` says otherwise, and `variance ask` takes `--offset <n>` to skip rows. Each page ends with how many rows remain and the `--offset` that asks for the next page. The answer reads only the dependency lexicon that `variance index` writes and opens no installed package. `dependencyStackNative` in `@variance-authority/sense` is the call it makes.
