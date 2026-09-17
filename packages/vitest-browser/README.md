<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/vitest-browser

> Observe a component against its baseline from inside a Vitest browser-mode test, without leaving the test body.

A component test in browser mode has already done the expensive part. It mounted
the component in a real engine, with the real stylesheets, and the locator it
awaited is the proof that the thing arrived. This package adds one line to that
test: read the mounted subject, compare it against the baseline a human
approved, and answer.

A **subject** is what the test observes — the element `render()` returned, or a
locator resolving to one — addressed by an id that defaults to the test's own
name. A **baseline** is the last image of that subject somebody approved.

```bash
npm install --save-dev @variance-authority/vitest-browser vitest-browser-react
npx playwright install chromium
```

Playwright's browser binaries do not arrive with an `npm install`, and two
different browsers are in play here: the one the suite mounts components in, and
the one this package paints the baseline image with. The second is why the
install above is not only the suite's own.

## Register the command, then observe

Browser mode puts the test body in a tab, and a tab has neither the baseline nor
a browser to paint with. Vitest's command protocol is the way across, so the
plugin is not optional decoration — it is the other half.

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

```ts
import { render } from 'vitest-browser-react';
import { expect, test } from 'vitest';
import { assertUnchanged, variance } from '@variance-authority/vitest-browser';

test('the save button, disabled', async () => {
  const screen = render(<SaveButton disabled />);
  await expect.element(screen.getByRole('button')).toBeVisible();

  assertUnchanged(await variance(screen.container));
});
```

`variance(subject, options)` returns the observation rather than throwing on it,
so a test may read the verdict before deciding what it means. `assertUnchanged`
is the usual decision — it throws the sentence the run would have printed — and
`toBeUnchanged` is the same decision as a matcher, for a suite that composes its
own `expect`.

| option | default | what it decides |
|---|---|---|
| `subjectId` | the running test's full name | what the baseline is stored under. Renaming a test orphans its baseline, which reports as `new` rather than comparing against something else |
| `subjectKind` | `'fixture'` | what produced the subject, recorded rather than guessed |
| `fonts` | none | the font stack this machine is asserted to have, as `family/weight/style/hash` |
| `features` | none | environment facts folded into the capture and into media-condition resolution |
| `sourceRoot` | none | the root component paths are made relative to, so `file:line` survives the trip to another machine |
| `suspenseTimeoutMs` | 5000 | how long to wait for the subject's Suspense boundaries before refusing |
| `loading` | `false` | this subject's *loading* state is the thing being captured |
| `wiring` | `true` | read each node's framework wiring — hook count, keys, boundaries — as part of the compared identity |
| `holdings` | `false` | read what each boundary was handed and retained, as digests beside the snapshot |
| `sensitivity` | none | how much of this subject is asserted on, when it has been relaxed |

## What the two halves each do

The tab reads the subject: markup, the CSS that applies to it, the component
chain behind each node, and the bytes of every resource it references, fetched
with the page's own `fetch` against the dev server that served them. Media
queries are resolved against the **tester iframe**, not the browser tab, because
that is the frame the subject was laid out in.

`@variance-authority/vitest-browser/node` is the other half, and the entrypoint
the Vitest config imports. It holds the baseline store and one browser for the
whole run, and it paints the captured document rather than screenshotting the
tab. A live screenshot has nothing behind it that can say which machine, which
scale and which font stack produced it, so its baseline is reproducible nowhere
else — including on the CI runner that judges it next.

`variancePlugin(options)` is that half as a Vite plugin: it registers the command
and closes the browser when the run ends. `varianceCommands(options)` is the same
thing unwrapped, for a config that already builds its own command map and wants
to own when the browser closes.

| option | default | what it decides |
|---|---|---|
| `baselines` | `.variance/baselines` | the directory baselines are stored in |
| `store` | a durable store on `baselines` | an existing store, when baselines do not live in a directory |
| `renderer` | a Playwright renderer opened on first use | an existing renderer, whose lifetime then stays the caller's |
| `accept` | Vitest's own `--update` | whether this run may promote a candidate to a baseline |

Acceptance promotes the image the run already painted, out of its render cache.
Painting a second one here would mean the bytes a reviewer approved and the bytes
that became the baseline were two different paints.

## A subject that had not arrived yet

A subject still showing a Suspense fallback is refused, not captured. The locator
assertion above it passes against a skeleton, so a baseline taken over one turns
every faster machine into a regression — and the refusal names the boundary and
the component holding it rather than a timeout.

When the skeleton *is* the subject, say so with `loading: true`. That declaration
is symmetric: a subject declared loading that then settles is refused too, since
a declaration nobody deleted records whichever state the weather produced.

Animation, caret blink, scroll position and the rest are held still before the
read, and what held them is recorded in the capture, so two runs that stabilized
differently are not silently compared.
