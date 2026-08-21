# `@variance-authority/unit-test`

Capture a mounted DOM subject in a browserless Jest or Vitest process, then let
`variance run` render and observe that artifact in a later process. The package
does not export `test`, `expect`, a reporter, or a browser.

**Requires:** a live DOM and a writable artifact directory. External resources
must be supplied as immutable bytes; capture refuses a document it cannot close
over rather than calling a hash-only payload portable.

## Capture in the existing unit test

```ts
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
there and cannot say why. Refusing here costs one test failure; the alternative
costs a report nobody can act on.

`writeCapture(directory, artifact)` writes one versioned file per subject;
`readCapture` and `captureFiles` are the read half, and `CAPTURE_SUFFIX` is what
they match on.

## Snapshot a value that was never rendered

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

`arrayKey` is the option that decides whether the report is worth reading. An
array compared by index says two thousand rows changed when one row was
inserted at the top; compared by what identifies a row it says one row was
added, and the same edit made to two different rows carries one identity — so a
recurring change is countable rather than two thousand fresh ones.

The value is serialized here, in the unit process, into canonical text: keys
sorted, numbers written portably, `undefined` members omitted. That text is what
is addressed and what a later run compares, so two processes that built the same
response in a different order produce the same record.

Like `capture`, `snapshotValue` writes and does not compare — the baseline is
not in this process, and the verdict belongs to `variance run`. It throws only
on a value that cannot be one: a function, a `Date`, a `bigint` or a non-finite
number, naming the JSON Pointer where it was found. Dropping it silently would
put a key in the baseline that a later run reads as removed.

See [spec 0031](../../docs/specs/0031-a-contract-is-a-subject.md) for how a
value subject reaches one docket, one comment and one exit code alongside the
rendered ones.

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

`variance run` reads those captures and uses its configured local or remote
renderer, baseline store, comparison policy, and report. Use a fresh capture
directory per run; the runner still owns test selection and retry lifecycle.

See [`docs/surface.md`](../../docs/surface.md) for how this deferred-document
route composes with in-place browser capture and the Storybook collector.
