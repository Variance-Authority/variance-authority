# Old tests on new code, in place

A spike for [#1505](https://github.com/Variance-Authority/variance-authority/issues/1505):
can a test runner read the test files at one version while the source stays
at another, without writing a second tree? The checkout keeps the head; a
manifest names the base content of each test-side file, or `null` for a file
the base did not have. Two preloads, inherited by every worker through
`NODE_OPTIONS`, present the manifest instead of the disk:

```
src/override.cjs     --require: the `fs` reads, stats, listings and realpaths a runner makes itself
src/hooks.mjs        --import: Node's module loader, which resolves below `fs` (`module.registerHooks`)
src/swc-hooks.mjs    --import: TypeScript through swc for `node --test` and mocha, after the override
src/node-run.mjs     `node --test` through `run({ files })`, past the CLI's glob
src/fixture.mjs      one suite at two versions, written to the OS temporary directory
src/probe.mjs        runs a fixture head, base, head again, and reads each runner's report
```

Run it from the repository root:

```bash
yarn vitest run --config vitest.integration.config.mts cases/version-override-case/src/probe.integration.test.js
```

## What it shows

Jest 30, Vitest 5, mocha 12 and `node:test` (Node 24), each in CommonJS, ESM
and TypeScript — swc for jest (`@swc/jest`), `node --test` and mocha; Vitest
transforms TypeScript itself. Jest, Vitest and mocha find the test files
themselves; `node:test` is handed the list.

- With the manifest applied, every runner reports the base cases: the test
  file and its helper at the base, a test file only the base had, one in a
  directory only the base had, a helper only the base had that a `require`
  names without its extension; a file only the head has fails to load, and the
  head-only test is not found.
- The head run after the base run reports the head again: neither Jest's
  transform cache nor Vitest 5's module cache hands the base to it.
- No file in the fixture changes. The runners write their own caches under
  `node_modules`, as they do on any run.

## What escapes

A reader that resolves or lists below `fs` and the module loader does not see
a file only the base holds. The probe pins each one it found:

- Jest resolves every import through its own native resolver, so a helper only
  the base has is not found in any module system. Its `resolver` option is the
  seam.
- Vitest resolves an import through Vite's resolver, so an ESM or TypeScript
  import of such a helper is not found; a `require` is. A Vite plugin is the
  seam.
- The `node --test` CLI globs its arguments through `lib/internal/fs/glob.js`,
  which takes `lstatSync` and `readdirSync` from `fs` when Node starts, before
  any preload, so a file only the manifest holds is dropped without a word.
  `run({ files })` takes the list as given and serves it.

A file or directory only the base holds has no stat of its own: it takes the
manifest's, or its directory's, with the size of its content, and its realpath
is the path asked for. `open`, `read`, streams, `opendir` and `copyFile` read
the disk.

## What it does not show

A runner's watch mode, Vitest's browser mode, Rstest, whether Jest ran
the files in its worker processes or in band, a native addon reading files itself, and Jest
under watchman (the probe passes `--no-watchman`). Which files count as
test-side, and the per-case verdict of an old test on new code, are
[#1504](https://github.com/Variance-Authority/variance-authority/issues/1504)'s.
