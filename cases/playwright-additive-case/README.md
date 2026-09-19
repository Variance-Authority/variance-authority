# Adding Variance Authority to a Playwright Test suite

The suite gives up nothing, and this case is where you check that. The consumer
spec imports `test` and `expect` from `@playwright/test`, adds one observation
call and one assertion, and is run by the real `playwright test` CLI in a child
process — not by a harness this project wrote.

## What "additive" means here, exactly

Read [`src/spec/cart.spec.mjs`](src/spec/cart.spec.mjs) and you can check it:

- `test` and `expect` come from `@playwright/test`. The package under test
  exports neither, so there is no version of the spec where they could come
  from anywhere else.
- The spec's own assertions are ordinary `expect` calls.
- Acceptance is driven by `--update-snapshots`, Playwright's flag, read off
  `TestInfo`. There is no separate approval CLI in this path.

One thing is not free, and it is in the config rather than the spec.
[`src/playwright.config.mjs`](src/playwright.config.mjs) pins `colorScheme`,
`deviceScaleFactor` and `viewport`, and adds `CHROMIUM_RASTER_ARGS`
(`--disable-lcd-text`, `--font-render-hinting=none`) to `launchOptions`. Those
are the inputs a raster is only reproducible across runs if you hold still; a
suite that has never screenshotted anything will not already have them set.

## Files

| File | What it is |
| --- | --- |
| [`src/spec/cart.spec.mjs`](src/spec/cart.spec.mjs) | The consumer spec. One Playwright test, run by the Playwright CLI. |
| [`src/playwright.config.mjs`](src/playwright.config.mjs) | The Playwright config that spec runs under. |
| [`src/workflow.chromium.test.js`](src/workflow.chromium.test.js) | The outer Vitest file. Orchestration only: it makes an isolated baseline directory and launches the Playwright CLI three times, asserting on exit codes and printed output. |
| [`package.json`](package.json) | `"private": true`, and it has no scripts. The Vitest file is the entry point. |

## Run it

From the **repository root**, with a checkout, `yarn install`, `yarn build` and
`npx playwright install chromium` already done:

```bash
yarn vitest run cases/playwright-additive-case/src/workflow.chromium.test.js
```

`yarn build` is load-bearing: the observation loads a page-agent bundle built
after `tsc`, and an unbuilt checkout fails with `the variance page agent bundle
is missing`. Without a Chromium binary the case skips loudly rather than
passing.

## Three terms

A **subject id** is one named UI state you asked for and can ask for again —
here `cart/empty`, passed as `subjectId`. A **baseline** is the last image of that
subject you approved; later runs compare against it. A **verdict** is what the
comparison returned: `unchanged`, `changed`, `new`, `incomparable`.

## What you see

The outer Vitest file prints one line. The three Playwright processes it starts
are where the workflow is visible, so here they are run by hand from this
directory, with `VA_BASELINES` pointing at an empty directory.

The first run has no baseline for the subject, and the spec's `assertUnchanged`
fails the test — through Playwright's own reporter, at the spec's own line:

```
Running 1 test using 1 worker

[1/1] src/spec/cart.spec.mjs:8:1 › observes without replacing Playwright primitives
  1) src/spec/cart.spec.mjs:8:1 › observes without replacing Playwright primitives

    Error: cart/empty: new — no baseline for `cart/empty` under this renderer;
    nothing to compare against

        at assertUnchanged (packages/playwright-test/src/matcher.ts:48:11)
        at cases/playwright-additive-case/src/spec/cart.spec.mjs:25:5

  1 failed
```

The second run approves it, under Playwright's flag and nothing else. Note that
the spec does not branch on the flag — the same `assertUnchanged` line passes,
because the run was told it may promote a candidate:

```
$ node ../../node_modules/@playwright/test/cli.js test \
    --config=src/playwright.config.mjs --update-snapshots=all

Running 1 test using 1 worker
[1/1] src/spec/cart.spec.mjs:8:1 › observes without replacing Playwright primitives
  1 passed (726ms)
```

The third run compares against what the second approved:

```
Running 1 test using 1 worker
[1/1] src/spec/cart.spec.mjs:8:1 › observes without replacing Playwright primitives
  1 passed (4.3s)
```

The baseline directory now holds the image, its metadata, and the document the
pixels were rendered from, under a key for the renderer identity:

```
v1:09e74320ec70c26d7a5e40add47c455f/cart%2Fempty.png
v1:09e74320ec70c26d7a5e40add47c455f/cart%2Fempty.json
v1:09e74320ec70c26d7a5e40add47c455f/by-document/v1:501aa7bb8b17ac7bfcdb4312b4f93b1e.png
v1:09e74320ec70c26d7a5e40add47c455f/by-document/v1:501aa7bb8b17ac7bfcdb4312b4f93b1e.json
```

The outer Vitest file asserts exactly that sequence: exit 1, then exit 0 under
the flag, then exit 0 with `1 passed`.

## Scope

One spec, one subject, Chromium, macOS, and a page built with `setContent`
rather than a served application. It shows that adoption is additive and that
the new → accept → unchanged cycle runs under the real CLI. It does not exercise
navigation, fixtures, authentication, parallel workers, or a changed baseline —
the spec never edits the markup, so no run here returns `changed`. For a
`changed` verdict with regions and source attribution, see
[`incumbent-case`](../incumbent-case); for the flags and options themselves, see
[`packages/playwright-test`](../../packages/playwright-test).
