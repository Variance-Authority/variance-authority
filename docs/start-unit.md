# Add visual review to the unit tests you already have

Your Vitest or Jest tests already mount components in jsdom and assert on them.
This path puts those same mounted states into visual review: the test writes a
capture, a later process paints it in Chromium, and the screenshot is compared
against an approved baseline. You get visual coverage of the components you
already cover, without writing and maintaining a second Playwright or Storybook
suite for them.

## Why the unit run does not open a browser

The unit test writes a document rather than a picture. `capture` serializes the
mounted subtree with the CSS that applies to it and the bytes of every resource
it references, and one later `variance run` opens Chromium and paints every
capture the suite produced. Your suite keeps its speed and its existing
fixtures, mocks and helpers, and every screenshot in the project is painted in
one place — which is what decides whether two screenshots can be compared at
all.

The cost is what jsdom cannot see. It has no layout engine, so a capture carries
structure and declared style and nothing computed; the run produces pixels and a
verdict, but a changed pixel region is reported unattributed rather than joined
to the component that produced it. If you want the browser inside the test, use
[Vitest browser mode](start-vitest-browser.md) instead.

## Install

```bash
npm install --save-dev @variance-authority/unit-test jsdom
npm install --save-dev @variance-authority/cli
npx playwright install chromium
```

Vitest's jsdom environment loads jsdom from your project rather than bundling
it; drop it from the first line if your suite already installs it. The CLI and
Chromium are the render half — a separate process, and the only place a browser
is launched.

## Keep the capture directory in one place

Captures are written to a directory, and three files have to agree on which one:
the test that writes them, the once-per-run hook that empties it, and the
collector the CLI reads it through. Put the path in one module and import it.

```js
// variance/captures.mjs
export const CAPTURES = '.variance/captures';
```

`writeCapture` refuses to write a second capture under a subject id that already
has one, so a directory carried across two runs fails on the second. Empty it
once per run, from a once-per-run hook — never from a test file, where it races
the other test files and deletes their captures:

```js
// variance/reset.mjs
import { resetCaptures } from '@variance-authority/unit-test';
import { CAPTURES } from './captures.mjs';

export async function setup() {
  await resetCaptures(CAPTURES);
}
```

```js
// vitest.config.mjs
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globalSetup: ['variance/reset.mjs'] },
});
```

This `globalSetup` replaces whatever your project already had there. If you have
one, list both: `globalSetup: ['test/global-setup.ts', 'variance/reset.mjs']`.

## Capture from an existing test

```tsx
// src/save-button.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { capture, writeCapture } from '@variance-authority/unit-test';
import { CAPTURES } from '../variance/captures.mjs';
import { SaveButton } from './save-button.js';

test('save button', async () => {
  const { container } = render(<SaveButton />);
  expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();

  const artifact = await capture(container, {
    subject: 'button/save',
    viewport: {
      width: 320,
      height: 200,
      deviceScaleFactor: 1,
      colorScheme: 'light',
    },
  });

  await writeCapture(CAPTURES, artifact);
});
```

The test keeps its own assertions and still passes or fails on them. The capture
is written beside them and compares nothing here.

`capture(root, options)` takes any `Element` that is mounted in the document:
Testing Library's `container`, a node returned by `getByRole`, or something you
built with `document.createElement` and appended. It reads the document that
element belongs to for the stylesheets that apply to it, so an element that was
never attached carries no styling.

`subject` is the id this state is stored, compared and accepted under. It is any
string, and it has to be unique across the run — one id is one capture file, and
the second write under the same id fails rather than overwriting. The slash in
`button/save` is not a namespace or a directory; the whole string is the id, and
it is what the report shows and what `variance accept` names.

`viewport` is required and is resolved here, in the unit process, because the
renderer never sees this DOM: media queries in the applicable CSS are evaluated
against these values and the result is written into the capture.

