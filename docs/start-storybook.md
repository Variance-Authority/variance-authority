# Compare Storybook stories against approved screenshots

Story ids already name your UI states, and `storybook-static/index.json` already
lists every one. This page turns that list into screenshots you approved —
build, run, review, accept, rerun — and a story whose pixels move afterwards is
reported by the component that changed and its `file:line`.

Use this path when Storybook already owns mounting, decorators, play functions
and readiness. Those stay with Storybook; nothing here re-implements them.

## What you get that you do not have now

`@storybook/test-runner` runs your play functions and assertions in a browser.
It holds no approved screenshots, so a visual change nobody wrote an assertion
for goes through green. Chromatic holds them and renders and reviews in its own
cloud.

Here:

- **Rendering, the images and the review surface are yours.** Pixels are made by
  a browser you launched or a renderer you host, and the approved images sit in
  your repository.
- **A changed region resolves to a component and a source line.** The report
  groups a red run by what caused it rather than by which story showed it, and
  points at the declaration in your own tree. [Attribution](attribution.md) is
  that chain.
- **A story can be skipped because nothing reached it.** `variance run --since`
  skips a story whose approved image records none of the components your diff
  touched — decided from what the last run actually rendered, not from a module
  graph. See [test selection](selecting.md).
- **A difference can be told from a flake.** [Parting](parting.md) reads two
  renderings of one story and names the input that changed, or says every input
  agreed and the output moved anyway.

[Comparison](comparison.md) sets the four hosted products side by side.

## Before you collect

Build the Storybook you want to compare. A served development Storybook also
works, but this first loop reads `storybook-static/index.json`.

```bash
npm install --save-dev @variance-authority/cli @variance-authority/storybook-collector
npx playwright install chromium
```

Playwright's browser binaries do not arrive with an `npm install`, which is what
the second command is for.

## Point the collector at the build

The collector is the module that discovers your stories and captures them. Write
it once. Replace `src` if your components are declared somewhere else:

```js
// variance/storybook.mjs
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  source: { dirs: ['src'] },
});
```

### `source.dirs`

A built Storybook ships bundled code. The browser can tell the run which
component produced an element, but not which file that component is written in,
so the collector scans your source tree instead and indexes where each component
is declared.

The value is a list of directory paths — not globs — resolved against the
directory you run `variance` from, or absolute. The scan reads `.tsx`, `.jsx`,
`.ts` and `.js`, and skips `node_modules`, `dist`, `storybook-static`, and any
path containing `.test.`, `.spec.` or `.stories.`.

Get it wrong in the large — a path that matches no source file at all — and the
run is refused, naming the directories it walked. Get it wrong in the small — a
package left out of the list — and the components declared there keep their
names in the report and resolve to no file.

### A story that is not ready when Storybook says it is

Most stories are complete when Storybook emits `storyRendered`. A story that
keeps fetching or mounting after that signal needs a selector your application
attaches when it is genuinely done, keyed by Storybook story id:

```js
// variance/storybook.mjs
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  ready: { 'checkout--deferred': '[data-testid="checkout-ready"]' },
  source: { dirs: ['src'] },
});
```

If the selector never appears, collection fails naming the story and the
selector, rather than photographing a spinner. React Suspense is handled without
a marker: the collector waits for every boundary under the story root to settle,
and reports a story still showing its fallback as not collected.

## Write the run config

