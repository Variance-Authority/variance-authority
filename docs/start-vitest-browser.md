# Add one baseline comparison to a Vitest browser-mode test

Vitest browser mode has already mounted your component in a real browser, which
is the expensive part. This page spends one call and one assertion on top of
it: the mounted subtree is read as a document rather than photographed,
repainted by a Chromium the Vitest process owns, and compared against an image
you approved.

## What this adds to a suite that already screenshots

Vitest browser mode can already screenshot the tab, and so can
`expect(locator).toHaveScreenshot()` in a Playwright suite. Both answer with a
pixel count and two images, and the only way to act on that answer is to open
the images and look. Three differences:

- **A changed region comes back named.** Each region is attributed to the
  component that rendered it, and to the `file:line` it was written at when the
  build emits source locations. That chain — region to box to component to
  line — is described in [attribution](attribution.md).
- **A baseline from a different machine is refused, not diffed.** A run whose
  browser build, platform, device scale factor or font stack differs from the
  one that painted the baseline comes back `incomparable`, naming what differs,
  instead of a page of changed pixels you have to triage.
- **The image does not come from the tab.** The mounted subtree is read as a
  document and repainted by one Chromium the Vitest process owns, so the
  baseline is a repaintable thing rather than a photograph of whichever browser
  your provider happened to mount in.

Your existing screenshot assertions keep working. This does not replace them or
read their baselines.

## What a baseline is here

You review images. Two separate things are involved in producing one:

- The **reading** is what the test collects in the tab: the markup, the CSS that
  applies to it, the component behind each node, the framework wiring, and the
  bytes of every resource the subtree references, fetched with the page's own
  `fetch` against the server that served them. It is the input to a paint, and
  it is not stored as the baseline.
- The **baseline** is an **image**. The Vitest process paints that reading into
  a PNG, and the approved PNG is what the next run compares against. It is
  stored with a JSON sidecar recording the renderer identity that painted it and
  the per-component hashes of the reading, which is what lets a later diff rank
  regions by which component's own content changed.

Reading the mount rather than screenshotting the tab is what lets the same
subject be painted again later and compared byte for byte, and what lets the
comparison say which machine painted each side.

## Before you add the comparison

Browser mode must already be running your component tests, and the locator you
would normally assert on must already resolve.

Install the integration and the Chromium binary that paints the baseline:

```bash
npm install --save-dev @variance-authority/vitest-browser vitest-browser-react
npx playwright install chromium
```

Playwright's browser binaries do not arrive with an `npm install`. Two browsers
are in play: the one your provider mounts components in, and the one the Vitest
process paints baselines with. The install above covers the second.

## Register the command

A test body in browser mode runs inside an iframe in a tab, and a tab has
neither the baseline directory nor a browser it can launch to paint with.
Vitest's command protocol carries the reading out to the Vitest process, and the
plugin is what registers that command. Without it, `variance()` throws and tells
you to add it.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { variancePlugin } from '@variance-authority/vitest-browser/node';

export default defineConfig({
  plugins: [react(), variancePlugin({ baselines: '.variance/baselines' })],
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
    },
  },
});
```

`variancePlugin` contributes only the command registration and a hook that
closes the browser when the run ends, so its position in `plugins` does not
matter.

`baselines` defaults to `.variance/baselines`; the line above is the default
written out. Use `varianceCommands(options)` instead when your config already
builds its own command map and you want to decide when the browser closes.

| option | default | what it decides |
| --- | --- | --- |
| `baselines` | `.variance/baselines` | the directory baselines are stored in |
| `store` | a durable store on `baselines` | an existing store, when baselines do not live in a directory |
| `renderer` | a Playwright renderer opened on first use | an existing renderer, whose lifetime then stays yours |
| `accept` | Vitest's own `--update` | whether this run may promote a candidate to a baseline |

### Commit the baselines

The baseline directory is tracked, ordinary files, and it is how CI finds the
approved state. A run that cannot read what the last run wrote does not fail —
it reports every subject `new` and records whatever is on screen. If your
repository ignores `.variance/`, exclude its contents rather than the directory
so git still descends into it:

```gitignore
.variance/*
!.variance/baselines/
.variance/baselines/**/by-document/
```

The third line matters. A durable store is also a render cache, keyed by the
digest of the document that produced each image, and on this path it lands in a
`by-document/` directory inside the baseline root. It gains an entry on every
edit and is worth nothing after the next one, so keep it out of the commit — or
move it entirely by building the store yourself and passing it as `store`:

```ts
import { createDurableStore } from '@variance-authority/store/durable';

