<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/storybook-collector

> Turn a built or already-served Storybook into Variance Authority subjects.

**Variance Authority** is a visual regression toolkit for web interfaces: it
compares a rendered subject against an approved baseline and reports which
component caused each change. This package is one piece of it.

**Requires:** a browser binary and a built or already-served Storybook. The
built `index.json` is the input; `.storybook` configuration is not read.

Turn a built or already-served Storybook into subjects that `variance run` can
observe — one subject per story, the unit a comparison runs against. Use this
package when Storybook already owns component mounting and you want
source-attributed visual, semantic, accessibility, and localization findings
without writing a browser harness.

This is the Storybook adapter, not the `variance` binary. Pair it with
`@variance-authority/cli`.

```bash
npm install --save-dev @variance-authority/cli @variance-authority/storybook-collector
npx playwright install chromium
```

## Integrate a Storybook

### 1. Build the artifact you want to observe

The collector — the module you create in step 2 below — reads the artifact
Storybook produced, so run your ordinary Storybook build first. A development
server also works when you pass `baseUrl` below.

### 2. Add a collector module

Create a module in your project and default-export the collector factory. The
only project-specific facts in the common path are where components live and
which stories need an explicit readiness marker.

```js
// variance/storybook.mjs
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  ready: { 'checkout--deferred': '[data-testid="checkout-ready"]' },
  source: { dirs: ['src'] },
});
```

Omit `ready` for stories that are complete when Storybook emits
`storyRendered`. Add an entry only when a story continues mounting or fetching
after that signal. If the selector never appears, collection fails with the
story id and selector instead of silently capturing a spinner.

`source` enables component-to-`file:line` attribution. Without it the report can
still name components, but it cannot point to their declarations.

Against a built Storybook those names arrive minified — a run reports the cause
as `Ce`, not `Button`, because the bundler renamed it and nothing in the browser
remembers otherwise. `file:line` is the identifier that survives minification,
which is what makes the plugin below load-bearing there rather than an
enhancement.

It names where a component is *declared* — one line however many times that
component is rendered.

For the line the changed element is actually written on: against a
**development** Storybook, source locations work automatically — nothing to
configure. Against a **built, minified** Storybook it needs the
`@variance-authority/jsx-source` plugin in your `viteFinal` with
`esbuild.jsxDev` on; a report prefers the exact location wherever it comes
from, and this collector makes it repository-relative. The plugin does not
take `jsxImportSource`, so a Storybook already compiling against Emotion or
theme-ui keeps doing exactly that.

```bash
npm install --save-dev @variance-authority/jsx-source
```

### 3. Point the CLI at the Storybook index and collector

In `variance.config.json`, the index is the built file and `collector` is the
module you created:

```json
{
  "project": "checkout-ui",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": {
    "kind": "storybook",
    "index": "storybook-static/index.json",
    "collector": "variance/storybook.mjs"
  },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "fonts": [],
  "report": ".variance/report.json"
}
```

### 4. Check the machine, then run

```bash
npx variance doctor --config variance.config.json
npx variance run --config variance.config.json
```

Each run writes `.variance/report.json`, the artifact everything else reads.
Run `npx variance report --config variance.config.json --format html >
.variance/report.html` and open the result in a browser to see before/diff/after
images per changed story, grouped by cause rather than by story. The page
references its images relatively, so it belongs beside the `report` path this
config declares; written anywhere else it shows broken images.

The first successful run exits `1` and reports each story as `new`; a
baseline — the stored snapshot a subject is compared against — nobody
approved is not a pass. Review the candidates, accept the intended subjects,
and run again. The next unchanged run exits `0` without re-rendering
(*painting*) subjects whose stored document digest already proves they did
not move.

The executable `storybook-case` demonstrates the
complete cycle against a Storybook-built artifact: new → accept → unchanged → a
`Button` edit changing exactly the five stories that render it.

## Options

