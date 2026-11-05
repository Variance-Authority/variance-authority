# A spec cut under the oldest Playwright

The repository runs its own suite on the newest Playwright, and every other case
does too. `@variance-authority/playwright-test` takes 1.55 and newer, and below
1.63 it reaches a spec by another route: the cadence cut goes in through the
configuration's `babelPlugins`. The environment pair the newer releases read
reaches no ES module spec on the release this case installs. This case installs
the oldest Playwright for itself and runs its real CLI, so that route runs on
something other than a unit test's stand-in.

## The files

```
fixture/playwright.config.mjs          withTestSelection() over one spec, with the browser from FIXTURE_CHROMIUM
fixture/src/shop.js                    the page's source, with two regions: choose and pay
fixture/tests/shop-page.ts             the page object the spec drives
fixture/tests/shop.spec.ts             one test, whose statements end `// chooses` and `// pays`
src/cut.chromium.test.ts               the outer test: runs Playwright on the fixture and reads its record
```

`@variance-authority/case-playwright-oldest` is `"private": true` and declares no
scripts. Its `@playwright/test` dependency is the one the outer test launches,
from `cases/playwright-oldest-case/node_modules/@playwright/test`, so the run
under test is the oldest's while the outer file runs on the repository's Vitest.

## Run it

You need a checkout, `yarn install`, `yarn build` and `npx playwright install
chromium`: the fixture loads the seam from `packages/playwright-test/dist`, and
drives the browser the repository's Playwright installed. From the repository
root:

```bash
yarn vitest run --config vitest.chromium.config.mts cases/playwright-oldest-case/src/cut.chromium.test.ts
```

## What it shows

- The version it installs is the floor `packages/playwright-test/package.json`
  declares, so raising one without the other fails here.
- `choose` is recorded against the `// chooses` statement and `pay` against the
  `// pays` statement, which only a cut spec can tell apart.
- `--shard 1/2` is refused when the configuration loads, because this release
  has no `preprocess` and would split the shard test by test.

## What it does not test

The releases between the floor and 1.63 are not run here, and neither is a
CommonJS spec.
