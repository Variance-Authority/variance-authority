# @variance-authority/playwright

**Requires:** a browser **binary** on the machine, which an install does not give
you:

```bash
npx playwright install chromium
```

This is the only box in the repository that will ever ask you to install a
browser. Everything downstream of a render — comparison, isolation, attribution,
storage — sits elsewhere and stays reachable without one.

Two tools live here, and they are separate tools that happen to share that
requirement.

## Entrypoints

| entrypoint | holds | note |
|---|---|---|
| `.` | both tools | needs `playwright` |
| `playwright/renderer` | `createPlaywrightRenderer` | the renderer alone, without the harness |
| `playwright/agent` | `PageAgent`, `CaptureRequest`, `AGENT_GLOBAL` | **must not** need `playwright` — it is bundled into the page |

`playwright/agent` is the reason there are entrypoints at all. It is the page-side half,
injected into the browser as a classic script, and importing Playwright behind it
would put a node module in a bundle destined for a page.

## The harness: one Chromium, one page, one navigation

**7.5 ms per warm capture against 205 ms cold — 27×.** That ratio is the whole
argument for persistence, and it is why the `chromium` semantic tier is affordable
at all.

```ts
import { createHarness } from '@variance-authority/playwright';

const harness = await createHarness({
  url: 'file:///…/fixture.html',
  bundle: iifeBundleInstallingYourAgent,
  viewport: { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' },
});

const capture = await harness.capture('story:button--primary', 'after');
await harness.close();
```

The harness carries **no knowledge of subjects, stories or frameworks**. The page
bundle supplies all of that through `PageAgent`, so the same harness serves a
fixture page, a Storybook, or a route. The agent owns subject teardown, because
the harness cannot: it does not know what the previous subject installed.

`capture` is sequential by contract. Two concurrent calls would render two
subjects into one document and let one decide the other's verdict.

## The renderer: a document in, a raster out

```ts
import { createPlaywrightRenderer } from '@variance-authority/playwright';

const renderer = await createPlaywrightRenderer({ viewport });
const raster = await renderer.render(document);
```

It satisfies the `Renderer` contract from
[`@variance-authority/raster`](../raster) — the same one a renderer across a
network satisfies, which is what makes offloading a wiring decision made once at
the top rather than a rewrite.

It applies the stabilization recipe it is given, and reports conflicts rather
than resolving them.

## A page error is a finding, not a mystery

A bundle that throws leaves the agent global undefined, and the failure would
otherwise surface as a timeout with no cause. Page-side errors are recorded and
reported, so `React is not defined` reads as `React is not defined`.

## Reading

- [ADR-0002](../../docs/context/adr/0002-observation-profiles.md) — the two rendering surfaces
- [journal 0007](../../docs/context/journal/0007-persistent-harness-and-p4.md) — the 27×, and how to reproduce it
