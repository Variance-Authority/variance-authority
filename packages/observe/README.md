<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/observe

> Compare render documents or rasters and receive one Variance Authority observation, whatever produced the images.

**Requires:** by entrypoint, `observeRasters` needs only two rasters. Durable
raster observation needs a store. Document paths need a renderer and store.

This package is the comparison core. Give it two images of the same
**subject** — a story, route, fixture, or value under test, identified by a
stable id — and it returns one `Observation`: a `verdict` (one of a fixed set
of outcomes, listed below) plus the evidence behind it. A `RenderDocument` is
serialized markup and styles that a renderer turns into a **raster**: a
decoded PNG carrying an **identity**, the browser, platform, and scale it was
painted under. Comparing two rasters clusters the changed pixels into
**regions** — boxes of contiguous difference — and, given a semantic snapshot,
attributes each region to the component and file line that produced it. A
**band** classifies what kind of change a region is (accessibility, geometry,
a style token, text, or sub-pixel texture), loudest first.

Use this package when you are building a custom integration below the CLI,
Storybook, route, or Playwright surfaces: it fixes the order of render,
lookup, comparison, isolation, attribution, and verdict selection, and leaves
acquisition, renderer lifecycle, storage lifecycle, acceptance, and reporting
to your application.

If you want a ready-made integration rather than those responsibilities, start
with `@variance-authority/cli`,
`@variance-authority/storybook-collector`,
`@variance-authority/route-collector`, or
`@variance-authority/playwright-test`.

Install this package when your integration can supply the renderer, raster
store, and acceptance boundary:

```bash
npm install --save-dev @variance-authority/observe
```

## Choose the entrypoint

| Entrypoint | Use it when | What you must provide |
| --- | --- | --- |
| `observePair` | Both render documents were produced now and should be compared ephemerally. | Two documents, one renderer, and one raster store for the render cache. |
| `observeAgainstBaseline` | The current document should be compared with a durable baseline. | A document, baseline key, renderer, and store containing the approved baseline. |
| `observeRasters` | Both PNG rasters already exist, including foreign-image ingestion. | A subject id and two rasters; snapshot and source are optional enrichment. |
| `observeCaptureAgainstBaseline` | An adapter emits the shared document-or-raster artifact. | A `CaptureArtifact`, baseline key, and store; a renderer only when the artifact contains a document. |
| `summarizeObservation` | You are printing an observation to a person or an agent, outside the CLI — the same string a failing `assertUnchanged` prints. | An `Observation`, and a `SourceIndex` when you want file lines. |
| `declaredIgnores` | A report must account for ignore declarations even on paths that never compare. | The semantic snapshot and device scale. Most integrators should let the higher-level pipeline call it. |

`observePair` and `observeAgainstBaseline` return the same `Observation`, so the
code that handles verdicts does not need a branch for retention mode.

`observeCaptureAgainstBaseline` is the adapter seam. A document artifact
delegates to the ordinary render path. A raster artifact compares and stores the
provided bytes without constructing or calling a renderer. Both preserve the
artifact's snapshot and source evidence. A value artifact is rejected by name:
this entrypoint compares documents and rasters, while value baselines require a
value store and comparison contract outside this package.

## Compare two revisions from one run

Use the ephemeral path when both documents are already in hand. Because one
renderer paints both sides during one run, machine identity cancels out and no
approved baseline is required.

```ts
import { observePair } from '@variance-authority/observe';

const observation = await observePair(before, after, {
  renderer,
  store,
  snapshot,
  source,
});

if (observation.verdict === 'changed') {
  for (const region of observation.regions) {
    console.log(region.component, region.region.pixels);
  }
}
```

`snapshot` is the normalized semantic snapshot of the same render and `source`
is its component-to-file index. Both are optional, but omitting them deliberately
reduces the result: without a snapshot the observation can report pixel regions,
not the nodes and components behind them; without a source index it cannot
resolve a component to `file:line`.

## Compare with an approved baseline

Use the durable path when another part of your integration owns baseline
approval and storage:

```ts
import { observeAgainstBaseline } from '@variance-authority/observe';

const observation = await observeAgainstBaseline(
  document,
  { subject: 'story:checkout--empty' },
  { renderer, store, snapshot, source },
);
```

