# Add one observation to a Playwright test

The state you want to review only exists after your test has navigated, logged
in and waited for it — so keep all of that. This page adds one
[Variance Authority](README.md) observation and one assertion inside the test
body, at the point where the page is already right, and the locator you pass
becomes a subject with a baseline image of its own.

## What this adds to a suite that already has `toHaveScreenshot`

`expect(locator).toHaveScreenshot()` answers with a pixel count and two images,
and the only way to act on that answer is to open the images and look.

This integration answers in the vocabulary of your source instead:

- Each changed region is attributed to the component that rendered it, and to
  `file:line` when you pass a `SourceIndex` as `source`. That chain — region to
  box to component to line — is described in [attribution](attribution.md).
- Pixels, the document, and the browser accessibility tree are kept as separate
  signals. A change to the accessibility tree that moves no pixel comes back
  `changed` with zero changed pixels and the before and after ARIA trees
  retained beside the image.
- A baseline painted under a different browser, platform, device scale factor,
  or font stack comes back `incomparable`, naming what differs, rather than as a
  page of changed pixels you have to triage yourself.

You keep `toHaveScreenshot` wherever you already use it. This does not replace
it or read its baselines.

## Before you add the observation

The test must already get a page with a viewport into a deterministic state.
Choose a locator around the behavior under review, not the whole page.

Install the helper and the Chromium binary it paints with. By default Variance
Authority does not screenshot the live tab: it captures the subtree as a
document and repaints it through its own Chromium, which is what lets the same
document be repainted identically later.

```bash
npm install --save-dev @variance-authority/playwright-test @playwright/test
npx playwright install chromium
```

## Observe the state

Keep `test` and `expect` imported from the suite's existing Playwright package —
this one exports neither. Add the observation after the test's own navigation,
actions, and waits:

```ts
import { test } from '@playwright/test';
import { assertUnchanged, observe } from '@variance-authority/playwright-test';

test('the cart survives an empty basket', async ({ page }, testInfo) => {
  await page.goto('https://example.test/cart');
  await page.getByRole('button', { name: 'Clear' }).click();

  const observation = await observe(page, page.getByTestId('cart'), testInfo, {
    subjectId: 'cart/empty',
  });

  assertUnchanged(observation);
});
```

`observe` returns an `Observation`. `assertUnchanged` throws unless its verdict
is `unchanged`; you can also read `verdict`, `regions`, `signals`, and
`missingFonts` yourself and decide what to do.

### What `subjectId` names

`subjectId` is the key the baseline is stored under. It identifies one UI state,
not one test — a test observing three states needs three ids.

Its uniqueness scope is the baseline root, not the spec file and not the test.
Two observations that use the same id in one root address the same baseline and
overwrite each other, whichever files they live in.

The `/` is not a path separator by default. Under the default flat layout the id
is percent-encoded into a single filename, so `cart/empty` becomes
`cart%2Fempty.png`. Use `/` to group ids readably; nothing reads it as a
directory unless you configure a `beside` layout.

Omit `subjectId` and the id defaults to the test's title path. Renaming the test
then orphans its baseline and the next run reports `new`, so name long-lived
subjects explicitly.

## Where the baseline is written

Approved baselines go to `.variance/baselines` unless you point `baselines`
somewhere else. Each one is two files under a directory named for the renderer
identity that painted it:

```
.variance/baselines/v1-6c1f…/cart%2Fempty.png
.variance/baselines/v1-6c1f…/cart%2Fempty.json
```

The `.png` is the approved image. The `.json` records which renderer painted it
and what it may be compared against.

**Renderer identity** is what that `v1-…` directory is named for: the renderer
and its engine build, the OS and architecture, the device scale factor, the
fonts the renderer actually had, and digests of the stabilization and raster
settings it used. A reading is only compared against a baseline under the same
identity. Upgrade Chromium, change `deviceScaleFactor`, or run on a machine with
a different font stack, and the run reports `incomparable` for that subject
instead of comparing across the difference. The project's `colorScheme`
partitions baselines the same way.

Commit both files. They are ordinary tracked files and they are how the next run
and CI find the approved state. If your repository ignores `.variance/`, exclude
its contents rather than the directory so git still descends into it:

```gitignore
.variance/*
!.variance/baselines/
```

A run that cannot read what the last run wrote does not fail — it reports every
subject `new`. [Baseline placement](placement.md) covers Git LFS and remote
stores for corpora too large to commit as blobs.

## Review, accept, and prove the rerun

The first run returns `new`, so `assertUnchanged` fails. No approved baseline
exists for `cart/empty` yet.

Look at the state the test left the page in:

```bash
npx playwright test cart.spec.ts --ui
```

When that is the state you intend to keep, run the same spec with Playwright's
snapshot update flag:

```bash
npx playwright test cart.spec.ts --update-snapshots=changed
```

Variance Authority reads this flag from `TestInfo` and promotes candidates only
under `all` or `changed`. With no flag, Playwright's field reads `missing`, and
this integration treats that as no approval at all.

Prefer `changed` over `all` here, and name the spec file. `all` rewrites every
snapshot the run touches, including `toHaveScreenshot` baselines that matched;
`changed` rewrites only the ones that already disagree, and the file argument
keeps the run to the test you just reviewed. Either one promotes the Variance
Authority candidate.

The accept run promotes the image that run painted, returns `unchanged`, and
passes. Open the `.png` it wrote before you commit it: that file and its `.json`
are the two files that will appear in your pull request.

Run the suite normally once more:

```bash
npx playwright test
```

The same state now returns `unchanged`. When a later run returns `changed`, read
the regions it names and decide whether the change was intended; accepting it
takes the same explicit update flag.

## Go deeper

Read [attribution](attribution.md) when a changed region must resolve to its
component and `file:line`, or [stabilization](stabilization.md) when the state is
not repeatable. The complete fixture, materialization, source, and multi-subject
contracts remain in the
[`@variance-authority/playwright-test` reference](../packages/playwright-test/README.md).
