---
'@variance-authority/sense': patch
---

`variance index` reads a `tsconfig`'s `extends` base whatever it is named and wherever it lies — `./generated/tspaths.json`, a package config such as `@tsconfig/node22` under `node_modules` — and uses the `paths` it declares. Adding or removing an unrelated file no longer re-resolves every stored record in such a repository, so a branch switch rebuilds only the records the change can reach. Editing the base, or a reinstall that changes it, still re-resolves every record. Only a base that is missing or is not JSON leaves the aliases unknown.
