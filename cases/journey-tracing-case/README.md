# One execution followed into a service

This case records what a run *executed* across a process boundary the test
driver cannot see through. The execution starts in a Chromium page and finishes
inside an HTTP service, and the service is where the code that decides actually
lives.

What is recorded is a **journey**: the set of source regions one execution
covered — which function bodies and which branches it was inside, in every
process it touched.

## What this demonstrates

One execution, driven through a real browser into a service the driver cannot
see inside, comes back as two different kinds of evidence under one id.

The page asks the service for a price. The service picks a branch by locale and
announces the decision; the same request, in the same instrumented module, also
records which regions of that source it covered. The spec waits on the
announcement and then asserts the screen once, with polling switched off.

Both instruments travel on one medium. The service is handed a `Cookie` header
naming the execution and where to answer, and nothing else — no report
directory, no configured port, no second channel to keep in step. What the
service says about a decision and what it says about coverage differ only in
which participant was speaking.

## The files

| Path | What it is |
| --- | --- |
| [`src/pricing.mjs`](src/pricing.mjs) | Product source. `quote(locale)` returns `'1200 EUR'` on `de` and `'1200 USD'` otherwise, and announces which branch it took. It knows nothing about a test. |
| [`src/server.mjs`](src/server.mjs) | The service, in its own process. It installs both collectors, applies `testSelectionProbes()` to `pricing.mjs` the way a bundler would, and wraps each request in `journeys.enter(cookie, …)` and `events.enter(cookie, …)`. |
| [`src/playwright.config.mjs`](src/playwright.config.mjs) | Two workers, `fullyParallel`, and the `varianceExecution` fixture option that mints the id and names the coverage file. Starts the service through `webServer`. |
| [`src/spec/euros.spec.mjs`](src/spec/euros.spec.mjs) | Loads `/?locale=de`, waits for the `euros` announcement, asserts the screen once. |
| [`src/spec/dollars.spec.mjs`](src/spec/dollars.spec.mjs) | The same for `/?locale=en` and `dollars`. |
| [`src/workflow.chromium.test.js`](src/workflow.chromium.test.js) | The outer Vitest file. It runs the two specs through the Playwright CLI in a throwaway directory, then asks the coverage index a question neither spec can answer for itself. |

## Run it

You need a checkout, `yarn install`, a built workspace (`yarn build` — the outer
file imports `@variance-authority/sense/test-selection` through the package
manifest, which resolves to `dist/`), and a Chromium binary
(`npx playwright install chromium`). Without the browser the case skips and
prints the install command; it does not fail.

From the repository root:

```console
$ yarn vitest run cases/journey-tracing-case/src/workflow.chromium.test.js

 RUN  v2.1.9 /Users/you/variance-authority

 ✓ cases/journey-tracing-case/src/workflow.chromium.test.js (1 test) 2430ms
   ✓ a journey that crosses into a service > is announced and recorded under one id, and narrows the next run 2428ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  2.92s
```

The two specs run inside that, through the real Playwright CLI:

```console
Running 2 tests using 2 workers

  ✓  1 src/spec/euros.spec.mjs:6:1 › the euro branch is entered by this spec and no other (86ms)
  ✓  2 src/spec/dollars.spec.mjs:6:1 › the dollar branch is entered by this spec and no other (88ms)

  2 passed (1.3s)
```

## The question the outer file asks

Given a diff touching one line of `src/pricing.mjs`, which specs must run? The
outer file reads the line numbers out of the source rather than hard-coding
them, builds a one-hunk diff at each, and calls `selectTestFiles` against the
coverage index:

```js
expect(await selectTestFiles(coverage, diffAt('src/pricing.mjs', euros))).toEqual([
  'src/spec/euros.spec.mjs',
]);
expect(await selectTestFiles(coverage, diffAt('src/pricing.mjs', dollars))).toEqual([
  'src/spec/dollars.spec.mjs',
]);
```

Neither spec mentions the other's branch, and neither one ran a line of
`pricing.mjs` — it executed in the service process. The answer exists only
because the service reported home under the id the driver minted.

## Scope

Nothing here writes a report; the page itself is not instrumented, and
everything recorded was executed in the other process. The only artifact is the
coverage index the driver merges into at teardown, written into a temporary
directory the outer file creates and removes. The head inventory the service's
build writes is keyed by repository, so the outer file's `XDG_CACHE_HOME` is the
whole of what keeps this run out of your own cache.
