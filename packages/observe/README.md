<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/observe

> Compare render documents or rasters and receive one Variance Authority observation, whatever produced the images.

Part of [Variance Authority](https://variance-authority.dev).

## What this is for

You hand this package two images of the same **subject** — one named UI state
you asked for and can ask for again, identified by a stable id like
`story:checkout--empty`. It hands back one `Observation`: a verdict, the pixels
that differ, and — when you also supply the markup those pixels came from — the
component and the `file:line` behind each patch of difference.

It is the comparison half, on its own. It opens no browser, picks no baseline
directory, writes no report, and exits with no code. You supply an image source
and somewhere to keep baselines; it decides what changed.

Reach for it when you are building an integration of your own. If you want a
tool rather than a seam, install
[`@variance-authority/cli`](https://variance-authority.dev/reference/packages/cli),
[`@variance-authority/storybook-collector`](https://variance-authority.dev/reference/packages/storybook-collector),
[`@variance-authority/route-collector`](https://variance-authority.dev/reference/packages/route-collector),
or [`@variance-authority/playwright-test`](https://variance-authority.dev/reference/packages/playwright-test)
instead — each of them is this package with the acquisition, storage and
approval halves already attached.

## Requirements

Node 22 or newer. The package is ESM-only (`"type": "module"`); there is no
CommonJS build.

Nothing else is required to compare two PNGs you already have. The other
entrypoints take a renderer and a store as arguments, and these are the
implementations this repository ships:

| You need | Install | What you call |
| --- | --- | --- |
| A `Renderer` | `@variance-authority/playwright` | `createPlaywrightRenderer` from `@variance-authority/playwright/renderer` |
| A durable `RasterStore` | `@variance-authority/store` | `createDurableStore` from `@variance-authority/store/durable` |
| An in-memory `RasterStore` | `@variance-authority/raster` | `createEphemeralStore` |
| A `RenderDocument` | `@variance-authority/dom` | `acquireDocument`, run inside the page |
| The digest of a `RenderDocument` | `@variance-authority/core` | `documentDigest` from `@variance-authority/core/format` |
| A `SemanticSnapshot` | `@variance-authority/core` | `normalize` from `@variance-authority/core/rules`, over `collect` from `@variance-authority/dom` |

Any object satisfying the `Renderer` or `RasterStore` interface works; none of
the packages above is a hard dependency.

## Compare two images you already have

The shortest complete path. Two PNG files, no renderer, no store, no baseline
directory:

```bash
npm install --save-dev @variance-authority/observe @variance-authority/png
```

```ts
import { readFileSync } from 'node:fs';
import { observeRasters, summarizeObservation } from '@variance-authority/observe';
import { foreignRaster } from '@variance-authority/png';

// Pixels are machine-bound, so you name what painted them. Any string, as long
// as it is the same string for images that are comparable.
const painter = { painter: 'ios-simulator-17.4' };

const observation = await observeRasters(
  'ios:checkout',
  foreignRaster(readFileSync('before.png'), painter),
  foreignRaster(readFileSync('after.png'), painter),
);

console.log(observation.verdict);
console.log(summarizeObservation(observation));
```

### What you get

Run the above over two 80×40 captures in which a 30×16 box moved six pixels to
the right:

```
changed
ios:checkout: changed — 192 pixels differ across 2 regions
```

and the `Observation` behind it, abridged — the comparison mask is a
`Uint8Array` the size of the image and is omitted here:

```js
{
  subject: 'ios:checkout',
  verdict: 'changed',
  because: '192 pixels differ across 2 regions',
  rendered: false,               // nothing was painted; both images arrived
  missingFonts: [],
  regions: [],                   // see below
  signals: { document: 'changed', pixels: 'changed' },
  comparison: {
    width: 80, height: 40,
    dimensionsChanged: false,
    changed: { default: 192, strict: 192 },
    total: 3200,
  },
}
```

`regions` is empty and that is the ceiling of this entrypoint: an image carries
no structure, so there is nothing to attribute the 192 pixels to. The two
regions the sentence counts are clusters of adjacent changed pixels, found by
geometry alone. To get components and file lines instead of coordinates, take
the baseline path below and supply a snapshot.

Change one of the two painter strings and the same call returns `incomparable`
rather than a large diff blamed on the wrong thing:

```
ios:checkout: incomparable — `ios:checkout` was given two images from different
painters: declared:ios-simulator-17.4 (…, 1x, no fonts declared, no
stabilization recorded, no rasterization recipe recorded) and
declared:figma-export (…); pixels are machine-bound, so the two are not
comparable
```

## Compare against an approved baseline

The durable path renders the current state and compares it against an image
somebody approved earlier.

```bash
npm install --save-dev @variance-authority/observe \
  @variance-authority/playwright @variance-authority/store
```

This is an excerpt: `document`, `snapshot` and `source` come from your
acquisition step, which runs inside the page and is not shown. The
Requirements table above says which function produces each one.

```ts
import { observeAgainstBaseline } from '@variance-authority/observe';
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';
import { createDurableStore } from '@variance-authority/store/durable';

const renderer = await createPlaywrightRenderer({ browser: 'chromium' });
const store = createDurableStore('.variance/baselines');

const observation = await observeAgainstBaseline(
  document,                                  // RenderDocument: serialized markup and styles
  { subject: 'story:checkout--empty' },
  { renderer, store, snapshot, source },
);
```

`snapshot` is the normalized semantic snapshot of that same render and `source`
maps a component name to the file it is declared in. Both are optional, and
leaving them out narrows the answer: without a snapshot you get pixel regions
and no nodes or components behind them; without a source index a component
cannot be resolved to a `file:line`.

Keep the renderer outside your per-subject loop. Launching a browser per
observation throws away the render cache and the session economy the harness
exists for.

### Approving the first image

This function reads and compares. It never writes a baseline, so a subject with
no approved image returns `new` forever until somebody promotes one. That
promotion is a command in the CLI package, and it moves an image the run already
produced rather than re-rendering:

```bash
npx variance accept story:checkout--empty
```

It also takes `--all`, or `--shape <fingerprint>` to promote every subject
carrying one difference shape.

If you are not using the CLI, your integration owns this boundary. The candidate
image is already in `store.renderCache`, keyed by the document digest and the
render identity — promoting it means reading it back and calling
`store.put(key, raster)`. The `Observation` does not hand you that raster; it
reports, it does not carry the image.

Both halves of that key are functions over the same `RenderDocument`. The
digest is `documentDigest`, from `@variance-authority/core/format`:

```js
import { documentDigest } from '@variance-authority/core/format';

const candidate = await store.renderCache.get(
  documentDigest(document),
  renderer.identityFor(document),
);
```

The baseline lookup asks under `renderer.identityFor(document)`. A baseline
found under any other identity comes back `incomparable`; it is never diffed and
blamed on the subject.

## Choose the entrypoint

| Entrypoint | Use it when | What you must provide |
| --- | --- | --- |
| `observeRasters` | Both PNGs already exist, including images this system did not paint. | A subject id and two rasters. Snapshot and source are optional enrichment. |
| `observePair` | Both sides were produced now and compared once, with nothing kept. | Two render documents, one `renderer`, and a `store` for the render cache. |
| `observeAgainstBaseline` | The current state should be compared with a durable baseline. | A document, baseline key, `renderer`, and a `store` holding the approved image. |
| `observeCaptureAgainstBaseline` | Your adapter emits the shared document-or-raster artifact. | A `CaptureArtifact`, baseline key, and `store`; a `renderer` only when the artifact carries a document. |
| `summarizeObservation` | You are printing an observation to a person or an agent. | An `Observation`, and a `SourceIndex` when you want file lines. |
| `declaredIgnores` | Your report must account for ignore declarations even on paths that never compare. | The semantic snapshot and device scale. |

`observePair` and `observeAgainstBaseline` return the same `Observation`, so the
code that handles verdicts needs no branch for retention mode.

`observeCaptureAgainstBaseline` is the adapter seam. A document artifact takes
the ordinary render path. A raster artifact is compared and stored without a
renderer ever being constructed, which is what lets a unit runner hand over
pixels from a machine that has no browser. A value artifact is rejected by name:
value baselines need a value store and a comparison contract that are not in
this package.

## Read the verdict

| Verdict | Meaning | What to do |
| --- | --- | --- |
| `unchanged` | Comparable images, no changed pixels. | Continue without review. |
| `changed` | A comparable image differs. `regions` carries as much attribution as the snapshot and source you supplied allow. | Present the evidence and require review. |
| `new` | No baseline exists for this key and this renderer. | Review and explicitly approve or reject. Not green. |
| `incomparable` | The two sides were painted under incompatible identities — a baseline from another renderer, or two rasters from two declared painters. | Align the renderer inputs or keep a separate baseline. Do not accept the noise as a component change. |
| `ignored` | Pixels changed, and every one fell inside a declared exclusion or sensitivity. | Continue, and record that the green result rested on a rule. |

`unchanged` is never available for `incomparable`: a difference that could not
be observed is not reported as no difference.

## What else an observation carries

Beyond the verdict and `regions`, an `Observation` records whether a render
actually happened or the image came from the cache, fonts the document declared
and the renderer did not have, ignored-pixel accounting per rule (including
rules that absorbed nothing, which is how a dead ignore stays visible), the
components whose own content differs from the baseline's, and diagnostics such
as a mismatch between the acquired subject size and the painted image.

`moved` and `relaxed` report **bands** — the kind of change, not its size.
There are five, loudest first: `a11y` (a role, accessible name or ARIA state
changed), `geometry` (boxes appeared, vanished, moved or resized), `token`
(style values changed while structure held), `content` (text changed and
nothing else did), `texture` (sub-pixel raster noise). A band is the unit a
sensitivity is declared against: a rule that absorbs `texture` and `token`
still reports a `geometry` change, and `relaxed` names the rule, the level and
the bands it actually absorbed here.

`causes` and `moved` are absent whenever neither side carries component hashes — a
baseline written before they existed, a store that dropped them, or a run with
no snapshot. Absent means *unknown*. It does not mean nothing caused the change.

## Print an observation

`summarizeObservation` turns an `Observation` into the text a reviewer or an
agent reads. Given an observation that did carry a snapshot and a source index:

```
story:checkout--empty: changed — 1530 pixels differ
3 region(s), ordered by area — no causes were supplied, so this
ordering measures displacement rather than blame:
  511px — Stack
      in main > checkout form
  86px — Toggle
      src/app/cart.tsx:42
  34px — unattributed at 4,8 (nearest: Card)
```

Each line is a cause and, where one exists, a file and line — because `Toggle`
is an identifier and `src/app/cart.tsx:42` is an edit. A coordinate appears only
where nothing could be named. The ordering caveat is printed rather than
assumed: an `Observation` carries one snapshot, so nothing here knows which
component was edited and which was merely pushed by a neighbour, and area
measures displacement.

## When integration fails

- **Everything is `new`.** Confirm the baseline key and
  `renderer.identityFor(document)` match the values in use when the approved
  baseline was written.
- **Everything is `incomparable`.** Compare the reported identities. Browser,
  platform, scale, font declarations and stabilization inputs partition
  baselines on purpose.
- **Regions have coordinates but no components.** Supply the semantic snapshot
  from the same render.
- **Components have no source lines.** Supply a matching `SourceIndex`.
- **A warm run reports stale component causes.** Do not store snapshot-derived
  component hashes as render-cache truth. This package replaces cached hashes
  with the current snapshot's before deciding.

## What this package does not do

It performs no DOM acquisition, opens no browser, chooses no baseline
directory, writes no report, emits no exit code, and exposes no approval
command. It also fixes one order — render, look up, compare, isolate, attribute,
decide. If your pipeline needs a different order, compose the same public tools
from [`@variance-authority/core`](https://variance-authority.dev/reference/packages/core),
[`@variance-authority/raster`](https://variance-authority.dev/reference/packages/raster)
and [`@variance-authority/png`](https://variance-authority.dev/reference/packages/png)
directly; this package is assembled from nothing else.

---

**[@variance-authority/observe](https://variance-authority.dev/reference/packages/observe)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