variancePlugin({
  store: createDurableStore('.variance/baselines', { cacheRoot: '.variance/renders' }),
});
```

[Baseline placement](placement.md) covers Git LFS and remote stores for corpora
too large to commit as blobs.

## Add the comparison

This example uses React, through `vitest-browser-react`. What the integration
reads is React-aware: component names, `file:line`, framework wiring and the
Suspense guard below all come from the React tree. Mount a Vue or Svelte
component and the image comparison still runs, but the regions come back
unattributed and nothing guards against capturing a loading state — so treat
non-React frameworks as image comparison only.

```tsx
import { render } from 'vitest-browser-react';
import { expect, test } from 'vitest';
import { assertUnchanged, variance } from '@variance-authority/vitest-browser';
import { SaveButton } from './SaveButton';

test('save button, disabled', async () => {
  const screen = render(<SaveButton disabled />);
  await expect.element(screen.getByRole('button')).toBeVisible();

  assertUnchanged(await variance(screen.container, { subjectId: 'save-button/disabled' }));
});
```

### The two calls

```ts
function variance(
  subject: Element | { element(): Element },
  options?: VarianceOptions,
): Promise<Observed>;

function assertUnchanged(observed: Observed): void;

function toBeUnchanged(observed: Observed): { pass: boolean; message: () => string };
```

The subject is any DOM element, or anything with an `element()` method — which
is every Vitest browser-mode locator. `screen.container` is
`vitest-browser-react`'s root element for the mount; if your binding does not
expose one, pass a locator instead:

```ts
assertUnchanged(await variance(screen.getByRole('button')));
```

`variance` returns the result rather than throwing on it. `assertUnchanged`
throws unless the verdict is `unchanged`, with the sentence the run would have
printed. `toBeUnchanged` is the same decision as a matcher function, for a suite
that composes its own `expect`.

`variance` does throw, rather than returning a verdict, in two cases: the
subject is still showing a Suspense fallback (see below), and no subject id
could be derived because the call was made outside a test.

### Options

Every option goes in the second argument to `variance`.

| option | default | what it decides |
| --- | --- | --- |
| `subjectId` | the running test's full name | what the baseline is stored under |
| `subjectKind` | `'fixture'` | what produced the subject, recorded rather than guessed |
| `fonts` | none | the font stack this machine is asserted to have, as `family/weight/style/hash` |
| `features` | none | environment facts folded into the capture and into media-condition resolution |
| `sourceRoot` | none | the root component paths are made relative to, so `file:line` stays correct on another machine |
| `suspenseTimeoutMs` | `5000` | how long to wait for the subject's Suspense boundaries before refusing |
| `loading` | `false` | this subject's loading state is the thing being captured |
| `wiring` | `true` | read each node's framework wiring — hook count, keys, boundaries — as part of the compared identity |
| `holdings` | `false` | read what each boundary was handed and retained, as digests beside the reading |
| `sensitivity` | none | how much of this subject is asserted on, when it has been relaxed |

`subjectId` is the key the baseline is stored under, and it identifies one UI
state rather than one test: a test comparing three states needs three ids. Its
uniqueness scope is the baseline directory, so two calls using one id address
one baseline whatever files they live in. Left out, the id is the test's full
name, and renaming the test then leaves its baseline unreachable and the next
run reports `new` — so pass `subjectId` explicitly for any baseline you expect
to keep.

### Reading the verdict yourself

`Observed` includes the verdict and the evidence behind it, so a test can
branch instead of asserting:

```ts
const observed = await variance(screen.container);

