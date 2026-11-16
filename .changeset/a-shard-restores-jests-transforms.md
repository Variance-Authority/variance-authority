---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance carry restore --transform jest [--shard <k>/<n>]` also names Jest's transform cache for each declared suite whose project resolves `jest-config`: `transform-<suite>-path` is Jest's default `cacheDirectory`, and the key holds the suite, the shard and the ISO week, so a new week starts from an empty cache. A restore without `--transform` prints what it did before. `Variance-Authority/action/jest-cache` is that restore as one step before a shard's tests, and the cache action saves it on the week's first green run of that shard. `@variance-authority/sense/test-selection` exports `jestCacheDirectory`, Jest's default cache directory as the project's own Jest answers it.
