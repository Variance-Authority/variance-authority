# A test held against what it says

This case records an ordinary Playwright suite once, with Eyes on. It then asks
`variance ask test-claims` about its tests. Each answer is read from that one
recording, and nothing runs when the question is asked.

## What this demonstrates

A test's name is a claim, and the recording says what the test did. The
answer puts four things side by side:

- the claims, which are the test's name and the steps and assertions Eyes recorded;
- the functions it ran;
- what it adds to the suite;
- the branches of those functions it passed by.

`retries a failed post` says it retries. It fills the same fields, clicks the
same button and asserts the same status as `submits the form`, and it executes
exactly the regions that test executes. The retry is a branch of `post` that it
passes by, and no test in the suite takes it. `shows an error for a missing
name` is the only test that enters the `required` branch of `validate`, and its
assertion keeps its `.not`.

The suite runs in a checkout of its own, as a project that installed variance
runs it. The record is kept for that checkout, and `variance ask` run there
finds it.

## The files

| Path | What it is |
| --- | --- |
| [`src/app/`](src/app/) | Product source: a signup form, its validation, the session and a post that is tried three times. It knows nothing about a test. |
| [`src/page.mjs`](src/page.mjs) | The page as a recording run serves it: the markup, then each app file probed the way a recording build probes it. |
| [`src/spec/signup.spec.mjs`](src/spec/signup.spec.mjs) | Eight specs, with the `varianceFixtures` and `eyesFixtures` fixtures. |
| [`src/playwright.config.mjs`](src/playwright.config.mjs) | `withTestSelection`, rooted at the checkout, naming no record file. |
| [`src/workflow.chromium.test.js`](src/workflow.chromium.test.js) | The outer Vitest file. It copies `src/` into a fresh checkout, runs the specs through the Playwright CLI, then asks the question through the `variance` CLI. |

## Run it

From the repository root, after `yarn build`:

```bash
yarn vitest run --config vitest.chromium.config.mts cases/test-claims-case/src/workflow.chromium.test.js
```