| field | what it decides |
| --- | --- |
| `width`, `height` | CSS pixels. Width, height and orientation queries resolve against them, and the later paint uses them. |
| `deviceScaleFactor` | The pixel density of the painted image, and what `resolution` and device-pixel-ratio queries resolve against. `2` gives a 2× image of the same CSS pixels. It is part of the identity a baseline is stored under, so changing it moves the subject into a partition where nothing has been approved yet. |
| `colorScheme` | `light` or `dark`, and what `prefers-color-scheme` resolves to. A dark reading of the same component is a second subject with an id of its own. |

### What the capture has to carry

The capture is painted in another process with no network access, so every URL
the subtree references has to arrive as bytes inside it. If the subtree
references anything — an `<img src>`, a `srcset` candidate, a `url()` in an
applicable rule, an SVG `<use href>` — and you passed no resolver, `capture`
throws and names each one:

```
capture is not resource-closed; supply resolveResource for: /assets/logo.svg
```

Answer it with `resolveResource`, which is handed each URL and returns the bytes:

```ts
import { readFile } from 'node:fs/promises';

const artifact = await capture(container, {
  subject: 'button/save',
  viewport: VIEWPORT,
  resolveResource: async (url) => ({
    contentType: 'image/svg+xml',
    bytes: await readFile(`public${new URL(url).pathname}`),
  }),
});
```

Return `{ absent: true }` for a URL nothing serves: a fixture pointing at a
missing image is a subject like any other, and the renderer answers the same
404 rather than accessing a network it does not have. Returning `null` fails
the capture naming that one URL.

CSS is read out of the document rather than fetched, so nothing has to resolve
for it: `<style>` elements, inline `style`, and every stylesheet the document
already holds are indexed and carried. What never reaches the document never
reaches the capture, and that is the failure worth checking for once. A runner
that stubs CSS imports out instead of injecting them, or a CSS-in-JS library
that removes its `<style>` tags during teardown, leaves the class names in the
markup with nothing matching them — and the baseline is a picture of unstyled
DOM that compares equal to itself forever. Read the count of matched rules in
one capture after wiring this up; a subject with none is the symptom. The
[`@variance-authority/unit-test` reference](../packages/unit-test/README.md) has
`retainStyles` for the teardown case.

## Write the run config

```jsonc
// variance.config.json
{
  "project": "design-system",
  "profile": "jsdom",
  "viewport": { "width": 320, "height": 200 },
  "retention": "durable",
  "subjects": { "kind": "collector", "collector": "variance/collector.mjs" },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "fonts": [],
  "report": ".variance/report.json"
}
```

Unknown keys are refused by name, and paths resolve against this file's own
directory rather than the working directory.

The config is JSON and executes nothing of its own, so `subjects.collector` is
the single key through which any collector — this one, Storybook's, a route
list, one you write — reaches a run. The unit-test collector needs only the
directory:

```js
// variance/collector.mjs
import { captureCollector } from '@variance-authority/unit-test';
import { CAPTURES } from './captures.mjs';

export default captureCollector({ directory: CAPTURES });
```