if (observed.verdict === 'new') {
  console.log(observed.message);
} else {
  assertUnchanged(observed);
}
```

The fields worth reading: `subject`, `verdict`, `because` (one sentence saying
why it has that verdict), `message` (the whole formatted failure, regions
included), `regions` (the attributed changed regions), `missingFonts`,
`rendered` (`false` when the image came from the cache), and `signals`, which
reports the document and the pixels as separately observed boundaries.

There are five verdicts:

| verdict | what it means |
| --- | --- |
| `unchanged` | the stored baseline and this run's image were comparable, and no pixels differ |
| `changed` | pixels differ; `regions` names what drew them |
| `new` | no baseline exists for this subject under this renderer identity. Not a pass and not a failure |
| `incomparable` | a baseline exists but was painted by a different machine, so the comparison is refused. Never read it as zero difference |
| `ignored` | pixels differ and every one of them fell inside something you excluded |

`assertUnchanged` throws on all four of the others, `ignored` included, because
it asserts exactly what its name says.

## Run the first review loop

```bash
npx vitest run
```

The first run has nothing to compare against, so the subject reports `new` and
the assertion fails. Approve it the way you approve the snapshots in the same
suite:

```bash
npx vitest run -u
```

That promotes the image this run already painted — not a fresh one — so the
bytes that became the baseline are the bytes the run produced. Open the PNG it
wrote before you commit it. Run the suite again and the subject reports
`unchanged`.

Set `accept: false` on the plugin to keep baselines out of `--update`
altogether, or `accept: true` for a job whose whole purpose is to write them.

## Read a failure

There is no HTML report on this path: the failure message is the report. It
opens with the subject, the verdict and the sentence explaining it, then lists
each changed region with the component that drew it and the `file:line` it was
written at, made relative to `sourceRoot` when you passed one. Regions with no
component behind them are printed as coordinates and marked unattributed. The
list is ordered by area, and says so: area measures displacement rather than
blame, so a container pushed by an edit can outrank the edit itself.

The images themselves are files. The approved baseline is the `.png` under the
baseline directory, beside the `.json` recording what painted it. The candidate
this run painted is in the render cache, under `by-document/`, named by the
digest of the document it was painted from.

## Make CI judge a baseline you approved locally

A baseline is only compared against a reading made under the same **renderer
identity**: the renderer and its engine build, the OS and architecture, the
device scale factor, the fonts the renderer actually had, and digests of the
stabilization and raster settings it used. Baselines are partitioned by it —
that is the `v1:6c1f…` directory the `.png` lives under.

This is why the tab's own screenshot is not used. A live screenshot has nothing
behind it that can say which machine, which scale and which font stack produced
it, so nothing can decide whether a later run is entitled to compare against it.

The consequence is that a baseline approved on your laptop is usually not
comparable on a CI runner: different platform, different fonts. The run says so
— every such subject reports `incomparable`, naming both identities — rather
than reporting a day of changed pixels nobody caused. Two ways to get a verdict
instead of a refusal:

- **Approve on the machine that judges.** Run the suite with `-u` in the CI
  image, commit what it wrote, and every later CI run compares against a
  baseline its own identity painted. Running the same suite on your laptop then
  reports `incomparable` for those subjects: the local run cannot judge them.
- **Point every run at one renderer.** Pass `renderer` to the plugin — any
  `Renderer`, including one `connectRenderer` from
  `@variance-authority/remote/renderer` opens against a pinned machine running
  `serveRenderer`. Laptop and CI then share an identity because the same machine
  paints for both. That machine's renderer identity is fetched rather than
  declared, so a misconfigured endpoint cannot pass a comparability check it
  should fail.

[Baseline placement](placement.md) covers where the bytes live under either
choice.

## A subject still showing a Suspense fallback

A subject still showing a Suspense fallback is refused rather than captured. The
locator assertion above it passes against a skeleton, and a baseline taken over
a skeleton records the wrong state: a slower machine records the skeleton, a
faster one records the content, and the next run reports the difference as a
regression. The refusal names the boundary and the component that renders it.

When the skeleton is the subject, declare it:

```ts
assertUnchanged(await variance(screen.container, { loading: true }));
```

The declaration is symmetric — a subject declared loading that then settles is
refused too, because a declaration nobody deleted would record whichever state
the machine's speed produced.

Media queries resolve against the iframe the test body runs in rather than the
browser tab, because that is the frame the component was laid out in. Animation,
caret blink and scroll position are held still before the reading, and what
stopped them is recorded in it, so two runs that stabilized differently are
not silently compared.

## Go deeper

Read [composition](composition.md) when this result joins a reading made by
another host, or [attribution](attribution.md) when a changed region must
resolve to its component and `file:line`. The
[`@variance-authority/vitest-browser` reference](../packages/vitest-browser/README.md)
owns the full option contracts. When the same components are tested under jsdom
instead, [start with `@variance-authority/unit-test`](start-unit.md).
