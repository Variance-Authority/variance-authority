---
'@variance-authority/storybook-collector': minor
---

Record what each story executed under Rspack and Webpack too

Add `@variance-authority/storybook-collector` to your Storybook's `addons`, and
the preview build carries the probes `tests` reads, whichever builder runs it:
`testSelectionProbes()` under Vite, the `testSelectionRule()` loader under
Rspack and Webpack 5. The probes go in after every compiler the build runs, so a
Storybook built by Rspack with `@compiled/react` records its stories. The
addon's options are the probes' own: `root`, `mode` and `include`.
