---
'@variance-authority/core': minor
'@variance-authority/playwright': minor
'@variance-authority/playwright-test': patch
---

`awaitedRequest`, which tells the requests a page's pending work is told from —
not a channel, a stream or an asset — moves to `@variance-authority/core`, so
every package that waits on requests reads one list. `@variance-authority/playwright`
no longer exports it: import it from `@variance-authority/core`.
