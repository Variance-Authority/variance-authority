# @variance-authority/route-collector

**Requires:** a browser binary and a reachable application, unless a static
directory is supplied. Authenticated routes are currently unsupported.

Turn pages your application already serves into `variance` subjects. Use this
package when the real application has already solved bundling, providers,
routing, and mounting, and the remaining integration is to name the pages,
bound the part that matters, and say when each one is ready.

This is a collector for [`@variance-authority/cli`](../cli), not a crawler or a
web server for your application. Authentication has no cookie, header, or
storage-state escape hatch.

```bash
npx playwright install chromium
```

## Integrate an explicit route list

### 1. Start the application

Run the same server whose redirects, assets, and runtime behavior you want to
observe. Readiness belongs to that page, so wait for an application-owned marker
rather than adding an arbitrary delay.

### 2. Add a collector module

```js
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
variance doctor --config variance.config.json
variance run --config variance.config.json
```

The first successful run reports the routes as `new` and exits `1`. After the
intended candidates are accepted, an unchanged run exits `0`; later changes are
reported against the specific route and viewport that moved.

## Let another artifact define the routes

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

Discovery removes duplicated route lists, but it changes the safety boundary: a
page removed from the sitemap or build also disappears from the suite without a
config diff. Use the explicit `list` form when that silence is unacceptable. A
sitemap index is not followed—its own `<loc>` values are treated as pages—and
links on pages are never crawled.

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

| Option | Use it when | Default and boundary |
| --- | --- | --- |
| `routes` | The config should explicitly name every subject. | Mutually exclusive with `sitemap` and `directory`. |
| `sitemap` | The deployed application already publishes the route inventory. | Requires `subjects.kind: "collector"`; sitemap indexes are not followed. |
| `directory` | A static build is the application under test. | Requires `subjects.kind: "collector"`; serves `.html` files locally. |
| `widths` | Routes must be mounted independently at several breakpoints. | The run's configured viewport width. Height remains the run's height. |
| `roots` | Only a subtree is the subject. | `['body']`, meaning the whole page. |
| `ready` | A route finishes after ordinary page load. | No additional selector wait. Keys are route ids before any `@width` suffix. |
| `source` | Reports should resolve components to `file:line`. | Omitted; component names can remain without source locations. |
| `readyTimeoutMs` | A declared readiness marker legitimately needs longer. | `10000`. A timeout is reported, never replaced by a fallback capture. |
| `headless` | You need to watch collection while debugging. | `true`. |
| `network` | Asset bytes at stable URLs must affect render identity. | `true`. |
| `stabilize` | The application has its own determinism strategy. | The standard collection recipe; `[]` records an untouched page. |

### Sitemap helpers

The package also exports the pure helpers used by discovery:

- `locationsIn(xml)` returns `<loc>` values in document order;
- `routesFrom(xml)` turns those locations into the route map and refuses path
  collisions;
- `subjectIdFor(url)` derives the stable path-based subject id.

Use them when your integration needs to preview or validate a sitemap plan
before constructing the collector. They do not fetch a sitemap or crawl links.

## When integration fails

- **The server cannot be reached:** start the application before `variance run`
  and verify the exact URLs from the machine running CI.
- **A subject is missing:** for `kind: "list"`, match every config id to a key in
  `routes`. For discovery, inspect the sitemap or built `.html` files that are
  the actual inventory.
- **A page times out:** verify its `ready` selector and increase
  `readyTimeoutMs` only when the page genuinely needs more time.
- **Every route changes with shared chrome:** tighten `roots`; `body` explicitly
  includes headers, navigation, and overlays.
- **Component names have no source lines:** configure `source.dirs` and preserve
  component names in the production bundle.
- **A login redirect is captured:** authenticated routes are outside this
  package's current contract; use an existing Playwright test instead.

## Boundaries

Routes navigate once per subject. Storybook can switch many subjects over one
preview navigation, so use
[`@variance-authority/storybook-collector`](../storybook-collector) when the
source is Storybook. If navigation and readiness already live in a Playwright
test, use [`@variance-authority/playwright-test`](../playwright-test) and let the
test body remain the collector.
