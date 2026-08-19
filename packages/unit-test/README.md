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

## Render later

Point the normal CLI collector setting at a module exporting the artifact
collector:

```ts
import { captureCollector } from '@variance-authority/unit-test';

export default captureCollector({ directory: '.variance/captures' });
```

`variance run` reads those captures and uses its configured local or remote
renderer, baseline store, comparison policy, and report. Use a fresh capture
directory per run; the runner still owns test selection and retry lifecycle.

See [`docs/surface.md`](../../docs/surface.md) for how this deferred-document
route composes with in-place browser capture and the Storybook collector.
