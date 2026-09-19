# Cases

A case runs this project against software it does not control: a real Storybook
build, a real Playwright Test CLI, a real screenshot comparator, a real Rstest
CLI, a real HTTP service. Unlike [`examples/`](../examples), cases do not let
the project define every input and expected output for itself. The external
tool's runner, its artifacts and its failure messages are what the case reads.

Every package here is `"private": true`. Nothing in this directory is published;
these exist to be run in a checkout.

## Before you run one

From the repository root, once:

```bash
yarn install
yarn build
npx playwright install chromium
```

`yarn build` is not optional. The cases load the compiled packages from
`packages/*/dist`, including bundles built after `tsc` by the same script; on an
unbuilt checkout a case fails with `the variance page agent bundle is missing`.
Node 22 or newer, as the root `package.json` requires.

## Choose a case

Each case is a Vitest file that launches the real external process and reads what
it printed. Run one from the **repository root**:

```bash
yarn vitest run cases/playwright-additive-case/src/workflow.chromium.test.js
```

| If you need to see | Run | What it shows |
| --- | --- | --- |
| An existing Playwright Test suite adding this without giving anything up | [`playwright-additive-case/src/workflow.chromium.test.js`](playwright-additive-case/src/workflow.chromium.test.js) | The consumer spec keeps `test` and `expect` from `@playwright/test`. Three real Playwright processes: the first run refuses an unapproved image, `--update-snapshots` accepts it, the third sees it unchanged. |
| A real screenshot comparator answering the same eight edits you do | [`incumbent-case/src/replacement.chromium.test.ts`](incumbent-case/src/replacement.chromium.test.ts) | `toHaveScreenshot` run by `playwright test` on the same page, scored against ground truth declared in advance — including the edits that repaint identical pixels and the ones that change pixels harmlessly. |
| A Storybook that Storybook built, collected from the outside | [`storybook-case/src/storybook.chromium.test.js`](storybook-case/src/storybook.chromium.test.js) | Stories read through the `index.json` Storybook wrote, a story held until it settles, an unstable story refused by name, and the new → accept → unchanged → changed cycle driven by the CLI. |
| One runner adopted both ways, deferred and in place | [`rstest-case/src/workflow.chromium.test.js`](rstest-case/src/workflow.chromium.test.js) | The real `rstest` CLI twice over: a `jsdom` suite that writes a capture for a later CLI process, and an `@rstest/playwright` suite that observes a live page inside the test and approves under `-u`. |
| A jsdom unit test whose screenshot is taken later, by a different process | [`unit-capture-case/src/workflow.chromium.test.js`](unit-capture-case/src/workflow.chromium.test.js) | An ordinary Vitest run that imports no browser package writes a capture; a second CLI process opens it, renders it in Chromium, records the baseline and re-observes it. |
| A test that waits on the decision an application made, not on what it drew | [`event-announcement-case/src/workflow.chromium.test.js`](event-announcement-case/src/workflow.chromium.test.js) | A page and a service announcing decisions, six executions running against one service process without hearing each other, and what a wait that never settles reports. |
| One execution followed from the browser into a service serving many at once | [`journey-tracing-case/src/workflow.chromium.test.js`](journey-tracing-case/src/workflow.chromium.test.js) | An execution id carried in a `Cookie` header, the service reporting both its decision and the source regions it entered under that id, and a following run narrowed to the spec that reached the changed branch. |

Two cases build an external artifact first, through their own package script:

```bash
yarn workspace @variance-authority/case-storybook build-storybook
yarn workspace @variance-authority/case-incumbent incumbent
```

The `incumbent` script runs Playwright's own comparator in the two phases a team
runs it in — record on the trunk, compare on the branch — and its second phase
exits non-zero on purpose. The other five cases have no scripts of their own:
the Vitest file above is the whole entry point.

Each case README owns the rest — its prerequisites in detail, its expected
evidence, and what it does not test. Run the narrowest case that matches the
integration you are evaluating.

## What a passing run looks like

```
 RUN  v2.1.9 /path/to/variance-authority

 ✓ cases/playwright-additive-case/src/workflow.chromium.test.js (1 test) 3208ms
   ✓ native Playwright Test consumer > accepts then observes an in-place raster
     with native test and expect 3206ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  3.63s
```

One Vitest test, because the assertions are about what three separate Playwright
processes exited with and printed. The detail is in those processes; the outer
file is orchestration.

## Case contracts

- The external side is real: its own runner, artifacts, and failure messages.
- The expected answer is declared before the observation, so a disagreement
  stands as a result rather than a score to adjust.
- Missing prerequisites skip loudly, with the command that makes the case run.
  A silently skipped case reads in a summary exactly like one that ran and
  agreed. [`tools/skips.check.ts`](../tools/skips.check.ts) enforces this.
- Generated or prebuilt inputs refuse stale source bytes instead of reporting an
  agreement against an old build. The case-specific tests own those checks.

## What cases cover, and what they do not

The incumbent case covers comparison against a real screenshot tool and the
questions a PNG cannot answer. The Storybook case covers collecting a built
Storybook and the CLI workflow over it. The Playwright and unit-capture cases
cover the two ways an existing suite adopts this: in place, and with the browser
step deferred; the rstest case covers both of those under one runner, so the
choice between them is visible as a choice rather than as two products. The announcement and journey-tracing cases cover waiting on an
application's own decision, and carrying one execution id from a browser into a
service that answers many callers at once.

These cases are run on one Mac and one Chromium. They say nothing about a hosted
review product, a browser fleet, a service-level deployment, or repository-scale
change detection. [`docs/gates.md`](../docs/gates.md) and
[`docs/comparison.md`](../docs/comparison.md) cover those; measurement
definitions are in [`docs/metrics.md`](../docs/metrics.md).
