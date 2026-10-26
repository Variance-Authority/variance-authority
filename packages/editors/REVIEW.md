# Reviewing `@variance-authority/editors`

## Contracts

- **A named editor prints its path and nothing else.** Written in
  [README](README.md#install); pinned by [`src/run.test.ts`](src/run.test.ts).
- **An unknown editor exits `2`, a missing plugin exits `1`.** Written in
  [README](README.md#install); pinned by [`src/run.test.ts`](src/run.test.ts).
- **No editor named lists every editor, built or not.** Pinned by
  [`src/where.integration.test.ts`](src/where.integration.test.ts).
- **The package never installs a plugin.** Written in
  [README](README.md#what-this-is-for) and [`src/where.mjs`](src/where.mjs).
- **The package never packs without both plugins.** Written in
  [`scripts/verify-pack.mjs`](scripts/verify-pack.mjs).
- **A plugin carries this package's version.** Written in
  [README](README.md#what-the-plugins-show) and
  [`scripts/build.mjs`](scripts/build.mjs).

## Not this package's

- What the gutter paints, hover and click behaviour: the plugins under
  `editors/vscode` and `editors/webstorm`, and the CLI reader they call ([spec
  0063](../../docs/specs/0063-an-editor-asks-about-the-text-it-holds.md)).
