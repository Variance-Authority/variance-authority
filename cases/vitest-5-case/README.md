# A recording under Vitest 5

The repository runs its own suite on Vitest 5, and the test-selection seam in
[`@variance-authority/sense/vitest`](../../packages/sense) is proven there over
isolated files that run their cases one at a time. Vitest 5 ships no
`@vitest/runner` package. Its runner is the `TestRunner` that `vitest` exports,
and it serves a module it transformed in an earlier run from its file-system
module cache, so the seam's transform never sees that module again. This case
runs Vitest 5's real CLI over a suite configured the way a fast one is:
`isolate: false`, cases concurrent within a file, and `continuations: true`.

## The files

```
fixture/vitest.config.ts               withTestSelection() over two case files, the skip list read from FIXTURE_SKIP
fixture/add.ts                         the source both cases import: two branches, each behind an await
fixture/one.case.ts                    two concurrent cases, one per branch
fixture/two.case.ts                    one case
src/selection.integration.test.ts      the outer test: runs Vitest 5 on the fixture and reads its exit, output and record
```

`@variance-authority/case-vitest-5` is `"private": true` and declares no
scripts. Its `vitest` dependency is the one the outer test launches, resolved
from the case, so the run under test is Vitest 5's wherever the install placed
it.

## Run it

You need a checkout, `yarn install` and `yarn build`: the fixture loads the
seam from `packages/sense/dist`. From the repository root:

```bash
yarn vitest run --config vitest.integration.config.mts cases/vitest-5-case/src/selection.integration.test.ts
```

## What it shows

- A whole run records both files as complete, and reaches no `@vitest/runner`.
- Each branch of `add.ts` names the case that took it, while both cases of
  `one.case.ts` are in flight at once and resume inside `add`: on a cold
  module cache, and again on the warm one the cold run left.
- A selection that skips one file runs the other, and records only that one.

## What it does not test

Vitest 4 is not run here; `cases/vitest-4-case` runs it. A run over several
projects is tested in
`packages/sense/src/test-selection/vitest-selection.integration.test.ts`. The
Jest seam is not run here.
