<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/playwright-test

> Add a source-aware visual observation to a Playwright test that already knows how to get the app into the state.

Part of [Variance Authority](https://variance-authority.dev).

Your Playwright test already knows how to navigate, authenticate, mount data and
wait for the application. This package adds one call to that test. The call
screenshots a locator, compares the image against the baseline you approved, and
fails with the components behind the changed pixels:

```
cart/empty: changed — 1530 pixels differ
2 region(s), ordered by area — no causes were supplied, so this
ordering measures displacement rather than blame:
  511px — Stack
  86px — Toggle
      in checkbox "Mark as done"
      src/ds/components.tsx:107
```

A **subject** is one named UI state you asked for and can ask for again —
`cart/empty` above is the `subjectId` you passed. A **baseline** is the last
image of that subject you approved; later runs compare against it. A **region**
is a box of contiguous changed pixels, attributed to the component that drew it.

`test` and `expect` stay Playwright's. This package exports neither, so your
suite keeps the runner, fixtures, matchers and import paths it already owns.

## Compared with `toHaveScreenshot()`

Keep `toHaveScreenshot()` when `1530 pixels differ` is the answer you want; the
two can assert on the same page in the same test. Three things are different
here.

The failure message names components, and where the engine or a source index can
say so, the file and line behind them — the sample above is the whole message,
with no image opened. A baseline records the browser, platform and scale it was
painted under, so a baseline recorded elsewhere returns `incomparable` rather
than a wall of differences you would have to read through. And the document, the
pixels and the browser's accessibility tree are three separate results, so a role
or accessible name that changed without repainting anything still returns
`changed` — with Playwright's own ARIA snapshots from before and after retained
beside the image.

## Install

```bash
npm install --save-dev @variance-authority/playwright-test @playwright/test
npx playwright install chromium
```

The second command is there because Playwright's browser binaries do not arrive
with an `npm install`. The test hands over a `Page` it has already opened, with a
viewport set.

## Add an observation to a test

Keep importing `test` and `expect` from the suite's existing owner. Pass the
opened `Page`, a bounded `Locator`, and Playwright's `TestInfo` to the additive
helper.

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

`observe` creates and closes its renderer around one observation. It returns an
`Observation`; `assertUnchanged` is a plain assertion helper, not a replacement
for Playwright's `expect`. A test may also inspect `verdict`, `regions`,
`missingFonts`, `signals`, or diagnostics before deciding what to do. `signals`
is where the document, pixel and accessibility results are kept apart.

For several observations in one test, keep one renderer alive explicitly:

```ts
import { test } from '@playwright/test';
import { assertUnchanged, createVariance } from '@variance-authority/playwright-test';

test('the cart states', async ({ page }, testInfo) => {
  const variance = await createVariance(page, testInfo, {
    baselines: 'test-artifacts/variance-baselines',
  });
  try {
    assertUnchanged(await variance.observe(page.getByTestId('cart')));
    assertUnchanged(await variance.observe(page.getByTestId('summary')));
  } finally {
    await variance.close();
  }
});
```

## Establish the first baseline

The first run has nothing to compare against. It returns `new`, `assertUnchanged`
fails, and no image is written: a subject nobody has approved is not an unchanged
subject, and there is no candidate on disk to review yet.

Run it again with Playwright's existing snapshot flag:

```bash
npx playwright test --update-snapshots=all
```

That run repaints the subject and stores the image it just painted as the
baseline — it never paints a second, unseen one. It **passes**: the subject comes
back `unchanged`, with a `because` naming the acceptance and the verdict it
replaced. The comparison and the ranked regions are dropped with it; both
described the baseline that was just replaced. The image is then a file in the
baselines directory (`.variance/baselines` unless you moved it), which is where
you look at what was approved.

Only `--update-snapshots=all` and `=changed` promote anything. Playwright
defaults the field to `missing` when no flag is supplied, and treating the
default as approval would write a baseline from the same failed run that reported
it unreviewed.

Use an explicit `subjectId` for long-lived baselines. When it is omitted, the id
comes from the test title path; renaming the test then produces `new` instead of
silently comparing against a baseline that may describe another scenario.

## Name the file behind a changed region

Attribution names a component. Turning `Toggle` into `src/ds/components.tsx:107`
is a separate hop, and there are three ways it happens.

**Nothing to do, on Chromium.** The page agent keeps the component functions
React actually called, and the session asks Chromium over CDP where each one was
compiled from, mapping the answer back through the served source maps to a
repository file. This is why the sample at the top of this page has a file on it
with no configuration. It speaks only for components that rendered. On WebKit and
Firefox there is no equivalent, the reader notes it once, and nothing is added.

**A `SourceIndex`, for everything else.** A `SourceIndex` is plain data — a map
from component name to the files that declare it — and building one is the
caller's job, because `@variance-authority/core` performs no I/O. Read your
component files and index them:

```ts
import { readFileSync } from 'node:fs';
import {
  indexSource,
  mergeSourceIndexes,
  type SourceIndex,
} from '@variance-authority/core/attribute';

// Repository-relative paths, so the report is portable between machines and CI.
const files = ['src/ds/components.tsx', 'src/checkout/Stack.tsx'];

export const source: SourceIndex = mergeSourceIndexes(
  files.map((file) => indexSource(file, readFileSync(file, 'utf8'))),
);
```

`@variance-authority/core` ships as a dependency of this package; install it
directly to import from it:

```bash
npm install --save-dev @variance-authority/core
```

Pass the result as `source` to `observe`, `session.observe`, `assertUnchanged` or
`toBeUnchanged`. It answers where a component is *declared*, so every instance of
`Toggle` resolves to the same line, and a name two files declare is reported as
ambiguous rather than silently resolved to one of them. The engine's answer is
laid over yours: a name Chromium located replaces your candidates for it, and a
name it never met keeps them.

Both mechanisms name a declaration. If the report must distinguish *which
instance* of a component changed, and the subject is a production React build,
`@variance-authority/jsx-source` is the build instrumentation that passes each
JSX element's own line as far as the fiber. Development React builds already
include it.

With a source index in hand, the message at the top of this page gains the
remaining line:

```
cart/empty: changed — 1530 pixels differ
2 region(s), ordered by area — no causes were supplied, so this
ordering measures displacement rather than blame:
  511px — Stack
      src/checkout/Stack.tsx:12
  86px — Toggle
      in checkbox "Mark as done"
      src/ds/components.tsx:107
```

The ordering is by changed area and the message says so: an `Observation` names
no causes, so area measures displacement — the container that merely reflowed
sorts above the component that was edited. Do not read it as cause-first
attribution.

## Choose where pixels are made

Deferred document rendering is the default. It repaints the acquired document
through the session renderer, which may be local or remote and may reuse its
render cache. The adapter preserves the acquisition base URL but does not archive
resource bytes, so a remote renderer must be able to load equivalent resources.

For a browser the suite already pins, capture the caller-owned locator in place.
Configure Chromium with the exported text-rendering arguments, then declare the
same launch recipe to the session:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { CHROMIUM_RASTER_ARGS } from '@variance-authority/playwright-test';

export default defineConfig({
  use: { launchOptions: { args: [...CHROMIUM_RASTER_ARGS] } },
});
```

```ts
import { test } from '@playwright/test';
import {
  assertUnchanged,
  CHROMIUM_RASTER_ARGS,
  createVariance,
} from '@variance-authority/playwright-test';

test('the cart states', async ({ page }, testInfo) => {
  const variance = await createVariance(page, testInfo, {
    materialization: {
      kind: 'in-place',
      browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
    },
  });
  try {
    assertUnchanged(await variance.observe(page.getByTestId('cart')));
  } finally {
    await variance.close();
  }
});
```

In-place capture takes at least two screenshots and refuses them when they
disagree before consulting a baseline. It opens no second browser. The declared
headless state and ordered launch arguments enter renderer identity; they must
match the suite's Playwright configuration.

## Choose the subject deliberately

The observation accepts a `Locator`, never an unbounded page. A bounded subtree
keeps shared application chrome and unrelated CSS out of the comparison, and
gives changed regions a useful component context.

The helper always acquires the live subtree and semantic evidence. Deferred mode
then paints the document through a renderer. In-place mode screenshots the live
locator and stamps the raster with the browser identity declared by the suite.
Both modes end in the same baseline comparison and attribution path.

The helper also calls Playwright's native `locator.ariaSnapshot()` on the
subject and on React portal content belonging to it. This is separate from the
collector's portable role/name approximation: browser CSS visibility and the
engine's accessible-name computation are the evidence. The trees are retained
beside the image, so the document-digest shortcut cannot report `unchanged`
while the accessibility tree changed.

ARIA evidence is boundary-relative. An empty snapshot means the browser exposed
no accessibility nodes for that root; a snapshot need not include a parent or
children. Those are observed states and compare normally. Only an absent
accessibility field means the boundary was not observed.

## Options and composition

A **band** is the category a change falls into — `a11y`, `geometry`, `token`,
`content` or `texture`, rarest first — and every semantic difference lands in
exactly one. Bands are what a sensitivity level names, and what a report ranks
by.

### `observe(page, locator, testInfo, options)` and `session.observe(locator, options)`

| Option | Use it when | Default and boundary |
| --- | --- | --- |
| `subjectId` | The baseline should survive test-title changes. | The test title path. A renamed implicit id becomes `new`. |
| `subjectKind` | The subject is not a navigated route. | `route`. |
| `fonts` | Renderer identity must include an asserted font stack. | Omitted and reported as missing identity evidence. Values are `family/weight/style/hash`. |
| `source` | Failure output should resolve components to `file:line` on an engine that cannot be asked — WebKit, Firefox, or a component that did not render. | Omitted; regions can still name components. A `SourceIndex`, built as above. |
| `loading` | The subtree's *fallback* is the state you intend to review. | `false`. Waits for nothing, and throws if the subtree turns out to have settled (stopped showing its fallback). |
| `suspenseTimeoutMs` | The subtree legitimately needs longer than five seconds to arrive. | `5000`. `0` skips the wait and keeps the reading. |
| `wiring` | Off for a page that is not React, where walking the fiber tree visits every node and finds nothing. | `true`. Reads props, context, hook cells and keys, so *a prop changed* can be said about a subtree whose markup did not. Its own band; turning it off changes no stored digest. |
| `holdings` | Application values behind the nodes are evidence you want kept. | `false`. Changes `structureHash` — an inert wrapper survives the collapse — so both sides of a comparison must be read the same way. |
| `sensitivity` | This subject is not asserted on in full — a themed embed, a route under an active rebrand. | Undeclared: everything is asserted on. Takes the rule that applies here, already matched: `{ rule, reason, level }`. `level` is `strict`, `layout` (asserts on `a11y` and `geometry`) or `content` (asserts on `a11y` and `content`); the rest are absorbed however large they are, and the verdict is `ignored` with the rule's id in it — which is why it is not a threshold. |

### `createVariance(page, within, options)`

Everything a session owns for its lifetime, as opposed to what one observation
decides. A one-shot `observe` accepts `baselines` and `materialization` too, and
opens and closes the rest itself.

| Option | Use it when | Default and boundary |
| --- | --- | --- |
| `baselines` | Baselines belong somewhere other than the default directory. | `.variance/baselines`. Ignored when `store` is supplied. |
| `store` | Baselines do not live in a directory at all — a remote store, a fixture, a cache. | A durable directory store over `baselines`. |
| `renderer` | The suite already owns a renderer and its lifetime. | One is created and closed with the session. A supplied renderer is never closed by `close()`. |
| `bundle` | The suite deliberately builds its own page agent. | The package's bundled agent. A custom bundle must install itself both in the current document and on future navigations. |
| `tests` | The next run should be able to skip specs whose code nothing touched. | `false`. Requires the application under test to be built with `testSelectionProbes()` from `@variance-authority/sense/journal`; without a collector in the page the session says so on stderr and records nothing. |
| `materialization` | Pixels should come from the browser the suite already pinned. | `{ kind: 'deferred' }`. |
| `evidence` | Somebody will want to look at a disagreement. | Off. Under `varianceFixtures` it is on and writes into the test's own output directory, where the runner reports it from. |

### Seeing the disagreement

A verdict names the components and counts the pixels; a reviewer still asks to
see it. Point `evidence` at a directory and every subject a person stops on --
`changed`, `incomparable`, and `ignored` -- leaves a `.before.png`, an
`.after.png` and a `.diff.png` behind, and the observation says where they went.

The file name is the subject id percent-encoded, so the evidence for one subject
sits in one flat directory even when its id reads like a path: `cart/empty`
writes `cart%2Fempty.after.png`, not `cart/empty.after.png`. Read the paths off
the observation rather than rebuilding them from the id.

```ts
import { test } from '@playwright/test';
import { createVariance } from '@variance-authority/playwright-test';

test('the cart states', async ({ page }, testInfo) => {
  const variance = await createVariance(page, testInfo, {
    evidence: 'test-artifacts/variance-evidence',
  });
  try {
    const observation = await variance.observe(page.getByTestId('cart'), {
      subjectId: 'cart/empty',
    });
    if (observation.evidence !== undefined) {
      console.error(`  ${observation.evidence.diff}`);
    }
  } finally {
    await variance.close();
  }
});
```

`unchanged` and `new` write nothing: there is nothing to look at in the first and
nothing to compare against in the second. Neither does a subject whose baseline
the run refused to compare against -- an `incomparable` verdict leaves the
candidate alone rather than a diff against an image from another environment.
Two images of different sizes leave the pair and no diff, because they have no
common canvas and the sizes are the whole finding.

Off by default on the direct path, and off is a real choice: the images are the
largest thing a run can produce, and a suite that reads the verdict in CI and
opens no pictures should not pay for them. Under `varianceFixtures` the runner
already owns a per-test output directory it cleans and reports from, so there it
is on and each image is attached to the test.

### Driving Playwright from another runner

`within` is Playwright's `TestInfo` or a plain run descriptor. Suites that drive
a browser from vitest, `node:test` or a script have every fact this package
reads from `TestInfo` and no `TestInfo` to put them in, so they state them:

```ts
import { createVariance } from '@variance-authority/playwright-test';
import type { Page } from '@playwright/test';

declare const page: Page;

const variance = await createVariance(page, {
  id: 'checkout/empty-cart',
  colorScheme: 'light',
  deviceScaleFactor: 1,
  baseURL: 'http://localhost:5001',
  accepting: process.env.UPDATE_SNAPSHOTS === '1',
});
```

| Field | Use it when | Default and boundary |
| --- | --- | --- |
| `id` | Observations do not each name a `subjectId`. | None. An observation with neither is refused rather than given an invented address. |
| `colorScheme`, `deviceScaleFactor` | Ever. Both partition the baseline. | `light` and `1`. |
| `baseURL` | Recording should know where the page is served. | Omitted; a service under test then sees the execution from the first observation rather than the first request. |
| `owner` | The run records which spec covered which source. | Omitted; the run records no execution against a file. |
| `accepting` | This run is the one promoting candidates to baselines. | `false`. Under `TestInfo` it is `--update-snapshots=all\|changed` and nothing else — `missing` is the flag's absence. |

`runOf(testInfo)` is the same reading, exported for a suite that wants to take
Playwright's answer and override one field.

#### An Rstest suite

[Rstest](https://rstest.rs) drives Playwright through `@rstest/playwright`,
which hands the test body a real `Page` and no `TestInfo`. The five facts are
still there, spread across three of the values the body destructures, and
`@variance-authority/playwright-test/rstest` reads them:

```ts
import { createVariance, CHROMIUM_RASTER_ARGS } from '@variance-authority/playwright-test';
import { runOf } from '@variance-authority/playwright-test/rstest';
import { test } from '@rstest/playwright';

test('cart', async ({ page, task, expect, playwright }) => {
  await page.goto('/cart');
  const variance = await createVariance(page, runOf({ task, expect, playwright }), {
    materialization: {
      kind: 'in-place',
      browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
    },
  });

  try {
    expect((await variance.observe(page.locator('#cart'))).verdict).toBe('unchanged');
  } finally {
    await variance.close();
  }
});
```

The three are passed separately because Rstest requires a test body's first
parameter to be an object pattern, so there is no whole context to hand over.
`expect` is the one the body was handed, which saves importing a second.
`id` is the test's title path, `owner` is the spec relative to the project root,
the raster partition — colour scheme, scale factor and base URL — is read off
the `playwright` fixture's `contextOptions`, whatever `definePlaywrightConfig`
resolved them to, and `accepting` is `rstest run -u` — Rstest's default writes
snapshots that have none yet, which is an absence and not an approval.

An Rstest test that runs in `node` or `jsdom` and starts no browser is the other
adoption: it writes a capture with
[`@variance-authority/unit-test`](../unit-test/README.md) and a later CLI run
paints it. Nothing in this package is on that path.

`materialization` selects how pixels are produced; its `kind` field picks the
strategy. `kind: 'in-place'` requires `browser`, the declared launch of the
suite's own Chromium (`headless` and the ordered `launchArgs`), which is what
enters renderer identity; `stabilityChecks` defaults to `2` and cannot go lower
than two captures.

A subject photographed in place is photographed while the application is still
running, so a menu that has just opened or a snackbar sliding in will disagree
with itself between two reads. `settleAttempts` is how many times it is given to
come to rest, `3` by default; the confirming read of a failed attempt is the next
attempt's acquisition, so a retry costs a screenshot pair and no extra
round-trip. Set it to `1` for a suite that wants a subject which moves at all to
be a failure. A subject that never holds still is still refused, and the refusal
says how many attempts bought nothing.

## Record what each spec executed

`variance run --since <ref>` and `variance select --since <ref>` skip specs whose
code nothing touched. What they read is written here: a **crossing** is the fact that one test entered
one probed block of your application. Recording them requires the application
under test to be built with `testSelectionProbes()` from
`@variance-authority/sense/journal`.

Recording joins every observation in one spec file to that file: the runner's
unit of execution is the file, so an attribution finer than that is one no
selector could spend. A worker accumulates and writes once at teardown, under a
lock on the index, so parallel workers do not overwrite each other. A spec whose
test failed is recorded as incomplete — its crossings still count, and it can
never justify skipping itself later.

### Fold what the workers recorded

Playwright runs specs in worker processes, and the execution index is one file
that is merged rather than appended to. When two workers each record part of one
spec file, the later merge retires the earlier worker's crossings: the file is
then recorded as fully observed with half of what it walked, and the next
`--since` skips it over a line that ran. Nothing fails — the run is green and
the index quietly wrong, which is the one direction selection may not go.

So add the reporter. The workers stage what they recorded and it folds once, at
the end of the run:

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [['list'], ['@variance-authority/playwright-test/reporter']],
  use: { varianceExecution: true },
});
```

It is worth installing for a single-worker run too: a worker that finds no
staging directory merges for itself and says so on stderr, and one that does
contribute costs a file write it would have spent on the merge anyway.

The reporter takes the same values the fixture was given, and they have to
match — the workers stage crossings recorded against one root and one build's
records, and a mismatch is not an error anybody sees but a record written under
paths no later run will ask about.

| Option | Purpose | Default |
| --- | --- | --- |
| `root` | Repository root the recorded paths are relative to. | The cwd. |
| `label` | Matches the `label` given to `testSelectionProbes()`. | `build` |
| `cacheRoot` | Where that build wrote its block records. | The user cache. |
| `coverageFile` | The coverage index this run merges into. | The repository-keyed user cache. |
| `mode` | The probe recipe, matching the `mode` given to `testSelectionProbes()`. | `presence` |
| `preconditions` | Files whose contents are a precondition of every observation this run records. | None. |
| `cases` | Also write the execution index: which individual test entered which region. | `false` |
| `executionFile` | Where that index goes. | Beside the snapshot: `<coverage file>.cases.json`. |

`mode` has to be the same answer everywhere one coverage index is written:
a snapshot names the recipe its ordinals were cut by, and a merge discards a
layer cut by another one, so a build probing under `entries` and a reporter
folding under `presence` would each wipe the other every run.

`cases` is off by default and stays off for most suites. The index answers
*which tests walk this branch* — the question `variance covering` and
`@variance-authority/distill` are asked — and it is a row per test per region,
so a suite that indexes to answer a question nobody asks has bought a large file
and nothing else. Selection does not read it: a spec file is the smallest thing
Playwright can be asked to run, and the file-level record already names that.

### Optional fixture composition

| Fixture | Purpose | Default |
| --- | --- | --- |
| `varianceBaselines` | Directory of durable baselines. | `.variance/baselines` |
| `varianceRenderer` | Renderer shared by one Playwright worker. | A Playwright renderer created and closed by the fixture. |
| `varianceStore` | Baseline and render-cache implementation. | Durable directory store using `varianceBaselines`. |
| `varianceBundle` | Page agent installed before application code runs. | The package's bundled agent. |
| `varianceExecution` | Record what each spec executed, for the next run's selection. | `false`. Accepts `true` or `{ root, label, cacheRoot, coverageFile, cases, executionFile, heads, origin }`, and is set like any Playwright option: `use: { varianceExecution: true }`. |
| `varianceEvents` | Whether services behind the page announce, and where the driver leaves its return address. | `{}`. Accepts `heads` (the services that report for themselves, described below) and `origin`. The browser half needs neither. |
| `varianceWire` | The worker's end of the loopback listener the page and any reporting service answer on. | A listener on an ephemeral port, opened and closed by the fixture. |
| `varianceVantage` | Where this worker reports what it is doing, for a process watching the run. | Whatever `VARIANCE_AUTHORITY_VANTAGE` names, and `undefined` when nothing does. |

### Recording what a service executed

The fixture above records the page. A suite that drives its application through
that application's own API executes product source in a second process, and
nothing in the page knows it happened — so a change to a route handler runs every
spec forever, no matter how well the browser half is watched.

A **head** is a service that reports its own crossings. `heads` names them. Each
one runs `collectJourneys()` from `@variance-authority/sense/journey` under the
same name its build gave `testSelectionProbes()`, and one environment block is
the whole of the configuration on that side:

```ts
// playwright.config.ts
export default {
  use: {
    baseURL: 'http://localhost:3000',
    varianceExecution: { heads: ['api'] },
  },
  webServer: {
    command: 'node ./server.js',
    url: 'http://localhost:3000',
    env: {
      VARIANCE_AUTHORITY_JOURNEYS: '1',
      VARIANCE_AUTHORITY_HEAD: 'api',
    },
  },
};
```

Every test mints one **journey** — an opaque id for one execution of one subject,
one per attempt, because a flake and its retry are two executions a service has
to be able to tell apart. The fixture puts it on the browser context before the
spec navigates, beside the address this worker is listening on. The browser
attaches both to every same-origin request, so nothing in the application is
touched to send them, and the spec file's *name* never leaves the runner.
`VARIANCE_AUTHORITY_JOURNEYS` says only that the service is under a run — any
value will do, because where to report is a fact about the request rather than
about the environment. `origin` overrides the origin the cookies are scoped to
and defaults to the project's `baseURL`.

Nothing is written by the service. Its accounts are acknowledged over the same
listener the announcements below use, under the same journey, and the run's only
artifact is the coverage index this worker merges into at teardown.

Nothing above happens when `heads` is empty, which is the default and the
ordinary case. A suite driving one application has one instrumented process, and
nothing can be missing from it.

**Naming a head is a promise, and a promise this checks.** The extra setup is
extra: it can be left out of one CI job, the service can fail to start, and a
service built without probes looks exactly like a service that executed nothing.
So a declared head that reports nothing all run — or one reporting a different
probe recipe than the driver records — retires **every** observation the run
made, page included. The crossings are still written; what they lose is the right
to justify a skip, and the next `--since` runs the whole suite and prints the
reason. A run half of whose evidence never arrived narrows nothing, because a
spec skipped on the say-so of a service that was not watching is the one failure
this category cannot detect afterwards.

## Wait for a decision, not for a repaint

`events` is the driver half of `@variance-authority/event`. Where `variance`
asks what the screen looks like, this answers *when the code decided*, which is
the question a screen cannot answer at all for the branch that draws nothing:
**the modal is not shown** and **the modal is not shown yet** look identical, and
waiting longer never separates them.

The application announces at the decision:

```ts
import { vae } from '@variance-authority/event';

declare function shouldUpsell(): Promise<boolean>;
declare function setUpsell(open: boolean): void;

export async function decideUpsell(): Promise<void> {
  const show = await shouldUpsell();
  vae('checkout', 'upsell-modal', 'decided');
  if (show) setUpsell(true);
}
```

The spec names the same three coordinates back, and then asserts the screen once:

```ts
import { test, expect } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';

const suite = test.extend(varianceFixtures);

suite('the upsell stays away', async ({ page, events }) => {
  await page.goto('/checkout');
  await events.happened('checkout', 'upsell-modal', 'decided');
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 0 });
});
```

Nothing configures the browser half and nothing builds for it. The fixture
evaluates the listener before navigation and takes what the page announces; a
test that never destructures `events` sets none of it up. A wait also settles
against announcements already heard, so one written a line too late still
resolves rather than hanging.

`events` is an `EventLog`: `happened` waits for coordinates in any phase,
`finished` waits for the end of a process `vaStart` opened, `saw` asks without
waiting, `seen` is everything in arrival order, and `pending` is what started and
never ended. A wait that does not settle prints what the run did announce, in
order, or says that nothing was announced at all — which is a setup fact, not a
product defect, and is worded as one.

### Hearing a service announce

A process behind the page answers several tests at once, so an announcement
leaving it has to name the execution it belonged to; otherwise one test's wait is
settled by another test's decision. That id is the same journey the recording
above puts on the browser context, and the fixture mints one for events when
nothing else has.

The service runs `collectEvents()` from `@variance-authority/event/collect`, and
one environment block tells both ends that heads are in play:

```ts
// playwright.config.ts
export default {
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'node ./server.js',
    url: 'http://localhost:3000',
    env: {
      VARIANCE_AUTHORITY_EVENTS: '1',
      VARIANCE_AUTHORITY_HEAD: 'api',
    },
  },
};
```

Nothing is written down and no path is agreed. The worker listens on a loopback
port it was given, and the cookie beside the journey carries that address into
whatever the page talks to, so a head answers the execution it is serving as it
serves it.

It is one listener for both instruments. Announcements and coverage accounts are
two things said about the same execution, so they arrive over one connection
([`@variance-authority/wire`](https://variance-authority.dev/reference/packages/wire)) under one journey, and this end
reads only which of the two was speaking. A page reports through a function the
worker exposed and a service reports through a socket; nothing below routes on
which, which is why a server the suite starts in-process needs no configuration
at all.

`heads` overrides whether services are expected — it defaults to whether
`VARIANCE_AUTHORITY_EVENTS` is set, which is how the service was told — and
`origin` overrides the origin both cookies are scoped to, defaulting to the
project's `baseURL`.

The extra setup is extra, and its absence is quiet: with nothing configured, the
page still answers and services are simply silent. An announcement that arrives
for an execution no test here owns is counted and named in the failure rather
than handed to whichever test was nearby.

### Matcher integration

`toBeUnchanged` reads the same verdict as a matcher rather than an assertion; it
takes an `Observation`, not a `Locator`. Both it and `assertUnchanged` accept
`UnchangedOptions`, whose `source` field is a `SourceIndex` resolving components
to `file:line` when the observation was made without one.

```ts
// the suite's own expect, in the suite's own extension module
import { expect as base } from '@playwright/test';
import { observe, varianceMatchers } from '@variance-authority/playwright-test';

export const expect = base.extend(varianceMatchers);

// …then, in a test:
declare const observation: Awaited<ReturnType<typeof observe>>;
expect(observation).toBeUnchanged();
```

`varianceFixtures` and `varianceMatchers` are exported as unbound pieces for a
suite that already owns a shared Playwright extension module. Compose them into
that module's existing `test` and `expect`; this package never exports either
symbol. Override the worker fixtures only when the suite deliberately supplies
another renderer, store, or agent bundle. The public types are
`VarianceWorkerFixtures`, `VarianceFixtures`, `VarianceOptions`,
`VarianceEventFixtures`, `VarianceEventWorkerFixtures`,
`VarianceEventsOptions`, `VarianceVantageFixtures`, and
`VarianceVantageWorkerFixtures`.

The package also exports `bundlePageAgent`, `acquire`, `AGENT`, and
`AGENT_VERSION` for authors building a custom Playwright fixture. Ordinary test
suites should use `observe` or `createVariance`; the low-level exports do not
create a renderer, store, or acceptance lifecycle on their own.

## Watch the run from outside it

Everything above is spent inside the worker: a wait settles, the test continues,
and what it heard is discarded. That is right for a wait and useless to anybody —
a person or an agent — trying to understand a suite that is *still going*.

`varianceVantageFixtures` reports the run to a watching process, and
`varianceFixtures` already includes it. One variable is the whole of the setup:

```bash
VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321 npx playwright test
```

With it unset, nothing happens and the run pays one environment read per worker
— the same bargain the heads make above. With it set, the watcher is told each
test as it opens, each announcement as it is recorded rather than at teardown, the
listener's remarks, and how each test ended. The process on the other end is
[`@variance-authority/vantage`](https://variance-authority.dev/reference/packages/vantage), on the same
connection the announcements already use, and none of it is written down.

The lifecycle half is automatic, so a listing has no holes: a test that
destructures nothing still opens and closes, and a suite that takes no
screenshot reports exactly what one that does reports. What it adds beyond that
comes from the fixtures a test did take — the announcements are the `events`
fixture's.

The watcher an agent talks to is [`@variance-authority/mcp`](https://variance-authority.dev/reference/packages/mcp),
started with `variance-authority-mcp --watch`. It prints the line above with its
own address in it, then answers which tests are running, and what the one that
is hanging has heard so far.

### Stop a test where you want to look at it

The `variance` fixture has two more calls, for when you want a watcher to
see a particular moment rather than the whole run:

```ts
import { test } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';

const suite = test.extend(varianceFixtures);

suite('the cart settles', async ({ page, variance }) => {
  await page.getByRole('button', { name: 'Add' }).click();
  variance.snapshot('one item in');

  await page.getByRole('button', { name: 'Checkout' }).click();
  await variance.observe('before the card form appears');

  await variance(page.getByTestId('cart'));
});
```

`snapshot` sends what is here now and keeps going. `observe` sends it and then
pauses the test where it is — the page still up, the network still whatever it
was — until an agent that has looked around calls `variance_continue`. Neither
takes a line number: both read their own.

Leave them in. With `VARIANCE_AUTHORITY_VANTAGE` unset, `observe` returns
immediately and `snapshot` sends nothing, so a spec that has them runs straight
through in CI — which is what separates them from the `debugger;` and `.only`
they stand in for. While a test is standing still, the runner's clock is
stopped, and when it goes on it has exactly the time it had before.

Outside this package's own fixture, `varianceDesk(vantage, testId, options)`
takes the same two calls anywhere a watcher connection and a test id can be had.
Its `reprieve` option is how the stopped clock above is installed — called when a
wait begins, and what it answers is called when the wait ends — and
`runnerReprieve(testInfo)` is the Playwright spelling of it. A host with no clock
passes neither.

They work anywhere the test is awaiting, not only in the test body: a helper the
test awaits, or a `page.route` handler it awaits, stops just the same. A call in
a frame nobody awaits — an effect, a render body — cannot stop anything, and
does not.

## Loading and Suspense boundaries

Before the subtree is acquired, the integration waits for every React Suspense
boundary under the locator to **settle** — stop showing its fallback. This runs
first, ahead of stabilization, because content that arrives late brings its own
images and fonts.

A subtree still showing a fallback when `suspenseTimeoutMs` runs out throws,
naming the open boundaries and the components that wrote them.

Pass `loading: true` when the fallback itself is the subject you want to
review:

```ts
import { test } from '@playwright/test';
import { assertUnchanged, observe } from '@variance-authority/playwright-test';

test('the cart is reviewed while it loads', async ({ page }, testInfo) => {
  await page.goto('https://example.test/cart');

  const observation = await observe(page, page.getByTestId('cart'), testInfo, {
    subjectId: 'cart/loading',
    loading: true,
  });

  assertUnchanged(observation);
});
```

`loading` is a **declared** state, checked against what actually happened: a
subtree declared as a loading capture that turns out to have **settled** by
the time it is read throws as well.

## Read and act on failures

- **`new`:** no baseline exists for this subject id. Run once with
  `--update-snapshots=all`, look at the image it stored, then rerun normally.
- **`incomparable`:** a baseline exists under another renderer identity. Align
  browser, platform, scale, and asserted fonts instead of accepting the wall of
  changes.
- **Changed regions name components but no files:** the engine could not be
  asked — this is WebKit, Firefox, or a component that did not render. Pass a
  `SourceIndex` as `source` to `observe`, `session.observe`, or
  `assertUnchanged`.
- **“variance needs a viewport and this page has none”:** the Playwright page
  uses a null viewport. Configure a fixed viewport so two runs have a declared
  size.
- **The message lists a large container first:** it is ordered by changed area,
  and says so. Area measures displacement, not blame: a container that merely
  reflowed outranks the component that was edited.
- **“was still waiting when it was read”:** the named Suspense boundary never
  resolved. Fix what it awaits, or pass `loading: true` if the fallback is what
  you intend to review.
- **The page agent is missing:** use `observe`, `createVariance`, or compose
  `varianceFixtures`; avoid replacing the bundle unless the custom bundle is
  installed in both the current document and future navigations.

## Boundaries

This package does not merge Playwright shards into one report. Playwright's
`--shard` can still run the tests, but each shard owns its own result set.

Use a different package when a Playwright test isn't the right place to start:
for a Storybook inventory use `@variance-authority/storybook-collector`; for a
map of served pages use `@variance-authority/route-collector`; for two
documents already in hand, or a custom renderer and store composition, use
`@variance-authority/observe`; for browserless Jest or Vitest acquisition
followed by a later renderer, use `@variance-authority/unit-test`.

---

**[@variance-authority/playwright-test](https://variance-authority.dev/reference/packages/playwright-test)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
