---
'@variance-authority/sense': minor
---

Probe a build Rspack or webpack bundles, with no test runner

`testSelectionRule()` from `@variance-authority/sense/journal` is the rule that
records what a page bundled by Rspack or webpack executed: a Storybook, an
application under Playwright. Add it to `module.rules`; it runs at
`enforce: 'post'`, after SWC, Babel and an extractor such as `@compiled/react`,
so no compiler reads a probe, and places each probe through the source map the
loaders before it hand on. Each probed module opens with the page collector —
an `import` in a module, a `require` in a CommonJS script, which stays a
script — so a driven page needs nothing else. It takes `root`, `mode`,
`include` and `placement` as `testSelectionProbes` does under Vite; the loader
itself is `@variance-authority/sense/probes-loader`.
