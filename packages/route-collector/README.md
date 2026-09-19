<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/route-collector

> Turn pages your application already serves into Variance Authority subjects.

Part of [Variance Authority](https://variance-authority.dev).

## What this is for

You already run a server that renders your pages. This package points a browser
at URLs you name, reads a subtree of each page, and hands the result to
`@variance-authority/cli` to compare against the image you approved last time.
When something changed, the report names the component that drew it and the
`file:line` it was written at.

A **subject** is one named UI state you asked for and can ask for again — here,
one route at one viewport, under an id you choose. A **collector** is a module
you write that tells the CLI which subjects exist and how to open them; this
package builds one from a list of routes, a sitemap, or a directory of built
HTML.

It navigates the URLs you give it and nothing else. It does not crawl links, it
does not start your application, and it has no cookie, header, or storage-state
login support — for a route that only exists after a login, use
`@variance-authority/playwright-test` and keep the login in the Playwright test
that already performs it.

There is no router or framework configuration to write. The collector sees your
pages the way a browser does, over HTTP, so whatever produced them has already
finished its job by the time this runs.

## Requirements

- **Node 22 or newer.** Every `@variance-authority/*` package is ESM-only.
- **A Chromium binary from Playwright.** `profile: "chromium"` is what resolves
  layout, computed style and pixels; `jsdom` cannot produce an image, so a route
  run needs Chromium.
- **A running application, or a built directory.** The URLs in your collector
  must resolve from the machine that runs the comparison, not only from your
  laptop.

React is optional. The package declares no React dependency and imports nothing
from React: it reads the `__reactFiber$…` expando `react-dom` writes onto host
nodes.

| React | Status |
| --- | --- |
| 19, 18.3 | Exercised by this package's own suite |
| 17 | Read by the same path — same expando, same work tags — and not exercised |
| 16 | Read through the older `__reactInternalInstance$` expando, and not exercised |

On a page React never rendered, the Suspense wait below reports the root as
unobserved and collection continues; set `wiring: false` to drop the React
reading entirely.

## Put one route through review

### 1. Install

```bash
npm install --save-dev @variance-authority/cli @variance-authority/route-collector
npx playwright install chromium
```

The second command is there because Playwright's browser binaries do not arrive
with an `npm install`.

### 2. Start the application

Run the same server whose redirects, assets, and runtime behavior you want to
observe — `npm run dev`, `npm start`, whatever you already use. Leave it
running; nothing below starts or stops it.

### 3. Write the collector module

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

`roots` is an ordered list of CSS selectors, and the first one that matches is
the subject. The default is `['body']`, meaning the whole page is under review.
A tighter root keeps shared navigation or application chrome out of every route,
so an edit to the header does not change forty routes at once. If none of the
selectors matches, the route is a collection failure rather than an empty
capture.

`source.dirs` is what turns a component name into a `file:line`. It is optional;
a path that matches no files is refused by name rather than producing a report
where every component resolves to nothing.

### 4. Write the run config

```json
// variance.config.json
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

`profile` is not a browser name — it is what the collector is able to observe.
The engine is a separate optional `browser` key (`chromium`, `firefox` or
`webkit`, defaulting to `chromium`). `retention: "durable"` is what makes a
first run report `new` and a second report `unchanged`.

An id planned by the config with no matching route is reported as a collection
failure; it is never silently dropped. A route present only in the collector is
never planned. Adding or removing coverage is then a configuration change
somebody reviews.

### 5. Check the machine, then run

```bash
npx variance doctor --config variance.config.json
npx variance run --config variance.config.json
```

`npx` because you installed the CLI as a devDependency, so `variance` is not on
your `PATH`. `doctor` launches the browser and measures the fonts you asserted
rather than consulting a version table.

The first durable run exits `1` with both routes reported as `new`. `0` means
nothing needs review, `1` means the run happened and found something a person
must decide about, and `2` means the run did not happen as configured.

### 6. Look at the candidates

Write the report as HTML beside its JSON source, so its relative image links
still work, and open it:

```bash
npx variance report --config variance.config.json --format html > .variance/report.html
```

`report` uses the same exit codes as `run`: it writes the whole report and
then exits `1` when the report shows something to review. Under `set -e` that
ends the script, so allow it — `|| true` in a shell recipe, `continue-on-error`
in a CI step — and read the code from `run` instead.

### 7. Approve what you meant

```bash
npx variance accept --config variance.config.json checkout/empty checkout/one-item
npx variance run --config variance.config.json
```

`accept` promotes exactly the image the run under review produced; it never
renders a replacement. The rerun exits `0` and reports `unchanged`.

The full signature:

```
npx variance accept [--config <path>] <subject>... | --all | --shape <fingerprint>[,...] [--message-file <path> [--message <text>]]
```

`--shape` takes a **fingerprint** — the shape digest the report attaches to each
changed region — so one decision covers every subject where the same kind of
difference landed. Keep `--all` out of an unattended job: it cannot tell a
candidate somebody reviewed from one nobody opened.

With `baselines.kind: "directory"`, approval arrives as a commit: the `.png` and
`.json` under `.variance/baselines` are ordinary tracked files, and the new
approved image is a diff in the pull request. If your repository ignores
`.variance/`, exclude its contents rather than the directory:

```gitignore
.variance/*
!.variance/baselines/
```

### What you get

`.variance/report.json`, abridged — one route whose padding changed:

```json
{
  "runVersion": 1,
  "identity": {
    "renderer": "playwright-chromium@1.49.0",
    "engine": "chromium@131",
    "platform": "linux-x64",
    "deviceScaleFactor": 1,
    "fonts": ["Inter"]
  },
  "retention": "durable",
  "observations": [
    {
      "subject": "checkout/one-item",
      "verdict": "changed",
      "because": "12 pixels differ inside the label",
      "changedPixels": 12,
      "regions": [
        {
          "x": 4,
          "y": 8,
          "width": 60,
          "height": 18,
          "pixels": 12,
          "component": "CartSummary",
          "where": "main → list item 2 of 3",
          "file": "src/checkout/CartSummary.tsx:42",
          "cause": true,
          "fingerprint": "b5c1f0a2"
        }
      ]
    },
    { "subject": "checkout/empty", "verdict": "unchanged" }
  ],
  "notObserved": []
}
```

`identity` is the machine the pixels were made on, and it is part of the key a
baseline is stored under. `cause: true` marks the region the semantic tier named
as a root of the change rather than something the change pushed around.
`notObserved` lists subjects the run did not observe, with why — absent is not
empty, because silence about a subject cannot support the sentence "nothing
needs review".

## Sitemap and directory route sources

Use exactly one of `routes`, `sitemap`, or `directory`.

When a sitemap or built directory is already the canonical inventory, let the
collector plan the subjects and set `subjects.kind` to `collector` in your
otherwise complete `variance.config.json`:

```js
// variance/routes.mjs
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  sitemap: 'http://localhost:3000/sitemap.xml',
  roots: ['main'],
  source: { dirs: ['src'] },
});
```

```json
// a fragment of variance.config.json — every other key stays as it is
{
  "subjects": {
    "kind": "collector",
    "collector": "variance/routes.mjs"
  }
}
```

Discovered ids come from the URL path with leading and trailing slashes trimmed,
and a sitemap listing two URLs whose paths collide is refused rather than
resolved. For static output, replace `sitemap` with `directory: './build'`; the
collector serves it locally and creates one subject per `.html` file. Ids drop
the extension and `index.html` resolves to its directory, so `cart/empty.html` is
the subject `cart/empty` and `about/index.html` is `about` — the name you type
back at `--subjects` and `variance accept`. The root `index.html` has no
directory above it to be named after, so its id is `/`. Two files that would
answer to one id — `cart/empty.html` beside `cart/empty/index.html` — are
refused by name rather than resolved.

A page dropped from the sitemap or the build stops being watched with no config
diff to approve. The run still reports it by id — the baseline store keeps an
approved image the plan did not contain — but you learn about it from a run
rather than from a review. Keep the explicit `routes` form where removing a
subject should be something somebody signs off. A sitemap index is not followed:
its own `<loc>` values are treated as pages, and links on pages are never
crawled.

## Observe responsive layouts

Use `widths` when each route must be evaluated at more than one breakpoint:

```js
// variance/routes.mjs
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: { home: 'http://localhost:3000/' },
  widths: [375, 1280],
  roots: ['main'],
});
```

Each width becomes its own subject — `home@375` and `home@1280` — with its own
navigation, baseline, and verdict. The page is navigated at the requested width
so code that reads `matchMedia` during mount makes the correct decision. The
height stays the run's; only the width changes. The suffix is part of the id, so
`--subjects 'home@375'` selects exactly one and an `ignore` rule globbing
`home*` still matches both.

## Options

A **band** in the table below is the kind of difference a report names, ordered
loudest first: `a11y`, `geometry`, `token`, `content`, `texture`.

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
| `hashAssets` | Your asset URLs already include their own content hash. | `true`. Read only while `network` is on; GIF freezing, blanking and `portable` retention stay. |
| `wiring` | This route is not React, so the fiber walk buys nothing. | `true`. A band of its own; turning it off changes no stored digest. |
| `holdings` | Application values behind the nodes are evidence you want recorded. | `false`. Changes the structure digest — an inert wrapper survives the collapse — so both sides of a comparison must be read the same way. |
| `stabilize` | The application has its own determinism strategy. | The standard collection recipe; `[]` records an untouched page. |

## Readiness and loading

Before each route is read, the collector waits for every React Suspense boundary
under the selected roots to resolve real content rather than still be showing a
fallback. This runs before stabilization, because content that arrives late
brings its own images and fonts.

Neither `ready` nor the network covers this: a suspended component renders no
markup for a selector to attach to, and an arrived network response is not the
same event as a committed render. A route still showing a fallback when
`suspenseTimeoutMs` runs out is reported as not collected, naming the open
boundaries and the components that wrote them.

When the fallback is the state you want to review, say so:

```js
// variance/routes.mjs
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: { 'checkout/pending': 'http://localhost:3000/checkout?state=pending' },
  roots: ['#app'],
  loading: ['checkout/pending'],
});
```

A route listed in `loading` skips the Suspense wait entirely. The check runs both
ways: a route declared this way that turns out to settle is refused too, because
what gets recorded would otherwise depend on how fast the machine is.

## Sitemap helpers

The package also exports the pure functions discovery uses to read sitemap XML.
They fetch nothing and crawl nothing:

- `locationsIn(xml)` returns `<loc>` values in document order;
- `routesFrom(xml)` turns those locations into the route map and refuses path
  collisions;
- `subjectIdFor(url)` derives the stable path-based subject id.

Use them to preview or validate a sitemap plan before constructing the
collector. This is an excerpt — `xml` is the body of a sitemap you fetched
yourself:

```js
// preview-sitemap.mjs
import { locationsIn, routesFrom } from '@variance-authority/route-collector';

const xml = await fetch('http://localhost:3000/sitemap.xml').then((response) => response.text());
console.log(locationsIn(xml));
console.log(routesFrom(xml));
```

## When integration fails

- **The server does not answer:** start the application before `npx variance run`
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
- **Elements report their component's declaration rather than their own line:**
  a route served by `vite dev`, `next dev`, or any other development server
  reports exact lines with no build change. A production build, or React 18
  compiled to classic `createElement` calls, has nothing to read. This does not
  affect collection or comparison. If the report must distinguish the exact
  element instance, make that build emit automatic development JSX and add the
  `@variance-authority/jsx-source` plugin.
- **A login redirect is captured:** authenticated routes are outside this
  package's contract; use `@variance-authority/playwright-test` with a
  Playwright test that performs the login instead.
- **A route keeps changing on content nobody wrote** — a clock, a build id, a
  third-party embed: exclude it by selector with an `ignore` rule in the config.
  An ignore is not a tolerance; it names one place, the reason is required, and a
  subject that went green because a rule absorbed the difference is reported as
  `ignored` rather than `unchanged`.

## Boundaries

Routes navigate once per subject. Storybook can switch many subjects over one
preview navigation, so use `@variance-authority/storybook-collector` when the
source is Storybook. If navigation and readiness already live in a Playwright
test, use `@variance-authority/playwright-test` and let the test body remain
the collector.

---

**[@variance-authority/route-collector](https://variance-authority.dev/reference/packages/route-collector)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
