# Reviewing `@variance-authority/editors`

## Contracts

- **A named editor prints its path and nothing else.** Pinned by
  [`src/run.test.ts`](src/run.test.ts).
- **An unknown editor exits `2`, a missing plugin exits `1`.** Pinned by
  [`src/run.test.ts`](src/run.test.ts).
- **No editor named lists every editor, built or not.** Pinned by
  [`src/where.integration.test.ts`](src/where.integration.test.ts).
- **The package never installs a plugin.** Written in
  [README](README.md#what-this-is-for) and [`src/where.mjs`](src/where.mjs).
- **The package never packs without both plugins.** Written in
  [`scripts/verify-pack.mjs`](scripts/verify-pack.mjs).
- **Both plugins paint the marks the CLI reads across suites, and no mark from
  a stale record; neither ranks a line itself.** Pinned by
  [`src/record.test.ts`](src/record.test.ts) for VS Code and by the check
  `editors/webstorm/build.sh` runs before packing, for WebStorm, on fixtures
  the CLI's `covering-marks.test.ts` holds to.
- **A plugin carries this package's version.** Written in
  [README](README.md#what-the-plugins-show) and
  [`scripts/build.mjs`](scripts/build.mjs).
