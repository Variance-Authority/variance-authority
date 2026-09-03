# Put one served route through review

Use this path when an application server already owns routing and page state.
The route collector navigates only the URLs you name; it does not crawl links,
start the application, or supply authentication state.

## Before you collect

Start the application from the environment that will run the comparison. For an
authenticated route, keep login and storage state in a Playwright test and use
the [Playwright quickstart](start-playwright.md) instead.

```bash
npm install --save-dev @variance-authority/cli @variance-authority/route-collector
npx playwright install chromium
```

## Name and bound the route

Give the state a durable id and select the smallest application root that owns
it:

```js
// variance/routes.mjs
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: { 'checkout/empty': 'http://localhost:3000/checkout' },
  roots: ['#app'],
  source: { dirs: ['src'] },
});
```

Declare the same id in the run config. A mismatch is a collection failure, not a
silently absent route:

```json
{
  "project": "checkout-ui",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": {
    "kind": "list",
    "ids": ["checkout/empty"],
    "collector": "variance/routes.mjs"
  },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "fonts": [],
  "report": ".variance/report.json"
}
```

## Run the first review loop

With the application still running:

```bash
npx variance doctor --config variance.config.json
npx variance run --config variance.config.json
```

The first successful durable run exits `1` with `checkout/empty` reported as
`new`. Write and open the review report beside its JSON source:

```bash
npx variance report --config variance.config.json --format html > .variance/report.html
```

If the candidate is the intended route state, accept that id and rerun:

```bash
npx variance accept --config variance.config.json checkout/empty
npx variance run --config variance.config.json
```

The rerun exits `0` and reports `unchanged`. A missing root or a readiness
timeout remains a collection failure; it never becomes an empty or unchanged
observation.

## Go deeper

Read [baseline placement](placement.md) before choosing where approved route
images live, or [source reach](source.md) before narrowing a large route suite.
The [`@variance-authority/route-collector` reference](../packages/route-collector/README.md)
owns ready markers, responsive widths, sitemap and static-directory discovery,
portable capture, and the complete option contract.