| Option | Use it when | Default and boundary |
| --- | --- | --- |
| `ready` | A particular story finishes after Storybook's render signal. | No additional wait. Keys are Storybook story ids. |
| `readyTimeoutMs` | Storybook or a declared readiness marker legitimately needs longer to answer. | `15000`. A timeout is reported, never replaced by a fallback capture. |
| `loading` | A story's *fallback* is the state you intend to review. | Omitted. Id globs, matched against the story id and the subject id. |
| `suspenseTimeoutMs` | A story legitimately needs longer than five seconds to arrive. | `5000`. `0` skips the wait and keeps the reading. |
| `source` | Reports should resolve component names to `file:line`. | Omitted; component names remain available. An empty or mistyped scan is refused. |
| `baseUrl` | Storybook is already running. | Omitted; the directory containing `subjects.index` is served on loopback for the run. |
| `headless` | You need to watch collection while debugging. | `true`; set `false` locally. |
| `network` | Asset bytes at stable URLs must participate in render identity. | `true`; set `false` only when asset URLs are already content-addressed. |
| `roots` | Your preview mounts somewhere other than the standard roots. | `['#storybook-root', '#root']`, tightest match first. |
| `tests` | The next run should be able to skip stories whose code nothing touched. | `false`. Requires a preview built with `testSelectionProbes()` from `@variance-authority/sense/journal`; without a collector in the page the run says so on stderr and records nothing. |

The package exports `StorybookCollectorOptions` plus the collector contract
types (`Collector`, `CollectorContext`, `Plan`, `PlannedSubject`, and
`Collected`) for callers that need to wrap the factory without re-declaring its
boundary. `SourceScan`, `AcquireRequest`, and `Acquired` expose the corresponding
source and page-agent shapes.

`tests` accepts `true` or `StoryExecutionOptions`: `root` is the repository root
the recorded paths are relative to, `label` must match the one the preview's
`testSelectionProbes()` was given, and `modulesFile` and `coverageFile` override
the repository-keyed cache paths for the block inventory and the coverage index. A
story is its own owner in the recorded index — Storybook is an execution surface
this tool drives one subject at a time — and a story that did not render still
contributes its crossings while never justifying a later skip.

The collector reads a built Storybook index and switches stories over
Storybook's own preview channel, so a suite pays for one navigation rather than
one navigation per story. Addon chrome remains outside the selected story root
and does not enter the subject document.

## Readiness and loading

Before each story is read, the collector waits for every React Suspense boundary
under the story root to settle. This runs first, ahead of stabilization — the
step that pins in-flight CSS animations and transitions to a settled frame
before anything is read — because content that arrives late brings its own
images and fonts.

`ready` cannot cover this case and no marker can: a component that suspends
renders no markup for a selector to attach to, and Storybook's `storyRendered`
has already fired — the story function returned. A story still showing a
fallback when the wait runs out is reported as **not collected**, naming the open
boundaries and the components that wrote them, rather than recorded as a
baseline. A skeleton on a slow machine and the component on a fast one is a
difference no one authored, and every band — the severity category, from
accessibility down to sub-pixel noise, a change is filed under — agrees with
both.

Declare the exception when the fallback is the subject:

```js
export default storybookCollector({
  loading: ['inbox--empty-state'],
  source: { dirs: ['src'] },
});
```

A declared story waits for nothing, and is refused if it turns out to have
settled — a declaration that outlived its subject is the same nondeterminism from
the other side.

## When integration fails

- **The index cannot be read:** build Storybook first and check
  `subjects.index`. The collector reads `index.json`; it does not discover a
  `.storybook` directory.
- **A story times out:** verify the `ready` key is the Storybook story id and
  that the selector is attached only after the intended UI is complete.
- **A story is refused as still waiting:** the named Suspense boundary never
  resolved. Fix what it awaits, or add the story to `loading` if the fallback is
  what you intend to review.
- **Components have names but no source lines:** add or correct `source.dirs`.
  Production minification must also preserve component function names; the
  worked case uses `esbuild.keepNames: true` for this reason.
- **Elements report their component's declaration rather than their own line:**
  against a built Storybook, the `jsx-source` plugin is not installed or
  `esbuild.jsxDev` is off in the build that produced this artifact. Locations
  survive minification, so it is worth turning on. Against a development
  Storybook nothing needs installing — if lines are missing there, React is not
  its development build, the dev server is emitting no source maps, or this is
  React 18 compiled with the classic transform, which records no location for
  either mechanism to read.
- **Images change without a document change:** leave `network` enabled so asset
  response bodies participate in the environment key. Disable it only when the
  URL already identifies the bytes.
- **The browser is missing:** run `npx playwright install chromium`, then
  `variance doctor` again.

## Boundaries

This package handles Storybook only. For pages your application already serves,
use `@variance-authority/route-collector`. For an existing
Playwright test, use
`@variance-authority/playwright-test`, where the test body
already performs navigation, mounting, and readiness.
