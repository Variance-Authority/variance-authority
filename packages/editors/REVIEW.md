# Reviewing `@variance-authority/editors`

The package carries the built VS Code and JetBrains plugins and one command,
`variance-authority-editors`, that prints where each one is. It installs
nothing; the plugins themselves live in `editors/` and ask the CLI for what they
paint.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/editors/`.

## Contracts

- **A named editor prints its path and nothing else.**
  `variance-authority-editors vscode` writes the absolute path and a newline to
  stdout, so it can sit inside `code --install-extension "$(...)"`. Written in
  the [README](README.md#install) and pinned by
  [`src/run.test.ts`](src/run.test.ts) › "prints the path alone for an editor
  whose plugin is here".
- **An unknown editor exits `2`, a missing plugin exits `1`.** The first names
  the editors it carries; the second says the file was not built into this copy.
  Neither prints a path. Written in the [README](README.md#install) and pinned
  by [`src/run.test.ts`](src/run.test.ts) › "exits 2 for an editor it carries no
  plugin for" and "exits 1 and says the plugin was not built".
- **No editor named lists every editor, built or not.** Each gets one line: the
  install step where the plugin is, the absence where it is not. Pinned by
  [`src/where.integration.test.ts`](src/where.integration.test.ts) › "names
  every editor it carries a plugin for, built or not".
- **The package never installs a plugin.** It prints a path and a step; the
  editor's extension list is the person's. Written in the
  [README](README.md#what-this-is-for) and the JSDoc of
  [`src/where.mjs`](src/where.mjs).
- **The package never packs without both plugins.** `prepack` refuses a missing
  or near-empty `.vsix` or `.jar`. Written in
  [`scripts/verify-pack.mjs`](scripts/verify-pack.mjs).
- **A plugin carries this package's version.** Written in the
  [README](README.md#what-the-plugins-show) and the JSDoc of
  [`scripts/build.mjs`](scripts/build.mjs).

## Not this package's

- What the gutter paints, hover and click behaviour: the plugins under
  `editors/vscode` and `editors/webstorm`, and the CLI reader they call ([spec
  0063](../../docs/specs/0063-an-editor-asks-about-the-text-it-holds.md)).
