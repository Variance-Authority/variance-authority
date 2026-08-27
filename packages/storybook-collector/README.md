<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/storybook-collector

**Requires:** a browser binary and a built or already-served Storybook. The
built `index.json` is the input; `.storybook` configuration is not read.

Turn a built or already-served Storybook into subjects that `variance run` can
observe. Use this package when Storybook already owns component mounting and you
want source-attributed visual, semantic, accessibility, and localization
findings without writing a browser harness.

This is the Storybook adapter, not the `variance` binary. Pair it with
[`@variance-authority/cli`](../cli).

```bash
npm install --save-dev @variance-authority/cli @variance-authority/storybook-collector
npx playwright install chromium
```

## Integrate a Storybook

### 1. Build the artifact you want to observe

The collector reads the artifact Storybook produced, so run your ordinary
Storybook build first. A development server also works when you pass `baseUrl`
below.

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

It names where a component is *declared* — one line however many times that
component is rendered.

For the line the changed element is actually written on, a **development**
Storybook needs nothing: React 19 captures the call site itself, and the
elements a report is about to name are resolved through the source map the dev
server already emits — a story that settled on its digest resolves nothing —
while React 18 keeps the transform's own location on the fiber and needs no
resolving at all. Against a **built, minified** Storybook there is no such capture, and the
way to have it there is the
[`@variance-authority/jsx-source`](../jsx-source) plugin in your `viteFinal`
with `esbuild.jsxDev` on. A report prefers the exact location wherever it comes
from, and this collector makes it repository-relative. The plugin does not take
`jsxImportSource`, so a Storybook already compiling against Emotion or theme-ui
keeps doing exactly that.

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

The first successful run exits `1` and reports each story as `new`; a baseline
nobody approved is not a pass. Review the candidates, accept the intended
subjects, and run again. The next unchanged run exits `0` without painting
subjects whose stored document digest already proves they did not move.

The executable [`storybook-case`](../../cases/storybook-case) demonstrates the
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

The package exports `StorybookCollectorOptions` plus the collector contract
types (`Collector`, `CollectorContext`, `Plan`, `PlannedSubject`, and
`Collected`) for callers that need to wrap the factory without re-declaring its
boundary. `SourceScan`, `AcquireRequest`, and `Acquired` expose the corresponding
source and page-agent shapes.

The collector reads a built Storybook index and switches stories over
Storybook's own preview channel, so a suite pays for one navigation rather than
one navigation per story. Addon chrome remains outside the selected story root
and does not enter the subject document.

## Readiness and loading

Before each story is read, the collector waits for every React Suspense boundary
under the story root to settle. This runs first, ahead of stabilization, because
content that arrives late brings its own images and fonts.

`ready` cannot cover this case and no marker can: a component that suspends
renders no markup for a selector to attach to, and Storybook's `storyRendered`
has already fired — the story function returned. A story still showing a
fallback when the wait runs out is reported as **not collected**, naming the open
boundaries and the components that wrote them, rather than recorded as a
baseline. A skeleton on a slow machine and the component on a fast one is a
difference no one authored, and every band agrees with both.

Declare the exception when the fallback is the subject:

```js
export default storybookCollector({
  loading: ['inbox--empty-state'],
  source: { dirs: ['src'] },
});
```

A declared story waits for nothing, and is refused if it turns out to have
settled — a declaration that outlived its subject is the same nondeterminism from
the other side. The decision is
[ADR-0037](../../docs/context/adr/0037-a-subject-still-arriving-is-refused.md).

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
use [`@variance-authority/route-collector`](../route-collector). For an existing
Playwright test, use
[`@variance-authority/playwright-test`](../playwright-test), where the test body
already performs navigation, mounting, and readiness.

Cause-first ordering also depends on the baseline carrying component hashes. A
baseline without them can still produce attributed regions, but the docket must
order those regions by area and state that displacement is not blame.
