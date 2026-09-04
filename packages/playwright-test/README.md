<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/playwright-test

> Add a source-aware visual observation to a Playwright test that already knows how to reach the state.

A **subject** is the piece of UI a test observes: the `Locator` you pass in,
identified by a `subjectId`. A **baseline** is the last screenshot of that
subject a human approved; later runs compare against it. An observation is
**source-aware** when you pass a `SourceIndex` as `source` — changed regions
then resolve to `file:line` instead of just a component name.

This package adds that observation to a Playwright test that already knows
how to navigate, authenticate, mount data, and wait for the application. The
test body remains the collector: this package does not export `test` or
`expect`, and the suite keeps the runner, fixtures, matchers, and import
paths it already owns.

Use this integration when the state you need is already easiest to reach in a
Playwright test:

```bash
npm install --save-dev @variance-authority/playwright-test @playwright/test
npx playwright install chromium
```

The second command is there because Playwright's browser binaries do not arrive
with an `npm install`. The test hands over a `Page` it has already opened, with
a viewport set.

## Add an observation to a test

Keep importing `test` and `expect` from the suite's existing owner. Pass the
opened `Page`, a bounded `Locator`, and Playwright's `TestInfo` to the additive
helper.

```ts
import { test, expect } from '@playwright/test';
import { assertUnchanged, observe } from '@variance-authority/playwright-test';

test('the cart survives an empty basket', async ({ page }, testInfo) => {
  await page.goto('https://example.test/cart');
  await page.getByRole('button', { name: 'Clear' }).click();

  const observation = await observe(page, page.getByTestId('cart'), testInfo, {
    subjectId: 'cart/empty',
  });

  assertUnchanged(observation);
  expect(observation.subject).toBe('cart/empty');
});
```

`observe` creates and closes its renderer around one observation. It returns an
`Observation`; `assertUnchanged` is a plain assertion helper, not a replacement
for Playwright's `expect`. A test may also inspect `verdict`, `regions` (the
changed areas, each attributed to a component when the comparison can tell),
`missingFonts`, `signals`, or diagnostics before deciding what to do. `signals`
keeps document, pixel, and browser accessibility results separate; an invisible
ARIA change therefore returns `changed` with zero changed pixels and retained
before/after Playwright ARIA snapshots.

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

## Choose where pixels are made

Deferred document rendering is the default. It repaints the acquired document
through the session renderer, which may be local or remote and may reuse its
render cache. The adapter preserves the acquisition base URL but does not archive
resource bytes, so a remote renderer must be able to reach equivalent resources.

For a browser the suite already pins, capture the caller-owned locator in place.
Configure Chromium with the exported text-rendering arguments, then declare the
same launch recipe to the session:

```ts
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

## Establish the first baseline

The first run returns `new`, and `assertUnchanged` fails. That is intentional: a
subject nobody has approved is not an unchanged subject.

After reviewing the candidate, promote the image with Playwright's existing
snapshot flag:

```bash
npx playwright test --update-snapshots=all
```

Acceptance promotes the candidate painted by that run; it never paints a second,
unseen image. That run **passes**: the subject it promoted comes back
`unchanged`, with a `because` naming the acceptance and the verdict it
replaced. The comparison and the ranked regions are dropped with it — both
described the baseline that was just replaced.

Only `--update-snapshots=all` and `=changed` cross that boundary. Playwright
defaults the field to `missing` with no flag supplied, and treating the default as
approval would write a baseline from the same failed run that reported it
unreviewed.

Use an explicit `subjectId` for long-lived baselines. When it is omitted, the id
comes from the test title path; renaming the test then produces `new` instead of
silently comparing against a baseline that may describe another scenario.

## Choose the subject deliberately

The observation accepts a `Locator`, never an unbounded page. A bounded subtree
keeps shared application chrome and unrelated CSS out of the comparison, and
gives changed regions a useful component context.

The helper always acquires the live subtree and semantic evidence. Deferred mode
then paints the document through a renderer. In-place mode screenshots the live
locator and stamps the raster with the browser identity declared by the suite.
Both modes reach the same baseline comparison and attribution path.

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

### `observe(page, locator, testInfo, options)` and `session.observe(locator, options)`

| Option | Use it when | Default and boundary |
| --- | --- | --- |
| `subjectId` | The baseline should survive test-title changes. | The test title path. A renamed implicit id becomes `new`. |
| `subjectKind` | The subject is not a navigated route. | `route`. |
| `fonts` | Renderer identity must include an asserted font stack. | Omitted and reported as missing identity evidence. Values are `family/weight/style/hash`. |
| `source` | Failure output should resolve components to `file:line`. | Omitted; regions can still name components. |
| `loading` | The subtree's *fallback* is the state you intend to review. | `false`. Waits for nothing, and throws if the subtree turns out to have settled (stopped showing its fallback). |
| `suspenseTimeoutMs` | The subtree legitimately needs longer than five seconds to arrive. | `5000`. `0` skips the wait and keeps the reading. |
| `wiring` | The subtree is not React, so the fiber walk buys an absent band. | `true`. A band of its own; turning it off changes no stored digest. |
| `holdings` | Application values behind the nodes are evidence you want carried. | `false`. Changes `structureHash` — an inert wrapper survives the collapse — so both sides of a comparison must be read the same way. |

### `createVariance(page, testInfo, options)`

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

`materialization` selects how pixels are produced; its `kind` field picks the
strategy. `kind: 'in-place'` requires `browser`, the declared launch of the
suite's own Chromium (`headless` and the ordered `launchArgs`), which is what
enters renderer identity; `stabilityChecks` defaults to `2` and cannot go lower
than two captures.

### Optional fixture composition

| Fixture | Purpose | Default |
| --- | --- | --- |
| `varianceBaselines` | Directory holding durable baselines. | `.variance/baselines` |
| `varianceRenderer` | Renderer shared by one Playwright worker. | A Playwright renderer created and closed by the fixture. |
| `varianceStore` | Baseline and render-cache implementation. | Durable directory store using `varianceBaselines`. |
| `varianceBundle` | Page agent installed before application code runs. | The package's bundled agent. |
| `varianceExecution` | Record what each spec executed, for the next run's selection. | `false`. Accepts `true` or `{ root, label, modulesFile, coverageFile, heads, origin }`, and is set like any Playwright option: `use: { varianceExecution: true }`. |
| `varianceEvents` | Whether services behind the page announce, and where the driver leaves its return address. | `{}`. Accepts `heads` and `origin`. The browser half needs neither. |
| `varianceWire` | The worker's end of the medium every instrumented realm answers on. | A loopback listener on an ephemeral port, opened and closed by the fixture. |
| `varianceVantage` | This worker's voice to whoever is watching the run. | Whatever `VARIANCE_AUTHORITY_VANTAGE` names, and `undefined` when nothing does. |

Recording joins every observation in one spec file to that file: the runner's
unit of execution is the file, so an attribution finer than that is one no
selector could spend. A worker accumulates and writes once at teardown, under a
lock on the index, so parallel workers do not overwrite each other. A spec whose
test failed is recorded as incomplete — its crossings still count, and it can
never justify skipping itself later.

### Recording what a service executed

The fixture above records the page. A suite that drives its application through
that application's own API executes product source in a second process, and
nothing in the page knows it happened — so a change to a route handler runs every
spec forever, no matter how well the browser half is watched.

`heads` names the services that report for themselves. Each one runs
`collectJourneys()` from `@variance-authority/sense/journey` under the same name
its build gave `testSelectionProbes()`, and one environment block is the whole of
the configuration on that side:

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

Every test mints one opaque id — one per attempt, because a flake and its retry
are two executions a service has to be able to tell apart — and the fixture puts
it on the browser context before the spec navigates, beside the address this
worker is listening on. The browser attaches both to every same-origin request,
so nothing in the application is touched to carry them, and the spec file's
*name* never leaves the runner. `VARIANCE_AUTHORITY_JOURNEYS` says only that the
service is under a run — any value will do, because where to report is a fact
about the request rather than about the environment. `origin` overrides the
origin the cookies are scoped to and defaults to the project's `baseURL`.

Nothing is written by the service. Its accounts are acknowledged over the same
medium the announcements below travel, under the same id, and the run's only
artifact is the coverage index this worker merges into at teardown.

Nothing above happens when `heads` is empty, which is the default and the
ordinary case. A suite driving one application has one instrumented realm, and
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
two things said about the same execution, so they arrive on one medium
([`@variance-authority/wire`](../wire/README.md)) under one id, and this end
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
`UnchangedOptions`. Its `source` field is a `SourceIndex` resolving components
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

Everything above is spent inside the worker: a wait settles, the test moves on,
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
listener's remarks, and how each test ended. It is
[`@variance-authority/vantage`](../vantage/README.md) on the other end, over the
medium the announcements already travel, and none of it is written down.

`varianceWatched` is automatic, so a listing has no holes: a test that
destructures nothing still opens and closes, and a suite that takes no
screenshot reports exactly what one that does reports. What it adds beyond that
comes from the fixtures a test did take — the announcements are the `events`
fixture's.

The watcher an agent talks to is [`@variance-authority/mcp`](../mcp/README.md),
started with `variance-authority-mcp --watch`. It prints the line above with its
own address in it, then answers which tests are running, and what the one that
is hanging has heard so far.

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
import { observe } from '@variance-authority/playwright-test';

test('the cart is reviewed while it loads', async ({ page }, testInfo) => {
  const observation = await observe(page, page.getByTestId('cart'), testInfo, {
    loading: true,
  });
});
```

`loading` is a **declared** state, checked against what actually happened: a
subtree declared as a loading capture that turns out to have **settled** by
the time it is read throws as well.

## Read and act on failures

- **`new`:** no baseline exists for this subject id. Review and run once with
  `--update-snapshots`, then rerun normally.
- **`incomparable`:** a baseline exists under another renderer identity. Align
  browser, platform, scale, and asserted fonts instead of accepting the wall of
  changes.
- **Changed regions name components but no files:** pass a `SourceIndex` as
  `source` to `observe`, `session.observe`, or `assertUnchanged`.
- **“variance needs a viewport”:** the Playwright page uses a null viewport.
  Configure a fixed viewport so two runs have a declared size.
- **The assertion lists a large container first:** this integration's docket is
  ordered by changed area and explicitly describes that as displacement, not
  blame. Do not read its ordering as cause-first attribution.
- **“still waiting when it was read”:** the named Suspense boundary never
  resolved. Fix what it awaits, or pass `loading: true` if the fallback is what
  you intend to review.
- **The page agent is missing:** use `observe`, `createVariance`, or compose
  `varianceFixtures`; avoid replacing the bundle unless the custom bundle is
  installed in both the current document and future navigations.

## Boundaries

This package does not merge Playwright shards into one docket. Playwright's
`--shard` can still run the tests, but each shard owns its own result set.

Use a different package when a Playwright test isn't the right place to start:
for a Storybook inventory use `@variance-authority/storybook-collector`; for a
map of served pages use `@variance-authority/route-collector`; for two
documents already in hand, or a custom renderer and store composition, use
`@variance-authority/observe`; for browserless Jest or Vitest acquisition
followed by a later renderer, use `@variance-authority/unit-test`.
