<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/unit-test

> Capture a mounted DOM subject in a browserless Jest or Vitest process, then render and observe it later.

**Variance Authority** is a visual regression toolkit for web interfaces: it
compares a rendered subject against an approved baseline and reports which
component caused each change. This package is one piece of it.

Capture a mounted DOM subject in a browserless Jest or Vitest process, then let
`variance run` render and observe that artifact in a later process. The package
does not export `test`, `expect`, a reporter, or a browser.

A subject is the thing captured for comparison: a mounted DOM subtree here, or
— for `snapshotValue` below — a plain value. Each one is identified by a
`SubjectRef`: an id plus a `kind` recording what produced it (`'story'`,
`'route'`, `'fixture'`, or `'value'`), not what it looks like.

**Requires:** a live DOM and a writable artifact directory. External resources
must be supplied as immutable bytes: capture closes over the document by
resolving every resource it references into bytes the artifact carries, and
refuses to write a capture it cannot close this way.

Browserless describes this half. The capture carries markup, CSS and resources —
not pixels — so the later `variance run` opens a browser to paint it and refuses
the run if it cannot.

Install the package and the DOM environment used by the test runner:

```bash
npm install --save-dev @variance-authority/unit-test jsdom
```

The render half is a separate process and a separate install, in the job that
paints:

```bash
npm install --save-dev @variance-authority/cli
npx playwright install chromium
```

Vitest needs `// @vitest-environment jsdom` (or an equivalent project setting).
Jest needs its normal `jsdom` test environment. This package does not configure
either runner.

## Capture in the existing unit test

```ts
// @vitest-environment jsdom
import { test, expect } from 'vitest';
import { capture, writeCapture } from '@variance-authority/unit-test';

test('save button', async () => {
  const button = document.createElement('button');
  button.textContent = 'Save';
  document.body.append(button);

  const artifact = await capture(button, {
    subject: 'button/save',
    viewport: {
      width: 320,
      height: 200,
      deviceScaleFactor: 1,
      colorScheme: 'light',
    },
  });

  await writeCapture('.variance/captures', artifact);
  expect(button.textContent).toBe('Save');
});
```

This process acquires markup, applicable CSS, semantic evidence, and resources.
It does not produce a screenshot or visual verdict.

`capture(root, options)` takes:

| option | default | what it decides |
|---|---|---|
| `subject` | required | `'button/save'`, or a full `SubjectRef`. A bare string becomes `kind: 'fixture'` |
| `viewport` | required | width, height, scale, colour scheme. Media queries are resolved against it here, in the unit process, because the later renderer never sees this DOM |
| `engine` | the DOM's own user agent | what painted, as it lands in the identity |
| `fonts` | none | the font stack this capture is asserted to have, as `family/weight/style/hash` |
| `features` | none | environment facts folded into the capture and into media-condition resolution |
| `sourceRoot` | none | the root component paths are made relative to, so `file:line` survives the move to another machine |
| `resolveResource` | none | `(url) => bytes`. **Required the moment the subtree references anything**: a subtree with resources and no resolver throws at capture, naming every URL it would have had to guess at, and a resolver returning `null` for one of them throws naming that one |

`resolveResource` is the whole of the requirement above. A capture is rendered in
another process — possibly on another machine, possibly hours later — so a
document that carries digests and no bytes is a document that paints holes over
there and cannot say why.

`writeCapture(directory, artifact)` writes one versioned file per subject;
`readCapture` and `captureFiles` are the read half, and `CAPTURE_SUFFIX` is what
they match on.

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
    directory: '.variance/captures',
    drop: ['/uptimeSeconds'],
  });
});
```

`snapshotValue(value, options)` takes:

| option | default | what it decides |
|---|---|---|
| `subject` | required | `'api/health'`, or a full `SubjectRef`. A bare string becomes `kind: 'value'` |
| `directory` | required | where the capture is written; one fresh directory per run, as above |
| `dialect` | `'json'` | how the text is read later. A reader for a dialect it does not know still compares the value |
| `drop` | none | JSON Pointers whose value is volatile. Recorded as present, never compared |
| `replace` | none | JSON Pointers whose value becomes a token you choose, so the shape stays readable |
| `arrayKey` | none | for an array of records, the member that identifies a row: `{ '/rows': 'id' }` |
| `generator` | none | what emitted the value, when something did |

Set `arrayKey` for any array of records. Without it, an array is compared by
index, so a row inserted at the top reports every row after it as changed
instead of reporting the one insertion.

The value is serialized here, in the unit process, into canonical text: keys
sorted, numbers written portably, `undefined` members omitted. That text is what
is addressed and what a later run compares, so two processes that built the same
response in a different order produce the same record.

Like `capture`, `snapshotValue` writes and does not compare — the baseline is
not in this process, and the verdict belongs to `variance run`. It throws only
on a value that cannot be one: a function, a `Date`, a `bigint` or a non-finite
number, naming the JSON Pointer where it was found. Dropping it silently would
put a key in the baseline that a later run reads as removed.

`captureCollector` accepts document captures for the normal `variance run` path.
If its directory contains a value capture, collection
reports that the material is a value capture while the run compares rendered
documents; it does not turn that refusal into an unchanged result. The
value-writing API is therefore usable independently, but the CLI/raster path
does not compare value artifacts.

## Render later

Point the normal CLI collector setting at a module exporting the artifact
collector:

```ts
import { captureCollector } from '@variance-authority/unit-test';

export default captureCollector({ directory: '.variance/captures' });
```

`directory` is the only option, and duplicate subject ids inside it are an error
rather than a last-write-wins: two tests writing `button/save` is a name
collision, and picking one silently makes half the suite invisible.

Name that module as the collector, and set `profile` to the observation tier
the capture was taken in — `"jsdom"` here, or `"chromium"` for a
browser-based collector:

```json
{
  "project": "design-system",
  "profile": "jsdom",
  "viewport": { "width": 320, "height": 200 },
  "retention": "durable",
  "subjects": { "kind": "collector", "collector": "variance/collector.mjs" },
  "baselines": { "kind": "directory", "root": "baselines" },
  "report": "out/report.json"
}
```

`retention` is `"durable"` (compare against a stored baseline — `baselines` is
then required) or `"ephemeral"` (nothing is stored, and `baselines` must be
absent). `subjects.kind` says where the run gets its subject list:
`"collector"` (a module like the one above), `"storybook"`, or `"list"`.
`baselines.kind` says where the stored baseline lives: `"directory"`, `"lfs"`,
or `"remote"`.

```bash
npx variance run
```

`variance run` is the command `@variance-authority/cli` installs as `variance`.
It reads the document captures this package wrote, renders each one with the
configured renderer, compares it against the configured baseline, and writes
the report.

`profile: "jsdom"` says what observed the subject, not what paints it: the
capture has no layout engine behind it, so every changed region in the report
is reported unattributed rather than joined to a guessed node — the render
itself is still Chromium.

A run that finds nothing to review exits 0. The first run against baselines
that don't exist yet has nothing to compare against, so it exits 1 for review
rather than a pass. Use a fresh capture directory per run; the runner still
owns test selection and retry lifecycle.