```jsonc
// variance.config.json
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

Unknown keys are refused by name, and paths resolve against this file's own
directory rather than the working directory.

| key | what it decides |
| --- | --- |
| `project` | The label this project's rows are filed under in a shared history store. Required even with no history configured, because rows written under a project nobody chose cannot be re-attributed later. |
| `profile` | What the run is *capable* of observing: `chromium` resolves computed style, layout and pixels; `jsdom` resolves structure, ARIA and declared style only, and paints nothing. A Storybook loop paints, so it is `chromium`. This is not the engine — that is `browser`, one of `chromium`, `firefox`, `webkit`, defaulting to `chromium`, and the `npx playwright install` above installs its binary. |
| `viewport` | `width` and `height` in CSS pixels, plus optional `deviceScaleFactor` (default `1`) and `colorScheme`, `light` or `dark` (default `light`). One viewport per config: the viewport is part of the identity an image is stored under, so a second width is a second config with its own approved images and its own run. |
| `retention` | `durable` compares against an image a previous run stored, and requires `baselines`. `ephemeral` renders both sides inside one run and keeps neither, and then `baselines` must be absent — a config that sets both is refused rather than silently storing nothing. |
| `subjects.kind` | `storybook` reads a built story index. The alternatives are `list`, where you write the subject ids down yourself, and `collector`, where the collector module discovers them. |
| `baselines.kind` | Where approved images live: `directory` is files you commit, `lfs` is the same files through the Git LFS filter, `remote` is a deployment and a token with nothing in the repository. No default — see [baseline placement](placement.md). |
| `fonts` | Fonts this machine is asserted to have, each as `family/weight/style/hash`. The hash is of the font bytes and is yours to supply, because a page can ask whether a family resolves and can never read the file behind it. With `[]` you assert nothing, so two machines carrying different cuts of Inter produce the same identity, compare, and report the difference as a component regression. Naming them makes that a refused comparison instead. `variance doctor` measures the asserted families and lists the ones it could not find. |
| `report` | Where `run` writes, and where `report` and `accept` read. Defaults to `.variance/report.json`. |

### Commit the approved images

`.variance/baselines` is what every later run compares against, so it has to be
tracked and pushed. A run that cannot read it does not fail: it finds nothing,
reports every story `new`, records what is on screen as the new truth, and
exits `0`.

The trap is the wildcard. `.variance/` also holds a report and candidate images
that genuinely are per-run junk, and a repository that ignores the whole
directory ignores the approved images under it too. Exclude the contents, so git
still descends:

```gitignore
.variance/*
!.variance/baselines/
```

## Run the first loop

Run `doctor` on the same machine or CI image that will execute the run, then
collect:

```bash
variance doctor --config variance.config.json
variance run --config variance.config.json
```

`doctor` opens a browser here, measures the asserted fonts inside it, and lists
which identities the baseline root holds and whether this machine's is one of
them. It makes no network calls, so a remote renderer or store is reported as
configured and never as reachable. It exits `2` when no browser opens or when
the root holds no images this machine could compare against, and `0` otherwise —
a missing font is reported and does not change the exit code.

The first successful durable run exits `1` and reports the stories as `new`. An
image nobody approved is not a pass.

Render the HTML report beside the JSON report so its relative image links hold:

```bash
variance report --config variance.config.json --format html > .variance/report.html
```

Open it and look at the candidate — the screenshot this run just took. Copy the
subject id it shows; Storybook subjects carry a `story:` prefix. For a story
whose Storybook id is `checkout--empty`:

```bash
variance accept --config variance.config.json story:checkout--empty
variance run --config variance.config.json
```

`accept` makes that candidate the image later runs compare against. The rerun
exits `0` and reports the story as `unchanged`.

### Accepting several hundred stories on day one

On the first run every story is `new` and there is nothing to review each one
against. `--all` promotes every candidate the run produced:

```bash
variance accept --config variance.config.json --all
git add -- .variance/baselines
```

Keep `--all` for that first run and for deliberate re-baselines. It cannot tell
a story nobody has looked at from one that changed, so after setup name subject
ids, or use `--shape <fingerprint>` to promote one category of difference
wherever it accounts for the whole change and refuse by name any story where
something else moved too.

## Running this in CI

The image a browser paints depends on the machine that painted it. Every
approved image is stored under an identity digest of the renderer, engine,
platform, device scale factor and fonts, and an image stored under a different
identity is not diffed against — the run reports `incomparable`, and `doctor`
exits `2` listing the identities the root does hold.

So your laptop and CI never compare against different identities — pick one
painter and use it for both:

- run local and CI through the same pinned container image, and accept images
  from inside it; or
- set `"renderer": { "endpoint": "…" }` to one machine both use, which paints
  for both and owns the identity. It is mutually exclusive with `browser`, and
  it has no authentication of its own, so it belongs inside a network you
  control.

## Go deeper

Against a built Storybook, component names arrive minified: a run names the
cause `Ce` because the bundler renamed it and nothing in the browser remembers
otherwise. Two decisions follow, and both are optional.

- **Keep component names in the build**, so the report says `Button`. Vite 8
  spells it `build.rolldownOptions.output.keepNames`; Vite 7 and below spell it
  `esbuild.keepNames`.
- **Install `@variance-authority/jsx-source`**, if the report must point at the
  line the changed element is written on rather than the line its component is
  declared on. A development Storybook needs no instrumentation for this.

Then:

- [attribution](attribution.md) — how a changed region becomes a component and a
  `file:line`, and what each hop needs to succeed.
- [parting](parting.md) — which input changed between two readings, and how a
  flake is told apart from an edit.
- [baseline placement](placement.md) — `directory`, `lfs` and `remote`, and what
  each costs.
- [test selection](selecting.md) — the top-level `source` block and
  `variance run --since`.
- [`@variance-authority/storybook-collector`](../packages/storybook-collector/README.md)
  — every collector option: `baseUrl` for a Storybook you already serve,
  `loading` for a fallback you mean to review, `readyTimeoutMs`, `roots`, and
  the rest.
