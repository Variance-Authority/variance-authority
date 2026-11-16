---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance carry restore` names Jest's transform cache for each declared suite whose project resolves `jest-config`: `transform-<suite>-path` is Jest's default `cacheDirectory`, and the key holds the suite, the shard `--shard <k>/<n>` names, and the ISO week, so a new week starts from an empty cache. `Variance-Authority/action/jest-cache` restores it before a shard's tests and saves it on the week's first run of that shard, and `Variance-Authority/action/review` does the same around `test`. `@variance-authority/sense/test-selection` exports `jestDependency`, which resolves a package from the Jest a project runs.
