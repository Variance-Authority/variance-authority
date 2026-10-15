---
'@variance-authority/sense': minor
---

Probe a build Rspack or webpack bundles, with no test runner

`testSelectionRule()` from `@variance-authority/sense/journal` is the rule that
records what a page bundled by Rspack or webpack executed: a Storybook, an
application under Playwright. Loaders of one `enforce` run right to left, so
where you list it decides what runs around it: by default it runs at
`enforce: 'post'`, so list it first in `module.rules`, ahead of your own post
loaders; with `placement: 'before-transforms'` it runs at `enforce: 'pre'`, so
list it last, after your own pre loaders. By default it runs after SWC,
Babel and an extractor such as `@compiled/react`, so no compiler reads a
probe, and places each probe through the source map the loaders before it hand
on. Each probed module takes the page collector — an `import` at the end of a
module, a `require` after a CommonJS script's directives, so the script stays a
script and a `"use client"` or `"use strict"` stays first; a file recorded as
loaded rather than probed, which the instrumenter cannot parse, takes it on a
line of its own near the end, between the text the loaders wrote and the mark,
so it loads before the mark runs — and a driven page
needs nothing else. It takes `root`, `mode`,
`include` and `placement` as `testSelectionProbes` does under Vite; the loader
itself is `@variance-authority/sense/probes-loader`. With the default
`include`, the rule excludes `node_modules`; an `include` you give is the
rule's own condition, so the loader runs in a worker as well.
