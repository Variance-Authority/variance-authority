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

The addon probes only the builds the collector records: `storybook build
--test` and a dev server. Any other `storybook build`, the one a team
publishes, gets nothing from it, so build the recorded Storybook with `--test`.
The collector's `tests` is read in a later process, after the build, so the
build cannot ask it; Storybook's own `--test` is how a build says it is for
testing.

Under Rspack and Webpack, where the build writes no source map the loaders can
read, as `storybook build --test` does, the addon hands the loaders their maps
and the build still writes no `.map` file. `devtool` stays as you set it.

Storybook runs an addon's builder hooks before the ones in your `main.js`, so
the addon places the rule from a plugin, once the config is final: a post
loader your own `webpackFinal` or `rsbuildFinal` adds still runs ahead of the
probes. If you added `testSelectionProbes()` or `testSelectionRule()` to the
Storybook's builder config yourself, remove it and add the addon instead: a
second one stops the build with "remove your testSelectionRule(); the addon
places it", or the same of `testSelectionProbes()`. One your `vite.config`
lists is kept, and the addon adds no second one.

When `tests` is on and the preview has no probes, the run's stderr now says to
add the addon and build with `storybook build --test`, where it named
`testSelectionProbes()`. The `tests` option's documentation says the same.
