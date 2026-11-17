---
'@variance-authority/sense': minor
---

A page that calls `reportPage` tells its story under Vantage when its build ran with `VARIANCE_AUTHORITY_STORY=1`: the Vite plugin and the webpack and Rspack rule read the variable as they are made and serve the collector with the page's tape and a teller beside it. Each load, click or submit is told once the page runs nothing more for it, at the next click, or as the page leaves, and told again with what it ran since if it runs on before the next click, so `variance ask ran --story` prints a `head page` with the functions it entered, what each was handed, its `console` lines and the notes a browser test's story carries. The requests it sent are not in it. Without the variable the collector is served as before.

The probes loader then answers the collector later, so `ProbesLoaderContext` requires `async`, which webpack and Rspack provide; a context built by hand adds it. The Vite plugin's `load` may return a promise, which Vite awaits.
