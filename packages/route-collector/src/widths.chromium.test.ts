import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routeCollector, type Collector, type Plan } from './index.js';

/**
 * One page, several widths — the shape every Percy suite is written in.
 *
 * The claim under test is not that a number changed. It is that the page was
 * **actually laid out** at each width: a collector that recorded the requested
 * viewport while painting at the run's would produce three baselines of one
 * picture, each carrying an environment key describing a render that never
 * happened. That failure is invisible in a report — three green subjects — which
 * is why it is asserted against a page whose content depends on a media query.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

/**
 * A page that says which layout it is in, in the DOM rather than in a style.
 *
 * A media query that only changed a colour would be invisible to the document
 * comparison and would let a broken resize pass. `matchMedia` written into the
 * markup on load is the strongest available check: it is decided once, when the
 * page loads, so a run that resized without re-navigating reads the *old*
 * answer — which is exactly the mistake this collector is written to avoid.
 */
const PAGE = `<!doctype html><html><head><style>
  .wide { display: none }
  @media (min-width: 900px) { .narrow { display: none } .wide { display: block } }
</style></head><body><main id="app">
  <p class="narrow">narrow layout</p>
  <p class="wide">wide layout</p>
  <p data-testid="matched"></p>
  <script>
    document.querySelector('[data-testid="matched"]').textContent =
      window.matchMedia('(min-width: 900px)').matches ? 'matched:wide' : 'matched:narrow';
  </script>
</main></body></html>`;

let server: Server | undefined;
let base = '';
let collector: Collector | undefined;

const PLAN: Plan = {
  subjects: [{ subject: { id: 'page/home', kind: 'route' } }],
  notObserved: [],
  warnings: [],
};

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
  });

  const port = await new Promise<number>((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      resolve(address === null || typeof address === 'string' ? 0 : address.port);
    });
  });
  base = `http://127.0.0.1:${port}`;

  collector = await routeCollector({
    routes: { 'page/home': `${base}/` },
    roots: ['#app'],
    widths: [375, 1280],
  })({
    config: {
      viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
    },
    plan: PLAN,
  });
}, 120_000);

afterAll(async () => {
  await collector?.close();
  server?.closeAllConnections();
  if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/route-collector (widths): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

chromium_('one route at several widths', () => {
  it('plans a subject per width, with the width in the id', async () => {
    // A suffix rather than a field: the id is what a baseline is stored under,
    // what a report line names, and what `--subjects` selects — so two widths
    // have to be two ids or they are one baseline overwriting itself.
    const plan = await collector!.plan();

    expect(plan.subjects.map((planned) => planned.subject.id)).toEqual([
      'page/home@375',
      'page/home@1280',
    ]);
    expect(plan.subjects.map((planned) => planned.viewport?.width)).toEqual([375, 1280]);
    // The height is the run's. A viewport height bounds nothing when the subject
    // is the page.
    expect(plan.subjects[0]?.viewport?.height).toBe(600);
  });

  it('lays the page out at each width rather than recording that it did', async () => {
    // The failure this is written against: three baselines of one picture, each
    // carrying a key that describes a render that never happened. Three green
    // subjects, and nothing anywhere to notice.
    const plan = await collector!.plan();

    const narrow = await collector!.collect(plan.subjects[0]!);
    const wide = await collector!.collect(plan.subjects[1]!);

    expect(narrow.ok && wide.ok).toBe(true);
    if (!narrow.ok || !wide.ok) return;

    expect(narrow.document.viewport.width).toBe(375);
    expect(wide.document.viewport.width).toBe(1280);
    // Different documents, because the page really did lay out differently.
    expect(narrow.document.html).not.toBe(wide.document.html);
  }, 120_000);

  it('re-navigates on a resize, so a media query decided at load is decided again', async () => {
    // A reflow is not a reload. A component that read `matchMedia` when it
    // mounted keeps its first answer through a resize, so a page reached by
    // widening a narrow one is not the page a visitor at that width gets — and
    // the difference does not show up in the result.
    const plan = await collector!.plan();

    const narrow = await collector!.collect(plan.subjects[0]!);
    const wide = await collector!.collect(plan.subjects[1]!);

    expect(narrow.ok && wide.ok).toBe(true);
    if (!narrow.ok || !wide.ok) return;

    expect(narrow.document.html).toContain('matched:narrow');
    expect(wide.document.html).toContain('matched:wide');
  }, 120_000);

  it('refuses a subject whose scale factor the open browser cannot have', async () => {
    // A context's scale factor is fixed when it is created. Painting at the run's
    // while recording the subject's would put a lie in the environment key, which
    // is the field every comparability decision rests on.
    const refused = await collector!.collect({
      subject: { id: 'page/home@375', kind: 'route' },
      viewport: { width: 375, height: 600, deviceScaleFactor: 2, colorScheme: 'light' },
    });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.because).toContain('deviceScaleFactor 2');
    expect(refused.because).toContain('run it as its own run');
  }, 60_000);
});
