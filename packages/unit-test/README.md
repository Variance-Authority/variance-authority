<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/unit-test

> Put the states your Vitest suite already mounts in jsdom into visual regression review, without launching a browser in the test process.

Part of [Variance Authority](https://variance-authority.dev).

Your jsdom tests already mount components and assert on them. This package
writes each mounted state to disk as a *capture*: the markup, the CSS that
applies to it, and the bytes of every resource it references. One later
`variance run` opens Chromium once, paints every capture the suite produced,
compares each image against the one you approved, and reports what moved. You
get visual coverage of the components you already cover, without a second
Playwright or Storybook suite for them.

Each comparison is keyed by a **subject id** — one named UI state you asked for
and can ask for again, such as `cart/empty`.

The test process needs a live DOM and a directory it can write to. It launches
no browser, produces no screenshot and reaches no verdict, and this package
exports no `test`, `expect` or reporter: your suite keeps its own runner,
fixtures and assertions, and passes or fails on them as before.

The cost of staying browserless is that jsdom has no layout engine. The run
still produces pixels and a verdict, but a changed pixel region is reported
unattributed rather than joined to the component that produced it. If you want
the browser inside the test, use
[`@variance-authority/vitest-browser`](https://variance-authority.dev/reference/packages/vitest-browser)
instead.

## Install

In the test job:

```bash
npm install --save-dev @variance-authority/unit-test jsdom
```

Vitest needs `// @vitest-environment jsdom` at the top of the test file, or the
equivalent project setting. This package configures no runner.

In the job that paints — a separate process, and the only place a browser is
launched:

```bash
npm install --save-dev @variance-authority/cli
npx playwright install chromium
```

## Capture a mounted state

```tsx
// src/save-button.test.tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { capture, writeCapture } from '@variance-authority/unit-test';
import { SaveButton } from './save-button.js';

test('save button', async () => {
  const { container } = render(<SaveButton />);
  expect(container.textContent).toBe('Save');

  const artifact = await capture(container, {
    subject: 'button/save',
    viewport: {
      width: 320,
      height: 200,
      deviceScaleFactor: 1,
      colorScheme: 'light',
    },
  });

  await writeCapture('.variance/captures', artifact);
});
```

`capture(root, options)` takes any `Element` mounted in the document — Testing
Library's `container`, a node from `getByRole`, or one you built with
`document.createElement` and appended. It reads that element's document for the
stylesheets that apply to it, so an element that was never attached carries no
styling.

`writeCapture(directory, artifact)` writes one file per subject and returns its
path. Three places have to name the same directory: this test, the once-per-run
hook below, and the collector the CLI reads it through. `.variance/captures` is
spelled out in each snippet here; put it in one module and import it if you
prefer.

`viewport` is required, and is resolved here rather than by the renderer, which
never sees this DOM: media queries in the applicable CSS are evaluated against
these values and the result is written into the capture. `deviceScaleFactor`
and `colorScheme` are part of what the baseline is stored under, so changing
either moves the subject to a partition where nothing has been approved yet.

### Resources arrive as bytes or the capture fails

The capture is painted in another process with no network access, so every URL
the subtree references has to travel inside it. If the subtree references
anything — an `<img src>`, a `srcset` candidate, a `url()` in an applicable
rule, an SVG `<use href>` — and you passed no resolver, `capture` throws and
names each URL:

```
capture is not resource-closed; supply resolveResource for: /assets/logo.svg
```

Answer it with `resolveResource`, which is handed each URL and returns the
bytes. This excerpt is the `capture` call from the test above, with the resolver
added:

```ts
import { readFile } from 'node:fs/promises';

const artifact = await capture(container, {
  subject: 'button/save',
  viewport: { width: 320, height: 200, deviceScaleFactor: 1, colorScheme: 'light' },
  resolveResource: async (url) => ({
    contentType: 'image/svg+xml',
    bytes: await readFile(`public${new URL(url).pathname}`),
  }),
});
```

Return `{ absent: true }` for a URL nothing serves: a fixture pointing at a
missing image is a subject like any other, and the renderer answers the same
404. Returning `null` fails the capture, naming that one URL.

CSS is read out of the document rather than fetched, so nothing has to resolve
for it: `<style>` elements, inline `style`, and every stylesheet the document
already holds are carried.

### Every option

| option | default | what it decides |
|---|---|---|
| `subject` | required | `'button/save'`, or a full `SubjectRef` — `{ id, kind }`, where `kind` is `'story'`, `'route'`, `'fixture'` or `'value'`. A bare string becomes `kind: 'fixture'` |
| `viewport` | required | `width`, `height`, `deviceScaleFactor`, `colorScheme` |
| `engine` | the document's `navigator.userAgent` | the engine string recorded in the capture |
| `fonts` | none | the font stack this capture asserts the machine had, each as `family/weight/style/hash` |
| `features` | none | `Record<string, string>` of environment facts, folded into the capture and into media-condition resolution |
| `sourceRoot` | none | the root component paths are made relative to, so `file:line` survives the move to another machine |
| `resolveResource` | none | `(url) => bytes`, as above. Required the moment the subtree references anything |
| `provenanceOf` | none | `(node) => owners`. Attaches the component chain that rendered each node, so a difference can be named by component rather than by DOM path |
| `wiringOf` | none | `(node) => wiring`. Attaches the framework wiring a node carries — hook shape, keys, boundaries — and it is compared |
| `holdingOf` | none | `(node) => holding`. Attaches what each component boundary was handed and retained — props, contexts and hook cells, as digests. It rides beside the capture and enters no hash |
| `stabilization` | none | a digest identifying the routine you held the subject still with — pausing animations, freezing the clock — before calling. Nothing here holds anything still. Absent records that the subject was read as found, and hashes differently |

The last three callbacks are React's, and
[`@variance-authority/react`](https://variance-authority.dev/reference/packages/react)
exports all three under those names. It reads the metadata `react-dom` attached
to the mounted nodes and never imports your React copy:

```bash
npm install --save-dev @variance-authority/react
```

```ts
import { holdingOf, provenanceOf, wiringOf } from '@variance-authority/react';

const artifact = await capture(container, {
  subject: 'button/save',
  viewport: { width: 320, height: 200, deviceScaleFactor: 1, colorScheme: 'light' },
  provenanceOf,
  wiringOf,
  holdingOf,
});
```

Without them a capture carries no component names — not empty ones.

## Empty the capture directory once per run

A capture is addressed by its subject id, so two tests that both call themselves
`button/save` address one file. `writeCapture` refuses to be the second write
rather than overwriting, which also means a directory carried across two runs
fails on the second. `resetCaptures` is what gives the directory a run boundary.
Call it from a once-per-run hook — never from a test file, where it races the
other test files and deletes their captures.

```js
// variance/reset.mjs
import { resetCaptures } from '@variance-authority/unit-test';

export async function setup() {
  await resetCaptures('.variance/captures');
}
```

```js
// vitest.config.mjs
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globalSetup: ['variance/reset.mjs'] },
});
```

If your project already has a `globalSetup`, list both:
`globalSetup: ['test/global-setup.ts', 'variance/reset.mjs']`. `resetCaptures`
removes capture files, leaves everything else in the directory alone, and a
directory that does not exist yet is not an error.

## Configure the run that paints

Two files, both of which you write. The first is the collector module — the
single key through which any subject source, this one included, reaches a run:

```js
// variance/collector.mjs
import { captureCollector } from '@variance-authority/unit-test';

export default captureCollector({ directory: '.variance/captures' });
```

`directory` is its only option. Two captures under one subject id inside it are
refused by name rather than resolved last-write-wins.

The second is the run config. `@variance-authority/cli` reads
`variance.config.json` from the directory you run it in, unless you pass
`--config <path>`:

```json
{
  "project": "design-system",
  "profile": "jsdom",
  "viewport": { "width": 320, "height": 200 },
  "retention": "durable",
  "subjects": { "kind": "collector", "collector": "variance/collector.mjs" },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "report": ".variance/report.json"
}
```

Unknown keys are refused by name, and paths resolve against this file's own
directory rather than the working directory.

| key | what it decides |
|---|---|
| `project` | the label this project's rows are filed under in a shared history store |
| `profile` | what the run may claim about a change: `jsdom` is structure, ARIA and declared style, which is what a capture taken in a unit process carries; `chromium` adds computed style, layout and geometry. It does not decide what paints — Chromium paints either way. Set it to match where the capture was taken |
| `viewport` | the fallback for a subject that arrives without one. Every capture carries its own, and that is the one used for its subject |
| `retention` | `durable` compares against a stored image and requires `baselines`; `ephemeral` renders both sides inside one run, keeps neither, and requires `baselines` to be absent |
| `subjects.kind` | `collector` for a module like the one above, `storybook` for a built story index, or `list` for ids you write down |
| `baselines.kind` | `directory` for files you commit, `lfs` for the same files through the Git LFS filter, or `remote` for an HTTP endpoint — `{ "kind": "remote", "endpoint": "https://…", "token": "…" }` — with nothing in the repository, where a run that cannot reach the endpoint stops |
| `fonts` | fonts this machine asserts it has, each as `family/weight/style/hash`. Defaults to `[]`, which asserts nothing |
| `report` | where `run` writes and where `report` and `accept` read. Defaults to `.variance/report.json` |

`.variance/baselines` is what every later run compares against, so it has to be
tracked. `.variance/` also holds captures, a report and candidate images, so
ignore the contents and keep the baselines:

```gitignore
.variance/*
!.variance/baselines/
```

## Run, review, approve

```bash
npx vitest run
npx variance run
```

The suite passes as it did, having written one capture per subject. `variance
run` reads those captures, paints each in Chromium, compares, and writes the
report:

```
2 subject(s) observed, durable run at 2026-08-01T10:00:00.000Z
rendered by playwright-chromium (chromium@131, linux/x64, 1x)
1 changed, 1 unchanged

[changed] button/save: 86 pixel(s) differ across 1 region(s)

coverage: every planned subject was observed.
```

Print that again from the stored report, or write the page with the images in
it, with `variance report`:

```bash
npx variance report --format html > .variance/report.html
```

The HTML is one self-contained file that fetches nothing, so it reads the same
from your machine or a CI artifact. Each subject gives you the approved image,
the difference and the candidate, with a wipe, a blend and a blink between the
two.

A run whose observed subjects are all `unchanged` or `ignored`, with every
planned subject accounted for, exits `0`. Anything else exits `1` — including
the first run, where `button/save` is `new`: an image nobody has approved is not
a pass.

When the change is the one you meant, approve it:

```bash
npx variance accept button/save
```

`accept` takes one or more subject ids, or `--all`. It promotes the image the
run already produced and never renders one, so there is nothing to regenerate
and no reason to re-run the suite. Run `variance run` again and the subject
reports `unchanged`.

From here the loop is: change the component, run the suite, run `variance run`.

## Keep the styling a CSS-in-JS teardown removes

Capturing from a setup file runs in the outermost `afterEach` there is: every
hook the suite registered inside a `describe` has already finished. CSS-in-JS
teardown lives in exactly those inner hooks — emotion's test renderer removes
each `<style>` tag it inserted — so the page the capture reads is the page the
test built with the styling taken back off it. The class names are all still in
the markup, none of them match anything, and the baseline is a photograph of
unstyled DOM that compares equal to itself forever.

`retainStyles(document)` records style elements as they are inserted and puts
the removed ones back, in insertion order, for the length of one capture.

```js
// variance/capture-each.mjs
import { afterEach, beforeEach, expect } from 'vitest';
import { capture, retainStyles, writeCapture } from '@variance-authority/unit-test';

const VIEWPORT = { width: 320, height: 200, deviceScaleFactor: 1, colorScheme: 'light' };

let retention;

beforeEach(() => {
  retention = retainStyles(document);
});

afterEach(async () => {
  const name = expect.getState().currentTestName;
  const undo = retention.restore();
  try {
    if (name !== undefined) {
      const artifact = await capture(document.body, { subject: name, viewport: VIEWPORT });
      await writeCapture('.variance/captures', artifact);
    }
  } finally {
    undo();
    retention.stop();
  }
});
```

```js
// vitest.config.mjs
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['variance/reset.mjs'],
    setupFiles: ['variance/capture-each.mjs'],
  },
});
```

Every test in every file this setup file applies to now writes a capture, under
the test's own name as the subject id. Narrow it with a `test:` project or an
`if` on the name if that is more than you want painted.

`restore()` returns the undo; call it once the capture has read the document, so
the page is left exactly as the teardown left it. `stop()` ends the observation
for that test — the next test is entitled to a clean page. A document whose
environment has no `MutationObserver` retains nothing, and the capture is then
exactly as good as it was without this.

Read the stylesheets a capture carried, once, after wiring this up. A subject
with none is the symptom, and it is invisible in every verdict a run can
produce:

```js
import { captureFiles, readCapture } from '@variance-authority/unit-test';

for (const path of await captureFiles('.variance/captures')) {
  const artifact = await readCapture(path);
  console.log(artifact.subject.id, artifact.material.document.css.length);
}
```

## Capture from inside a browser tab

`capture` is published on its own as
`@variance-authority/unit-test/capture`, carrying nothing that touches a
filesystem. `@variance-authority/vitest-browser` imports that entrypoint from
inside the browser tab the test runs in and sends the artifact out to be
rendered. Everything else on this page is the Node half and stays on the default
entrypoint.

## Snapshot a value

Not every public surface is a page. An API response, a generated OpenAPI
document, a GraphQL schema, a route table and a build manifest are all things a
change can break, and none of them needs a DOM.

```ts
import { test } from 'vitest';
import { snapshotValue } from '@variance-authority/unit-test';

test('the health endpoint', async () => {
  const response = await fetch('http://localhost:3000/health');

  await snapshotValue(await response.json(), {
    subject: 'api/health',
    directory: '.variance/values',
    drop: ['/uptimeSeconds'],
  });
});
```

| option | default | what it decides |
|---|---|---|
| `subject` | required | `'api/health'`, or a full `SubjectRef`. A bare string becomes `kind: 'value'` |
| `directory` | required | where the capture is written |
| `dialect` | `'json'` | how the text is read later. A reader for a dialect it does not know still compares the value |
| `drop` | none | JSON Pointers whose value is volatile. Recorded as present, never compared |
| `replace` | none | JSON Pointers whose value becomes a token you choose, so the shape stays readable |
| `arrayKey` | none | for an array of records, the member that identifies a row: `{ '/rows': 'id' }` |
| `generator` | none | `{ name, version }` of what emitted the value |

Set `arrayKey` for any array of records. Without it an array is compared by
index, so a row inserted at the top reports every row after it as changed
instead of reporting the one insertion.

The value is serialized here, in the unit process, into canonical text: keys
sorted, numbers written portably, `undefined` members omitted. Two processes
that built the same response in a different order produce the same record.
`snapshotValue` throws on a value that cannot be one — a function, a `Date`, a
`bigint` or a non-finite number — naming the JSON Pointer where it was found.

Write value captures to a directory of their own, as above. `captureCollector`
compares rendered documents, and a value capture in its directory is refused by
name: `api/health is a value capture, and this run compares rendered
documents`.

---

**[@variance-authority/unit-test](https://variance-authority.dev/reference/packages/unit-test)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