This function reads and compares; it does not approve a `new` candidate. Your
integration must define the review boundary and write the approved raster to the
store. If you need the repository's existing acceptance workflow, use the CLI
or Playwright package instead of rebuilding it here.

The lookup asks under `renderer.identityFor(document)`. A baseline found under
another identity returns `incomparable`; it is never diffed and blamed on the
subject.

## Compare externally produced rasters

Use `observeRasters` when the pixels arrive from somewhere else entirely — a
device farm, a native simulator, a design-tool export — and there is no document
to render and no store to read.

```ts
import { observeRasters } from '@variance-authority/observe';
import { foreignRaster } from '@variance-authority/png';

declare const beforePng: Buffer;
declare const afterPng: Buffer;

const observation = await observeRasters(
  'ios:checkout',
  foreignRaster(beforePng, { painter: 'ios-simulator-17.4' }),
  foreignRaster(afterPng, { painter: 'ios-simulator-17.4' }),
);
```

Pixels are machine-bound, so `observeRasters` checks both identities before
comparing. Two rasters from different painters return `incomparable`, naming
both, instead of a large diff attributed to the wrong component.

The ceiling is pixels: no components, no bands, no causes. An image carries no
structure, so `regions` comes back empty and attribution needs a document.

## Handle every verdict

| Verdict | Meaning | Integration response |
| --- | --- | --- |
| `unchanged` | Comparable images contain no changed pixels. | Continue without review. |
| `changed` | A comparable image differs; regions contain as much attribution as the supplied snapshot and source allow. | Present the evidence and require review. |
| `new` | No baseline exists for the durable key and renderer. | Review and explicitly approve or reject the candidate. Do not treat it as green. |
| `incomparable` | The two sides were painted under incompatible identities — a baseline stored under another renderer identity, or two rasters from two declared painters. | Align renderer inputs or establish a separate baseline; do not accept the noise as a component change. |
| `ignored` | Pixels moved, but every difference was absorbed by a declared exclusion or sensitivity. | Continue while recording that the green result depended on a rule. |

An observation also records whether rendering occurred, missing fonts,
comparison and isolation details, ignored-pixel accounting, component causes
when both sides carry hashes, and diagnostics such as a mismatch between the
acquired subject size and the painted image.

## Wire the dependencies

`ObserveOptions` requires a `Renderer` as `renderer` and a `RasterStore` as
`store`:

- `renderer` owns image production and render identity. Keep its lifecycle
  outside a per-subject loop; launching a browser for every observation defeats
  the cache and session economy.
- `store` supplies both durable-baseline lookup and a content-addressed render
  cache. Its backend does not change verdict semantics.
- On `observeCaptureAgainstBaseline` the pair splits: `store` stays required and
  `renderer` is needed only when the artifact carries a document. A raster
  artifact is compared and stored without one ever being constructed, which is
  what lets a unit runner hand over pixels from a machine that has no browser.
- `snapshot`, `source`, comparison settings, decoder, region limit, sensitivity,
  and difference-shape ignores enrich or narrow the decision. Their exact types
  live in `ObserveOptions` and `CompareInputs`.

Moving from a directory store to git-LFS, a remote store, or another conforming
backend does not change the answer; each backend supplies the same `RasterStore`
contract.

## When integration fails

- **Everything is `new`:** confirm the baseline key and
  `renderer.identityFor(document)` match the values used when the approved
  baseline was written.
- **Everything is `incomparable`:** compare the reported identities. Browser,
  platform, scale, font declarations, and stabilization inputs partition
  baselines intentionally.
- **Regions have coordinates but no components:** supply the semantic snapshot
  from the same render.
- **Components have no source lines:** supply a matching `SourceIndex`.
- **A warm run reports stale component causes:** do not store snapshot-derived
  component hashes as render-cache truth. This package replaces cached hashes
  with the hashes from the current snapshot before deciding.
- **The first durable result needs accepting:** that lifecycle is deliberately
  outside this package; use or reproduce an explicit candidate-review-promote
  boundary rather than writing the first image automatically.

## Boundaries

This package performs no DOM acquisition, opens no browser, chooses no baseline
directory, writes no report, emits no exit code, and exposes no approval command.
Those are integration decisions, not omitted defaults.

Import this composition when its fixed order is the order you want. If your
pipeline needs another order, compose the public tools in
`@variance-authority/core`,
`@variance-authority/raster`, and
`@variance-authority/png` directly.
