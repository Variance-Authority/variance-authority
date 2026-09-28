---
"@variance-authority/sense": minor
"@variance-authority/cli": minor
"@variance-authority/help": minor
---

The cache is inside the checkout. Without `cacheRoot` in `variance.config.json`, it is `node_modules/.cache/variance-authority` at the repository root, so a coding agent whose sandbox allows writes only in the working tree records and reads the same cache as your terminal and CI. `XDG_CACHE_HOME` is no longer read; `VARIANCE_AUTHORITY_CACHE`, an absolute path, names the cache directory for a harness that keeps its runs apart. A recording under `~/.cache/variance-authority` is not read, so the first `yarn test` after upgrading records again. `variance index` also publishes the value `variance ask` answers from, so `ask search` answers in a fresh checkout, and prints a `questions:` line saying where it is or why it could not be written. [The cache](https://variance-authority.dev/docs/cache) page describes the order.

`readWorkspace` in `@variance-authority/help` takes `packs`, whether the scan reads bytes from Git's object store, and `saveIndex`, whether publishing also writes the scan's records back to the source index; `variance index` turns it off, because it has just published that index itself.
