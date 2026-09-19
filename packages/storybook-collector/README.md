<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/storybook-collector

> Turn a built or already-served Storybook into Variance Authority subjects.

Part of [Variance Authority](https://variance-authority.dev).

## What this is for

You already have a Storybook. Each story is a UI state somebody deliberately
named, mounted and made ready — which is the expensive half of visual regression
testing, and you have paid for it.

This package hands that catalogue to `npx variance run` without a browser harness of
your own. It reads the `index.json` your Storybook build writes, opens the
preview once, switches stories over Storybook's own channel, and produces one
**subject** per story — one named UI state you asked for and can ask for again,
and the unit a comparison runs against. A story's subject id is its Storybook
story id with a `story:` prefix: `story:checkout--empty`.

What you get back is not only a pixel diff. Each changed region resolves to the
React component that rendered it and to the `file:line` where that component is
declared, so a red run names `Button` in `src/ds.tsx:41` rather than a rectangle.

This is the Storybook adapter, not the `variance` binary. The binary lives in
`@variance-authority/cli`, and both are installed below.

## Requirements

| Requirement | Detail |
| --- | --- |
| Node | 22.15 or newer. |
| Module format | ESM only. Every `@variance-authority/*` package sets `"type": "module"`; `require()` will not load them. |
| Browser | Chromium, installed through Playwright. The binaries do not arrive with an `npm install`. |
| Storybook | Exercised against Storybook 10 with `@storybook/react-vite`. Index versions `3`, `4` and `5` are read, and the story root is looked for at `#storybook-root` (Storybook 7 and later) and then `#root` (before it). Storybook 8.3 and later emit `storyFinished`, which this package waits for; it falls back to `storyRendered` when the event is absent. |
| Builder | Collection reads `index.json` and drives the preview channel, so it does not know or care whether Vite or Webpack 5 built the Storybook. Two optional precision features are Vite plugins with no Webpack equivalent, and are named as such where they appear below: `@variance-authority/jsx-source` and the `tests` option. |
| React | Required for component attribution, the `wiring` band and the Suspense wait. The reading is of the expando `react-dom` writes on host nodes — `__reactFiber$` on React 17 and later, `__reactInternalInstance$` on React 16 — so there is no React version to match and none is imported. The suite runs against React 19. |

A Storybook whose renderer is not React still collects: documents, pixels,
comparison and verdicts all work, and the fiber walk reports nothing rather than
failing. Set `wiring: false` so it does not visit every node to find that out.

## Install

```bash
npm install --save-dev @variance-authority/cli @variance-authority/storybook-collector
npx playwright install chromium
```

## Run the first loop

Four steps. Nothing here reads your `.storybook` directory — the built
`index.json` is the input, whether you build the Storybook or already serve one.

### 1. Build the Storybook

```bash
npx storybook build -o storybook-static
```

A development server works too; pass its origin as `baseUrl` in step 2 and skip
the build.

### 2. Write the collector module

The collector is the module that tells the run how to reach and read your
stories. Create it anywhere in your project and default-export the factory.

```js
// variance/storybook.mjs
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  source: { dirs: ['src'] },
});
```

`source.dirs` is a list of directory paths — not globs — resolved against the
directory you run `variance` from. The scan reads `.tsx`, `.jsx`, `.ts` and
`.js`, skips `node_modules`, `dist`, `storybook-static` and any path containing
`.test.`, `.spec.` or `.stories.`, and indexes where each component is
*declared*. Without it the report still names components and resolves none of
them to a file. A `dirs` list that matches no source file at all is refused,
naming the directories it walked.

### 3. Write the run config

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

Save it as `variance.config.json`. Paths resolve against this file's directory
rather than the working directory, and unknown keys are refused by name.
`profile` is what the run is capable of observing — `chromium` resolves computed
style, layout and pixels, and a Storybook loop paints, so it is `chromium`.

Track the approved images. `.variance/` also holds per-run junk, so exclude the
contents rather than the directory:

```gitignore
.variance/*
!.variance/baselines/
```

### 4. Check the machine, run, accept, run again

```bash
npx variance doctor --config variance.config.json
npx variance run --config variance.config.json
```

`doctor` opens a browser, measures the fonts your config asserts, and lists
which **identities** the baseline root holds — an identity being the digest of
renderer, engine, platform, device scale factor and fonts that an approved image
is stored under. It exits `2` when no browser opens or when the root holds no
images this machine could compare against.

The first durable run exits `1` and reports every story `new`. An image nobody
approved is not a pass. Promote the candidates the run already produced:

```bash
npx variance accept --config variance.config.json --all
npx variance run --config variance.config.json
```

The second run exits `0` and reports every story `unchanged`.

`accept` never renders again — it promotes an image this run produced — and its
full form is:

```
npx variance accept [--config <path>] <subject>... | --all | --shape <fingerprint>[,...] [--message-file <path> [--message <text>]]
```

Keep `--all` for the first run and for deliberate re-baselines; it cannot tell a
story nobody looked at from one that changed. After setup, name subject ids:

```bash
npx variance accept --config variance.config.json story:checkout--empty story:checkout--one-item
```

`--shape` takes a **fingerprint** — an identifier every changed region in the
report carries, naming *what* changed rather than which screenshots it landed
in. Accepting one covers every subject where that shape is the whole change, and
refuses by name any subject where something else moved too.

### What you get

`npx variance run` prints its summary to the terminal and writes the same facts to
`.variance/report.json`, which every other command reads. Abridged, a run after
one edit to `Button`:

```
12 of 14 subject(s) observed, durable run at 2026-01-14T09:22:41.108Z
rendered by playwright-chromium (chromium@131, darwin/arm64, 1x)
7 unchanged, 5 changed, 2 not observed

[changed] story:checkout--empty — Button: 1356 pixel(s) differ across 2 region(s) in Button
[changed] story:checkout--one-item — Button: 1356 pixel(s) differ across 2 region(s) in Button

not observed: 2 subject(s) — 0 the run could not see, 2 excluded by configuration, 0 not reached by this change
  [excluded] story:checkout--docs-only: excluded by tag `no-variance`
```

The second list is the point of the first number. A run that planned fourteen
subjects, observed twelve and found five changes is a different fact from a run
of twelve, so every subject that was never observed is named with the reason.

For the before, diff and after images per changed story, grouped by cause rather
than by story:

```bash
npx variance report --config variance.config.json --format html > .variance/report.html
```

The page references its images relatively, so write it beside the `report` path
the config declares. Written anywhere else it shows broken images.

An unchanged rerun does not repaint a story whose stored document digest already
proves it did not change.

## Options

Everything below is passed to `storybookCollector(...)` in the module from step
2.

| Option | Use it when | Default and boundary |
| --- | --- | --- |
| `ready` | A particular story finishes after Storybook's render signal. | No additional wait. Keys are Storybook story ids. |
| `readyTimeoutMs` | Storybook or a declared readiness marker legitimately needs longer to answer. | `15000`. A timeout is reported, never replaced by a fallback capture. |
| `loading` | A story's *fallback* is the state you intend to review. | Omitted. Id globs, matched against the story id and the subject id. |
| `suspenseTimeoutMs` | A story legitimately needs longer than five seconds to arrive. | `5000`. `0` skips the wait and keeps the reading. |
| `source` | Reports should resolve component names to `file:line`. | Omitted; component names remain available. An empty or mistyped scan is refused. |
| `baseUrl` | Storybook is already running, e.g. `http://localhost:6006`. | Omitted; the directory containing `subjects.index` is served on loopback for the run. |
| `headless` | You need to watch collection while debugging. | `true`. |
| `network` | Asset bytes at stable URLs must participate in render identity. | `true`; set `false` only when asset URLs are already content-addressed. |
| `hashAssets` | Your asset URLs already carry their own content hash. | `true`. Read only while `network` is on, so GIF freezing and blanking survive it — this, not `network: false`, is the setting for a content-addressed build. |
| `wiring` | Your preview's renderer is not React. | `true`. Reads props, context, hook cells and keys into a band of its own; turning it off changes no stored digest. |
| `holdings` | Application values behind the nodes are evidence you want carried. | `false`. Changes `structureHash` — an inert wrapper survives the collapse — so both sides of a comparison must be read the same way. |
| `roots` | Your preview mounts somewhere other than the standard roots. | `['#storybook-root', '#root']`, tightest match first. |
| `tests` | The next run should be able to skip stories whose code nothing touched. | `false`. Requires a Vite-built preview carrying `testSelectionProbes()`; see below. |

A **band** is the severity category a change is filed under. Loudest first:
`a11y`, `geometry`, `token`, `content`, `texture`. A role or accessible name that
moved outranks a box that moved, which outranks a style value, which outranks
text, which outranks sub-pixel noise.

The package exports `StorybookCollectorOptions` plus the collector contract
types (`Collector`, `CollectorContext`, `Plan`, `PlannedSubject` and
`Collected`) for callers that need to wrap the factory without re-declaring its
boundary. `SourceScan`, `AcquireRequest` and `Acquired` expose the corresponding
source and page-agent shapes.

One navigation serves the whole suite rather than one navigation per story, and
addon chrome stays outside the selected story root, so it never enters the
subject document.

## Readiness and loading

Most stories are complete when Storybook emits `storyRendered`. Add a `ready`
entry only when a story continues mounting or fetching after that signal, keyed
by Storybook story id:

```js
// variance/storybook.mjs
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  ready: { 'checkout--deferred': '[data-testid="checkout-ready"]' },
  source: { dirs: ['src'] },
});
```

If the selector never appears, collection fails naming the story and the
selector instead of silently capturing a spinner.

React Suspense is handled without a marker, and needs to be. Before each story is
read, every Suspense boundary under the story root is waited on — ahead of
stabilization, the step that pins in-flight CSS animations and transitions to a
settled frame, because content that arrives late brings its own images and fonts.
A marker cannot cover this case: a component that suspends renders no markup for
a selector to attach to, and `storyRendered` has already fired because the story
function returned.

A story still showing a fallback when the wait runs out is reported as **not
collected**, naming the open boundaries and the components that wrote them. A
skeleton on a slow machine and the component on a fast one is a difference no one
authored.

Declare the exception when the fallback *is* the subject:

```js
// variance/storybook.mjs
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  loading: ['inbox--empty-state'],
  source: { dirs: ['src'] },
});
```

A declared story waits for nothing, and is refused if it turns out to have
settled — a declaration that outlived its subject is the same nondeterminism from
the other side.

## Sharper source lines from a built Storybook

Two things get lost in a production Storybook build, and both are recovered in
`.storybook/main.js`. Skip this section entirely against a development
Storybook, where names and lines survive by default.

**Component names.** A bundler renames functions, React reads a component's
display name off the function, and a run then reports the cause as `Ce` rather
than `Button` — a complete, confident answer naming something that appears
nowhere in your source. Keep function names in whatever your builder spells that
setting.

**Element lines.** With names alone, a changed element resolves to the line its
component is *declared* on — one line however many times that component is
rendered. `@variance-authority/jsx-source` makes it resolve to the line the
element itself is written on. It is a Vite plugin.

```bash
npm install --save-dev @variance-authority/jsx-source
```

Added to an existing Vite config rather than replacing one. On Vite 8 the two
settings sit in two different sections — the JSX transform under `oxc`, keeping
names under `build.rolldownOptions.output`:

```js
// .storybook/main.js
import { jsxSource } from '@variance-authority/jsx-source/vite';

export default {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  framework: { name: '@storybook/react-vite', options: {} },
  viteFinal: async (config) => ({
    ...config,
    plugins: [...(config.plugins ?? []), jsxSource()],
    oxc: { ...config.oxc, jsx: { runtime: 'automatic', development: true } },
    build: {
      ...config.build,
      rolldownOptions: {
        ...config.build?.rolldownOptions,
        output: { ...config.build?.rolldownOptions?.output, keepNames: true },
      },
    },
  }),
};
```

`development: true` is what makes the transform emit each element's file, line
and column at all; without it there is no location for the plugin to keep, and a
changed element reports the line its component is declared on. `keepNames` is a
Rolldown output option and does nothing inside the `oxc` block — it belongs in
the `build` section, not beside the JSX keys.

Vite 7 and below spell all three under `esbuild` — `jsx: 'automatic'`,
`jsxDev: true` and `keepNames: true` — in place of both sections above. A config
carrying the other major's key is read by nothing and warns about nothing: the
build succeeds, and the report names `Ce`. See
[`@variance-authority/jsx-source`](https://variance-authority.dev/reference/packages/jsx-source)
for builds that already use Emotion, theme-ui or another custom JSX runtime.

## Skipping stories nothing touched

With `tests`, a run records which blocks of your code each story crossed, so the
next run can skip a story whose code your diff did not reach. The recording is
done by a Vite plugin in the preview build:

```bash
npm install --save-dev @variance-authority/sense
```

```js
// .storybook/main.js
import { testSelectionProbes } from '@variance-authority/sense/journal';

export default {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  framework: { name: '@storybook/react-vite', options: {} },
  viteFinal: async (config) => ({
    ...config,
    plugins: [...(config.plugins ?? []), testSelectionProbes({ label: 'storybook' })],
  }),
};
```

```js
// variance/storybook.mjs
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  source: { dirs: ['src'] },
  tests: { label: 'storybook' },
});
```

`tests` accepts `true` or an options object: `label` must match the one the
preview's `testSelectionProbes()` was given, `root` is the repository root the
recorded paths are relative to, and `cacheRoot` and `coverageFile` override the
repository-keyed cache paths for the block records and the coverage index.
Without a collector in the page, the run says so on stderr and records nothing.

A story is its own owner in the recorded index — Storybook is an execution
surface this tool drives one subject at a time — and a story that did not render
still contributes its crossings while never justifying a later skip.

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
- **The report names a component that is nowhere in your source:** minification
  renamed it. See the `keepNames` setting above.
- **Elements report their component's declaration rather than their own line:**
  this is the expected fallback for an uninstrumented built Storybook. Install
  `jsx-source` only when the report must distinguish the exact element instance.
  Against a development Storybook nothing normally needs installing; missing
  lines there mean React is not its development build, the dev server emits no
  source maps, or React 18 is still compiled to classic `createElement` calls.
- **Images change without a document change:** leave `network` enabled so asset
  response bodies participate in the environment key. Disable it only when the
  URL already identifies the bytes.
- **The browser is missing:** run `npx playwright install chromium`, then
  `npx variance doctor` again.
- **A rerun reports `incomparable`:** the approved image was stored under a
  different identity than this machine produces. `npx variance doctor` lists the
  identities the baseline root holds.

## Boundaries

This package handles Storybook only. For pages your application already serves,
use `@variance-authority/route-collector`. For an existing Playwright test, use
`@variance-authority/playwright-test`, where the test body already performs
navigation, mounting and readiness.

---

**[@variance-authority/storybook-collector](https://variance-authority.dev/reference/packages/storybook-collector)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
