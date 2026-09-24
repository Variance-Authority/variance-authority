---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
'@variance-authority/playwright-test': patch
'@variance-authority/storybook-collector': patch
---

The repository names its cache. Set `cacheRoot` in the `variance.config.json` at the repository root, for example `".variance/cache"`, and every command, every test runner integration and every function that takes a `cacheRoot` option uses that directory. The path resolves against the repository root. Without the key the cache is `$XDG_CACHE_HOME/variance-authority`, or `~/.cache/variance-authority`, as before, so an existing recording stays where it is. The key is read before the environment, so a sandboxed agent that sets `XDG_CACHE_HOME` to a temporary directory no longer splits the recording away from your own runs. [The cache](https://variance-authority.dev/docs/cache) page describes the location, what is in it, worktrees and CI.

`@variance-authority/sense` exports `cacheRootFor(root)`, which returns that answer, and `CACHE_CONFIG`. `defaultCacheRoot` is removed; call `cacheRootFor(root)`. A `cacheRoot` option now names the variance-authority directory itself, and `test-selection/` is created under it. `testCoverageFile`, `seedTestCoverage`, `readableTestCoverage`, `moduleNamesFile`, `openModuleNames`, `recordStore`, `recordStores` and `repositoryLayers` take an optional `cacheRoot`. An empty or relative `XDG_CACHE_HOME` is ignored rather than resolved against the working directory. A root `variance.config.json` that is not JSON, or whose `cacheRoot` is not a non-empty string, is an error.

`@variance-authority/cli` accepts `cacheRoot` in the config and in the schema, and refuses it in a `variance.config.json` below the repository root. `variance run`'s render cache and suite indexes are under it. `renderCacheRoot` and `suiteIndexPath` take the config.
