# Observe a component from a Vitest browser-mode test

Use the component test that already mounts the state in a real browser. [Variance
Authority](README.md) reads that mount where it stands — inside the tester
iframe — and judges it in the Vitest process, which is the side that holds the
baseline and can paint. Nothing about your runner, provider, mount library or
assertions changes.

## Before you observe

Browser mode must already be running your component tests, and the locator you
would normally assert on must already resolve. Give the subject an id that
survives a test-title change once the test earns a long life; until then the
test's own name is the id.

Install the integration and the Chromium binary that paints the baseline:

```bash
npm install --save-dev @variance-authority/vitest-browser vitest-browser-react
npx playwright install chromium
```

Two browsers are in play. The one your provider mounts components in is not the
one that paints a baseline: a live screenshot carries no render identity, so a
baseline made from one is reproducible on no other machine, starting with the CI
runner that judges it next.

## Register the command

A test body in browser mode runs in a tab, and a tab has neither the baseline nor
a browser to paint with. Vitest's command protocol carries the artifact out, and
the plugin is what registers it.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { variancePlugin } from '@variance-authority/vitest-browser/node';

export default defineConfig({
  plugins: [react(), variancePlugin({ baselines: '.variance/baselines' })],
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
    },
  },
});
```

## Add the observation

```tsx
import { render } from 'vitest-browser-react';
import { expect, test } from 'vitest';
import { assertUnchanged, variance } from '@variance-authority/vitest-browser';

test('save button, disabled', async () => {
  const screen = render(<SaveButton disabled />);
  await expect.element(screen.getByRole('button')).toBeVisible();

  assertUnchanged(await variance(screen.container));
});
```

`variance` returns the observation; `assertUnchanged` is the decision. Read the
verdict yourself when the test wants to branch on it, and pass `subjectId` when
the baseline should outlive the test's current name.

## Run the first review loop

```bash
npx vitest run
```

The first run has nothing to compare against, so the subject reports `new` and
the assertion fails with the candidate named. Approve it the way you approve the
snapshots in the same suite:

```bash
npx vitest run -u
```

That promotes the image this run already painted — not a fresh one — so the
bytes that became the baseline are the bytes the run produced. Run the suite
again and the subject reports `unchanged`.

## What stays with the host

The runner, the provider, the mount library, the locators and the assertions are
yours, and this path exports no `test` and no `expect`. What it adds is one
reading of the mount: markup, the CSS that applies to it, component provenance,
framework wiring, and the bytes of every resource the subtree references, fetched
with the page's own `fetch` against the server that served them.

Media queries resolve against the tester iframe rather than the browser tab,
because that is the frame the component was laid out in.

A subject still showing a Suspense fallback is refused rather than captured: the
locator assertion above it passes against a skeleton, and a baseline taken over
one turns every faster machine into a regression. When the skeleton is the
subject, declare it with `loading: true`.

## Go deeper

Read [composition](composition.md) when this result joins a reading made by
another host, or [placement](placement.md) when the baseline lives somewhere
other than a directory beside the suite. The
[`@variance-authority/vitest-browser` reference](../packages/vitest-browser/README.md)
owns the option tables, the acceptance rule, and the split between the two
halves. When the same components are tested under jsdom instead, [start with
`@variance-authority/unit-test`](start-unit.md).
