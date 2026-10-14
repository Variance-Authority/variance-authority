---
'@variance-authority/storybook-collector': minor
---

Record what each story executed under Rspack and Webpack too

Add `@variance-authority/storybook-collector` to your Storybook's `addons`, and
the preview build carries the probes `tests` reads, whichever builder runs it:
`testSelectionProbes()` under Vite, the `testSelectionRule()` loader under
Rspack and Webpack 5. The probes go in after every compiler the build runs, so a
Storybook built by Rspack with `@compiled/react` records its stories. The
addon's options are the probes' own: `root`, `mode`, `include` and `placement`.

Under Rspack and Webpack, where the build writes no source map the loaders can
read, as `storybook build --test` does, the addon sets `devtool` to
`hidden-cheap-module-source-map`, so the build also writes `.map` files that no
bundle names. A `testSelectionRule()` you add by hand gets no such help and
still stops the build at a module with no map.

If you added `testSelectionProbes()` or `testSelectionRule()` to the
Storybook's builder config yourself, remove it and add the addon instead.
