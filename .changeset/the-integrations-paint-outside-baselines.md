---
'@variance-authority/store': patch
'@variance-authority/cli': patch
'@variance-authority/playwright-test': patch
'@variance-authority/vitest-browser': patch
'@variance-authority/sense': patch
---

The Playwright and Vitest integrations keep the render cache out of the baseline directory

The store the `variance` fixture opens, the store `createVariance` and `observe`
open, and the store the Vitest plugin opens all paint into `renders/` in the
checkout's cache, where `variance run` paints. Each one prunes that directory by
the rules `variance run` applies: the fixture when a worker tears down, a
`createVariance` session when it closes, once per process, and the Vitest
plugin when the run closes. The baseline directory holds baselines only, so the
`.variance/baselines/**/by-document/` line in `.gitignore` and a store built only
to set `cacheRoot` are no longer needed: delete any `by-document/` directory
left under your baseline root, since nothing prunes it there. A `store` you pass
in is unchanged. Finding the cache reads the root `variance.config.json` the
way `variance run` does, so a file that is not JSON, or a `cacheRoot` that is
not a path, now fails the fixture and the plugin as it fails the CLI.

`renderCacheIn(cache)` from `@variance-authority/store/durable` returns the
`renders` directory inside a cache directory, so a store you build can share
that cache and its bound. `cacheRootFor` from the new
`@variance-authority/sense/cache-root` entry finds the checkout's cache without
loading the rest of Sense. `@variance-authority/vitest-browser` now depends on
`@variance-authority/sense` for it, which installs Sense's parser and resolver
with the plugin; the plugin does not load them.
