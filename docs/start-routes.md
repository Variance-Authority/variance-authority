# Put one served route through review

A server owns your routing and page state here, and the route as it ships —
not a component mounted alone — is what you want under an approved image. Name
one URL, run it, approve the first image, and watch the second run come back
`unchanged`. That loop is the whole of this page.

What you get here that Percy, Argos or Playwright's `toHaveScreenshot` do not
give you is the two steps after the diff. Those hand back a count of differing
pixels and two images; somebody opens them, finds the changed region by eye,
works out which component drew it, and decides whether the change was authored
or whether the route is unstable. A changed region here resolves to the
component that drew it and the `file:line` it was written at
([attribution](attribution.md)), and a route that changed is collected a second
time in a clean world before it is reported, so a change somebody authored
arrives separately from a route that disagrees with itself
([flakiness](flakiness.md)).

Use this collector when a server already owns routing and page state, and the
application route — not an isolated component — is what you want to review. It
navigates the URLs you name and nothing else: it does not crawl links, start
your application, or log in. For a route that only exists after a login, keep
the login where it already works and use the [Playwright
quickstart](start-playwright.md) instead. [Choose a starting
point](start.md) lists the other harnesses this loop can start from.

The rest of the page rests on two words. A **subject** is one named UI state a
run captures and compares, under an id you choose; here, one route at one
viewport. A **collector** is a module you write that tells the CLI which
subjects exist and how to open them.

## Before you collect

Start the application from the environment that will run the comparison.

```bash
npm install --save-dev @variance-authority/cli @variance-authority/route-collector
npx playwright install chromium
```

The second command is there because Playwright's browser binaries do not arrive
with an `npm install`.

## Name and bound the route

Give the state an id and select the part of the page that is the subject:

```js
// variance/routes.mjs
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: { 'checkout/empty': 'http://localhost:3000/checkout' },
  roots: ['#app'],
  source: { dirs: ['src'] },
});
```

**The id is yours.** Choose one that survives a renamed route, and keep it out
of the URL's shape. A `/` in it is not a namespace by default: under the default
`flat` baseline layout the whole id, slashes and all, is percent-encoded into a
single filename. It becomes a directory separator only under `layout: "beside"`,
which places each image next to the code it is an image of — and that layout
refuses an id that is absolute or contains a `.` or `..` segment, because it
would write outside the baseline root. Ids are also what `ignore` rules glob
over, so `checkout/empty` and `checkout/one-item` are both matched by
`checkout/*`.

**`roots` is an ordered list of CSS selectors, and the first one that matches is
the subject.** It bounds what is read and compared, and it scopes the readiness
wait below — everything outside it is neither captured nor waited for. The
default is `['body']`, which is you saying the whole page is the subject. A
tighter root keeps a shared header or navigation out of every route's
comparison, so an edit to the header does not change forty routes at once. The
sitemap example further down uses `['main']` for exactly that reason; `#app`
and `main` are both selectors, and which one you want depends on what your
application puts the route's own content inside. If none of the selectors
matches, the route is a collection failure, not an empty capture.

**`source.dirs` is what turns a component name into a `file:line`.** It is
optional, and everything else works without it. The collector walks those
directories once and builds an index from component name to the file and line
the component is *declared* on, so a changed region in the report can show a
source location instead of a bare name. Point it at the directories your
components live in, relative to the config. If it is wrong, you do not get a
wrong answer — a path that matches no files is refused by name rather than
producing a report where every component resolves to nothing. One limit worth
knowing: a route served by `vite dev`, `next dev` or another development server
reports the exact line each element was written on, while a production build has
nothing to read and falls back to the component's declaration line.

## Declare the same route in the run config

The collector says how to open the route; the config says what to do with it.
Create `variance.config.json`, which is the file every command below is pointed
at:

```json
// variance.config.json
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

An id named here with no matching route in the collector is a collection
failure, and a route in the collector that this list does not name is never
planned. Nothing is inferred and nothing is defaulted where a wrong guess would
change what the run sees.

| Key | What it selects |
| --- | --- |
| `project` | Names this project in a shared history store. Required even with no history configured, because rows written under a project nobody chose cannot be re-attributed later. |
| `profile` | Not a browser name — what the collector is *able* to observe. `chromium` resolves layout, computed style and pixels; `jsdom` sees structure, ARIA and declared style only, and cannot produce an image. A route run needs `chromium`. The engine is a separate optional `browser` key, one of `chromium`, `firefox` or `webkit`, defaulting to `chromium`. |
| `viewport` | `width` and `height` are required; `deviceScaleFactor` and `colorScheme` (`light` or `dark`, default `light`) are optional. Both scale factor and colour scheme partition baselines. |
| `retention` | `durable` stores the approved image and compares a later run against it. `ephemeral` renders both sides inside one run and keeps neither, so there is nothing to store and nothing to approve. Durable is what makes a first run report `new` and a second report `unchanged`. |
| `subjects.kind` | Where the subject list comes from. `list` means the ids are written here; `collector` means the collector plans them (used by the sitemap and directory forms below); `storybook` reads a built Storybook index. |
| `baselines.kind` | Where approved images live: `directory` (files you commit), `lfs` (the same files through the Git LFS filter), or `remote` (a store behind an endpoint and a token). Required under `durable`, and no default — the three fail in different directions. [Baseline placement](placement.md) chooses between them. |
| `fonts` | Fonts you assert the rendering machine has, each written `family/weight/style/hash`; a bare family name is refused, because two cuts of one family paint differently. The list is part of the key a baseline is stored under, so editing it re-partitions baselines, and the renderer reports any family you asserted that it could not resolve. `[]` asserts nothing and is a complete config — you then have no font check, and `variance doctor` is what tells you what the machine actually resolves. |
| `report` | Where `run` writes its report, and where `report` and `accept` read it. |

### Commit the baselines

With `baselines.kind: "directory"`, the images under `.variance/baselines` are
ordinary tracked files, and committing them is how the next run and CI find the
approved state. Each subject gets a `.png` and a `.json` beside it — the image,
and the record of which renderer painted it and what it may be compared against.

If your repository ignores `.variance/`, exclude its contents rather than the
directory, so git still descends into it:

```gitignore
.variance/*
!.variance/baselines/
```

A run that cannot read what the last run wrote does not stop. It reports every
subject `new` again, every time.

## Take the list from a sitemap instead

When your build already publishes the inventory, let the collector plan the
subjects rather than writing them out. Use exactly one of `routes`, `sitemap` or
`directory`:

```js
// variance/routes.mjs
import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  sitemap: 'http://localhost:3000/sitemap.xml',
  roots: ['main'],
  source: { dirs: ['src'] },
});
```

The subject list is then discovered, so the config names no ids. Change the
`subjects` section of the `variance.config.json` above and leave every other key
in it as it is:

```json
// a fragment of variance.config.json
{
  "subjects": {
    "kind": "collector",
    "collector": "variance/routes.mjs"
  }
}
```

Discovered ids come from the URL path with leading and trailing slashes trimmed,
and a sitemap listing two URLs whose paths collide is refused rather than
resolved.

For static output, `directory: './build'` serves the build and creates one
subject per `.html` file. Prefer a real server when you have one: a file server
answers what is on disk, and what you deploy answers with its redirects, headers
and rewrites.

A page dropped from the sitemap or the build stops being watched with no config
diff to approve. The run does report it by id — the baseline store still has an
approved image the plan did not contain — but you learn about it from a run
rather than from a review. Keep the explicit `routes` form for a suite where
removing a subject should be something somebody signs off.

## Routes that will not hold still

Two different things go wrong here, and they fail at different points.

**Readiness** is whether the route has arrived. The collector waits for page
load, and then for every React Suspense boundary under your roots to resolve
real content rather than still be showing a fallback. Anything that finishes
later — a fetch issued after mount — needs a marker you name:

```js
routeCollector({
  routes: { 'checkout/one-item': 'http://localhost:3000/checkout?items=1' },
  roots: ['#app'],
  ready: { 'checkout/one-item': '[data-testid="cart-ready"]' },
});
```

Keys are subject ids or globs over them. A route that declares a marker and
never attaches it times out after `readyTimeoutMs` — 10000 by default — and is
reported as a collection failure naming the selector it waited for. A root that
matches nothing fails the same way. Neither becomes an empty or unchanged
observation, and nothing falls back to capturing the spinner.

**Movement** is what the route keeps doing once it has arrived. Before every
capture, on every run, animations are pinned, GIFs are frozen, fonts and images
are waited for, and scrollbars are hidden. There is nothing to switch on, and
the recipe that did it is recorded with the baseline, so an image collected
without it is never compared against one collected with it.

What that cannot cover is content whose value is genuinely different each time:
a clock, a build id, a carousel driven by a timer in JavaScript, a third-party
embed. Name those and exclude them by selector:

```json
// a fragment of variance.config.json
{
  "ignore": [
    {
      "id": "checkout-clock",
      "reason": "renders wall time, which changes on every run",
      "select": ".site-header time"
    }
  ]
}
```

An ignore is not a tolerance: it excludes one named place, the reason is
required, every run names the rules that caught nothing, and a subject that went
green because a rule absorbed the difference is reported as `ignored` rather
than `unchanged`. [Ignores](ignores.md) covers the other form, which matches a
difference shape rather than a place. [Stabilization](stabilization.md) is what
is done to the page and what it costs; [flakiness](flakiness.md) is which causes
get absorbed and which you see as findings.

## Run the first review loop

With the application still running:

```bash
npx variance doctor --config variance.config.json
npx variance run --config variance.config.json
```

`npx` because you installed the CLI as a devDependency, so `variance` is not on
your `PATH`. `doctor` reports what *this* machine can observe and nothing else:
it launches the browser rather than trusting a `playwright` in `node_modules`,
measures the fonts you asserted rather than consulting a version table, and
names the baseline root and the render cache. A pass is a machine that can do
what your config asks for. It touches no network, so a remote store or history
service is reported as configured, never as one the run can talk to.

The first durable run exits `1` with `checkout/empty` reported as `new`. That
`1` is not a failure. `0` means nothing needs review, `1` means the run happened
and found something a person must decide about, and `2` means the run did not
happen as configured — a bad config, a missing browser, a store the run cannot
talk to. The codes are separate so a CI job can page whoever owns the runner
image on `2` and ask a reviewer on `1`. A first run is `1` because a route with
no baseline is a candidate nobody has approved, and nothing accepts on your
behalf: accepting an unseen image would record whatever was on screen as the
truth and report green from then on.

Reviewing is you looking at that candidate. Write the report as HTML beside its
JSON source, so its relative image links work, and open it:

```bash
npx variance report --config variance.config.json --format html > .variance/report.html
```

If the candidate is the route state you intended, approve that id and rerun:

```bash
npx variance accept --config variance.config.json checkout/empty
npx variance run --config variance.config.json
```

`accept` promotes exactly the image the run under review produced; it never
renders a replacement. The rerun exits `0` and reports `unchanged`.

## Run it in CI

Nothing here starts your application, so the job has to. Either run the same
server you run locally as a step before `variance run` — the URLs in the
collector must resolve from the CI machine, not from your laptop — or build the
static output and point the collector at `directory: './build'`, which the
collector serves itself.

Then have the job branch on the exit code: `0` merges, `1` means a subject needs
a decision, `2` means the run did not happen and the reviewer is not the person
to call. Keep `accept --all` out of an unattended job: it cannot tell a
candidate somebody reviewed from one nobody opened. Publish
`.variance/report.html` and `.variance/report.json` as build artifacts so the
reviewer has something to open.

Approval itself arrives as a commit. With committed baselines, somebody checks
out the branch, opens the report, runs `variance accept` for the ids they
intend to keep, and commits the changed `.png` and `.json` files — so the new
approved image is a diff in the pull request, reviewed and merged like any other
change. A remote baseline store moves that approval out of the repository;
[baseline placement](placement.md) covers what it costs.

## Go deeper

Read [baseline placement](placement.md) before choosing where approved route
images live, or [running less of the suite](selecting.md) before narrowing a
large route suite to the routes an edit can reach. The
[`@variance-authority/route-collector` reference](../packages/route-collector/README.md)
owns responsive widths, capturing a route on a machine that cannot talk to your
asset origin, sitemap and static-directory discovery, and the complete option
contract.
