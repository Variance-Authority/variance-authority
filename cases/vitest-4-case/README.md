# A selection under Vitest 4

The repository runs its own suite on Vitest 5, and the test-selection seam in
[`@variance-authority/sense/vitest`](../../packages/sense) is proven there. Vitest
4.1 is the oldest release the seam supports, and its end of a run differs: it
decides whether a run that ran no file failed after the seam's sequencer has
dropped the skipped files, not before. A selection that leaves nothing to run
fails there unless the run passes with no tests. This case installs Vitest 4
for itself and runs its real CLI.

## The files

```
fixture/vitest.config.ts               withTestSelection() over two case files, the skip list read from FIXTURE_SKIP
fixture/add.ts                         the source both cases import
fixture/one.case.ts, two.case.ts       one test each
src/selection.integration.test.ts      the outer test: runs Vitest 4 on the fixture and reads its exit, stderr and record
```

`@variance-authority/case-vitest-4` is `"private": true` and declares no
scripts. Its `vitest` dependency is the one the outer test launches, from
`cases/vitest-4-case/node_modules/vitest`, so the run under test is Vitest 4's
while the outer file runs on the repository's Vitest.

## Run it

You need a checkout, `yarn install` and `yarn build`: the fixture loads the
seam from `packages/sense/dist`. From the repository root:

```bash
yarn vitest run --config vitest.integration.config.mts cases/vitest-4-case/src/selection.integration.test.ts
```

## What it shows

- A selection that skips both files prints `selected none of 2`, runs nothing
  and exits 0.
- `--shard 2/2` over a selection that kept one file leaves the second shard
  nothing to run, and it exits 0.
- A selection that skips one file runs the other, and records only that one.

## What it does not test

A run over several projects is tested under Vitest 5 only, in
`packages/sense/src/test-selection/vitest-selection.integration.test.ts`. The
Jest seam is not run here.
