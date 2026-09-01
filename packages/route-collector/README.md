<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/route-collector

> Turn pages your application already serves into Variance Authority subjects.

A **subject** is the rendered unit a report compares against its approved
baseline. This package is a **collector**: a module that plans subjects from
your routes and hands `@variance-authority/cli` what to render, via
`subjects.collector` in `variance.config.json`. Use it when the real
application has already solved bundling, providers, routing, and mounting,
and the remaining integration is to name the pages, bound the part that
matters, and say when each one is ready.

It navigates routes you give it — it does not crawl links, and it is not a
web server for your application. It has no cookie, header, or storage-state
login support (see **When integration fails**, below, for the alternative).

```bash
npm install --save-dev @variance-authority/cli @variance-authority/route-collector
npx playwright install chromium
```

The second command is there because Playwright's browser binaries do not arrive
with an `npm install`. Point it at an application it can reach, or at a static
directory if you have one built.

## Integrate an explicit route list

### 1. Start the application

Run the same server whose redirects, assets, and runtime behavior you want to
observe. Readiness belongs to that page, so wait for an application-owned marker
rather than adding an arbitrary delay.

### 2. Add a collector module

```js
// variance/routes.mjs
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: {
    'checkout/empty': 'http://localhost:3000/checkout',
    'checkout/one-item': 'http://localhost:3000/checkout?items=1',
  },
  roots: ['#app'],
  ready: { 'checkout/one-item': '[data-testid="cart-ready"]' },
  source: { dirs: ['src'] },
});
```

`roots` defines the subject. The default is `body`, meaning the entire page is
under review. A tighter root keeps shared navigation or application chrome out
of every route unless it is intentionally part of the assertion.

### 3. Declare the same ids in the CLI config

```json
{
  "project": "checkout-ui",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": {
    "kind": "list",
    "ids": ["checkout/empty", "checkout/one-item"],
    "collector": "variance/routes.mjs"
  },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "fonts": [],
  "report": ".variance/report.json"
}
```

An id planned by the config with no matching route is reported as a collection
failure; it is never silently dropped. A route present only in the collector is
never planned. Keeping the two lists explicit makes adding or removing coverage
a reviewable configuration change.

### 4. Check the machine, then run

```bash
npx variance doctor --config variance.config.json
npx variance run --config variance.config.json
```

The first successful run reports the routes as `new` and exits `1`. After the
intended candidates are accepted, an unchanged run exits `0`; later changes are
reported against the specific route and viewport that moved.

## Sitemap and directory route sources

Use exactly one of `routes`, `sitemap`, or `directory`.

When a sitemap or built directory is already the canonical inventory, let the
collector plan the subjects and set `subjects.kind` to `collector` in your
otherwise complete `variance.config.json`:

```js
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  sitemap: 'http://localhost:3000/sitemap.xml',
  roots: ['main'],
  source: { dirs: ['src'] },
});
```

```json
{
  "subjects": {
    "kind": "collector",
    "collector": "variance/routes.mjs"
  }
}
```

For static output, replace `sitemap` with `directory: './build'`; the collector
serves it locally and creates one subject per `.html` file.

Discovery avoids maintaining two route lists, but a page removed from the
sitemap or build also disappears from the suite without a config diff — use
the explicit `list` form when that silence is unacceptable. A sitemap index
is not followed: its own `<loc>` values are treated as pages, and links on
pages are never crawled.

## Observe responsive layouts

Use `widths` when each route must be evaluated at more than one breakpoint:

```js
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: { home: 'http://localhost:3000/' },
  widths: [375, 1280],
  roots: ['main'],
});
```

Each width becomes its own subject—`home@375` and `home@1280`—with its own
navigation, baseline, and verdict. The page is navigated at the requested width
so code that reads `matchMedia` during mount makes the correct decision.

## Options

`widths` takes a viewport width set — an array of pixel widths — and renders
each route once per width, independently.