| key | what it decides |
| --- | --- |
| `project` | The label this project's rows are filed under in a shared history store. Required even with no history configured, because rows written under a project nobody chose cannot be re-attributed later. |
| `profile` | What the run is *capable* of observing. `jsdom` is structure, ARIA and declared style, which is what a capture taken in a unit process carries; `chromium` adds computed style, layout and geometry, and belongs to a collector that observed inside a browser. It does not decide what paints — the configured browser paints either way — it decides what the report may claim about a change. Set it to match where the capture was taken. |
| `viewport` | `width` and `height` in CSS pixels, plus optional `deviceScaleFactor` (default `1`) and `colorScheme`, `light` or `dark` (default `light`). Every capture carries its own viewport and that is the one used for its subject; this value is the fallback for a subject that arrives without one. Keep it equal to the viewport your tests capture at. |
| `retention` | `durable` compares against an image a previous run stored, and requires `baselines`. That is why the first run exits `1`: nothing is stored yet, so there is nothing to compare against and the candidate is waiting for review. `ephemeral` renders both sides inside one run and keeps neither, and then `baselines` must be absent — a config that sets both is refused rather than silently storing nothing. |
| `subjects.kind` | Where the run gets its subject list. `collector` is a module like the one above. The alternatives are `storybook`, which reads a built story index, and `list`, where you write the ids down yourself. |
| `baselines.kind` | Where approved images live: `directory` is files you commit, `lfs` is the same files through the Git LFS filter, `remote` is a deployment and a token with nothing in the repository. No default — see [baseline placement](placement.md). |
| `fonts` | Fonts this machine is asserted to have, each as `family/weight/style/hash`. The hash is of the font bytes and is yours to supply, because a page can ask whether a family resolves and can never read the file behind it. Defaults to `[]`, which asserts nothing: two machines carrying different cuts of Inter then produce the same identity, compare, and report the difference as a component change. Naming them makes that a refused comparison instead. |
| `report` | Where `run` writes, and where `report` and `accept` read. Defaults to `.variance/report.json`. |

### Commit the approved images

`.variance/baselines` is what every later run compares against, so it has to be
tracked and pushed. A run that cannot read it does not fail: it finds nothing,
reports every subject `new`, records what is on screen as the new truth, and
exits `0`.

The trap is the wildcard. `.variance/` also holds captures, a report and
candidate images that genuinely are per-run junk, and a repository that ignores
the whole directory ignores the approved images under it too. Exclude the
contents, so git still descends:

```gitignore
.variance/*
!.variance/baselines/
```

## Run the first loop

A `--save-dev` install puts `variance` in `node_modules/.bin`, so run it through
`npx` or from a package script.

```bash
npx vitest run
npx variance doctor --config variance.config.json
npx variance run --config variance.config.json
```

`doctor` reports what this machine can do: it opens the browser that will
paint, measures the fonts you asserted inside it, and lists
which identities the baseline root holds and whether this machine's is one of
them.

The unit suite passes as it did, having written one capture per subject. The
first durable run exits `1` and reports `button/save` as `new` — an image nobody
has approved is not a pass.

### Look at the candidate

Write the HTML report beside the JSON one, because the image links inside it are
relative to the report:

```bash
npx variance report --config variance.config.json --format html > .variance/report.html
```

Open `.variance/report.html` in a browser. It is one self-contained file that
fetches nothing, so it works the same from your machine or from a CI artifact.
The top says which run it is and what painted it; the subjects that need review
are listed first, grouped by what they have in common when several moved the
same way.

Each subject is a picture you can work: the approved image, the difference, and
the candidate, with a wipe to drag between the two, a blend, a blink, and an
overlay of the regions the comparison found. `button/save` is `new`, so there is
no approved image yet and nothing to compare against — what you are looking at
is the candidate on its own, and the decision is whether that is what the
component is supposed to look like.

It is, so approve it:

```bash
npx variance accept --config variance.config.json button/save
npx variance run --config variance.config.json
```

`accept` promotes the image this run already produced; it never renders one, so
there is nothing to regenerate and no reason to re-run the suite. The captures
stay on disk until the next `vitest run` empties the directory, and the rerun
reads the same ones. It exits `0` and reports `button/save` as `unchanged`.

From here the loop is: change the component, run the suite, run `variance run`.
A run that exits `1` has something for you in the report.

## Go deeper

- [baseline placement](placement.md) — `directory`, `lfs` and `remote`, and what
  each costs when the capture and render jobs run on different machines.
- [composition](composition.md) — when this result has to join evidence a
  browser collected.
- [attribution](attribution.md) — what a report can name a change by, and what
  each hop needs to succeed.
- [`@variance-authority/unit-test`](../packages/unit-test/README.md) — Jest
  setup, `retainStyles`, the framework readers that attach component names and
  props to a capture, and `snapshotValue`, which records a public surface that
  is not a page — an API response, a schema, a route table — as a value capture
  rather than a document.
