---
'@variance-authority/cli': minor
'@variance-authority/mcp': minor
'@variance-authority/playwright-test': minor
---

A file argument names one file, spelled from the checkout

`variance_run_signals` kept every test whose spec file contained the `file`
argument, so `tests/cart.spec.ts` also took `tests/cart.spec.tsx`, and `cart`
took both. It now keeps the tests of the one file named, spelled as the listing
spells it, from the repository root: `tests/../tests/cart.spec.ts` and an
absolute path name `tests/cart.spec.ts`. Through `variance ask run-signals`, a
relative path is read from the directory the question is asked in, as a shell
reads it; through `variance-authority-mcp --watch`, from the repository root. A
path outside the checkout is refused.

The `varianceWatched` Playwright fixture names each watched test's file from
the repository root, as the rest of the record does, rather than from the directory the runner was
started in: a suite run from `packages/web` lists `packages/web/tests/cart.spec.ts`,
not `tests/cart.spec.ts`. The watcher and `variance ask` take their checkout from
git the same way.

`variance distill --from` reads its directory from `--root`, the working
directory by default, and spells it the same way. An absolute
directory, or one with `..` in it, names the directory it resolves to instead of
finding no test file under it, and a directory outside the checkout, which was
answered as holding no test file, is refused.
