---
'@variance-authority/sense': minor
---

Probe a build Rspack or webpack bundles, with no test runner

`testSelectionRule()` from `@variance-authority/sense/journal` is the rule that
records what a page bundled by Rspack or webpack executed: a Storybook, an
application under Playwright. List it first in `module.rules`, since loaders
of one `enforce` run right to left; it runs at `enforce: 'post'`, after SWC,
Babel and an extractor such as `@compiled/react`, so no compiler reads a
probe, and places each probe through the source map the loaders before it hand
on. Each probed module takes the page collector — an `import` at the end of a
module, a `require` after a CommonJS script's directives, so the script stays a
script and a `"use client"` or `"use strict"` stays first; a file recorded as
loaded rather than probed, which the instrumenter cannot parse, takes it the
same way — and a driven page
needs nothing else. It takes `root`, `mode`,
`include` and `placement` as `testSelectionProbes` does under Vite; the loader
itself is `@variance-authority/sense/probes-loader`. With the default
`include`, the rule excludes `node_modules`; an `include` you give is the
rule's own condition, so the loader runs in a worker as well.