| Option | Use it when | Default and boundary |
| --- | --- | --- |
| `routes` | The config should explicitly name every subject. | Mutually exclusive with `sitemap` and `directory`. |
| `sitemap` | The deployed application already publishes the route inventory. | Requires `subjects.kind: "collector"`; sitemap indexes are not followed. |
| `directory` | A static build is the application under test. | Requires `subjects.kind: "collector"`; serves `.html` files locally. |
| `widths` | Routes must be mounted independently at several breakpoints. | The run's configured viewport width. Height remains the run's height. |
| `roots` | Only a subtree is the subject. | `['body']`, meaning the whole page. |
| `ready` | A route finishes after ordinary page load. | No additional selector wait. Keyed by route id; a widened id (`home@375`) wins over the route it came from. |
| `source` | Reports should resolve components to `file:line`. | Omitted; component names can remain without source locations. |
| `readyTimeoutMs` | A declared readiness marker legitimately needs longer. | `10000`. A timeout is reported, never replaced by a fallback capture. |
| `loading` | A route's *fallback* is the state you intend to review. | Omitted. Id globs, matched against the subject id. |
| `suspenseTimeoutMs` | A route legitimately needs longer than five seconds to arrive. | `5000`. `0` skips the wait and keeps the reading. |
| `headless` | You need to watch collection while debugging. | `true`. |
| `network` | Asset bytes at stable URLs must affect render identity. | `true`. |
| `portable` | The pixels will be made on a machine with no route to your asset origin. | `false`. Requires `network`; a resource that cannot be closed fails its route and names itself. |
| `stabilize` | The application has its own determinism strategy. | The standard collection recipe; `[]` records an untouched page. |

## Readiness and loading

Before each route is read, the collector waits for every React Suspense
boundary under the selected roots to **settle** — resolve its real content,
as opposed to still-arriving, where a fallback is still on screen. This runs
before stabilization, because content that arrives late brings its own
images and fonts.

Neither `ready` nor the network can cover this: a suspended component
renders no markup for a selector to attach to, and an arrived network
response is not the same event as a committed render. A route still showing
a fallback when `suspenseTimeoutMs` runs out is reported as **not
collected**, naming the open boundaries and the components that wrote them.

Declare the exception when the fallback is the subject:

```js
export default routeCollector({
  routes: { 'checkout/pending': 'http://localhost:3000/checkout?state=pending' },
  loading: ['checkout/pending'],
});
```

A **declared route** — one listed in `loading` — skips the Suspense wait
entirely. The check runs both ways: a declared route that turns out to
settle is refused too.

### Sitemap helpers

The package also exports the pure **sitemap helpers** used by discovery —
functions that parse sitemap XML without fetching it or crawling any links:

- `locationsIn(xml)` returns `<loc>` values in document order;
- `routesFrom(xml)` turns those locations into the route map and refuses path
  collisions;
- `subjectIdFor(url)` derives the stable path-based subject id.

Use them to preview or validate a sitemap plan before constructing the
collector.

## When integration fails

- **The server cannot be reached:** start the application before `variance run`
  and verify the exact URLs from the machine running CI.
- **A subject is missing:** for `kind: "list"`, match every config id to a key in
  `routes`. For discovery, inspect the sitemap or built `.html` files that are
  the actual inventory.
- **A page times out:** verify its `ready` selector and increase
  `readyTimeoutMs` only when the page genuinely needs more time.
- **A route is refused as still waiting:** the named Suspense boundary never
  resolved. Fix what it awaits, or add the route to `loading` if the fallback is
  what you intend to review.
- **Every route changes with shared chrome:** tighten `roots`; `body` explicitly
  includes headers, navigation, and overlays.
- **Component names have no source lines:** configure `source.dirs` and preserve
  component names in the production bundle. That resolves a name to where the
  component is *declared* — one line however many times the component renders.
  For the line the changed element is written on, see below.
- **Elements report their component's declaration rather than their own line:**
  a route served by `vite dev`, `next dev`, or any other development server
  reports exact lines with no build change. A production build, or React 18
  compiled with the classic JSX transform, has nothing to read — add the
  `@variance-authority/jsx-source` plugin to the application's build and turn
  on `jsxDev` for that case.
- **A login redirect is captured:** authenticated routes are outside this
  package's contract; use `@variance-authority/playwright-test` with a
  Playwright test that performs the login instead.

## Boundaries

Routes navigate once per subject. Storybook can switch many subjects over one
preview navigation, so use `@variance-authority/storybook-collector` when the
source is Storybook. If navigation and readiness already live in a Playwright
test, use `@variance-authority/playwright-test` and let the test body remain
the collector.
