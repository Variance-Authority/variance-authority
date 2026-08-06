import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routeCollector, type Collector, type Collected, type Plan } from './index.js';

/**
 * The animation flake, reproduced and then closed — against a real clock.
 *
 * Every other measurement of instability in this repository *simulates* its
 * cause: a smoothing mode standing in for a GPU driver, a second browser context
 * standing in for a second runner. This one does not. The page below runs an
 * infinite CSS animation on a real compositor, and the two collections are taken
 * at two genuinely different moments — so the failure it demonstrates is the
 * failure an adopter gets on their first run, not an argument about one.
 *
 * ## What was wrong
 *
 * `ruleset.ts` excludes `animation-*` and `transition-*` from the allowlist,
 * with a stated reason: a snapshot is taken "at a declared settle point with
 * animation disabled", so those properties describe a journey the snapshot does
 * not contain. Nothing disabled it. `transform` and `opacity` *are* admitted, so
 * the journey arrived anyway — as a change, with a component's name and a source
 * file attached, on a commit where nobody edited anything.
 *
 * ## What is asserted
 *
 * Both halves, because only the pair is evidence. A run that shows stability
 * *with* the recipe proves nothing on its own — a page that never moved would
 * pass it too. So the first case demands that the unstabilized arm actually
 * flake, and the whole suite fails if the reproduction stops reproducing.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/route-collector (stabilization): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

/**
 * A four-second loop, sampled twice about a second apart.
 *
 * Long and slow on purpose. A fast animation can alias — two samples a whole
 * number of periods apart read the same frame — and a flake that reproduces
 * *sometimes* is a test that fails sometimes, which is the genre of test this
 * project exists to argue against.
 *
 * `linear` for the same reason: an eased curve is nearly flat at both ends, so
 * two samples that happen to land there differ by less than a rounded pixel.
 */
const ANIMATED_PAGE = `<!doctype html><html><head><style>
  @keyframes drift {
    from { transform: translateX(0px);   opacity: 1;   }
    to   { transform: translateX(400px); opacity: 0.2; }
  }
  #mover { animation: drift 4s linear infinite alternate; width: 60px; height: 60px; background: #333; }
</style></head><body><main id="app">
  <section data-testid="panel"><div id="mover"></div></section>
</main></body></html>`;

let server: Server | undefined;
let base = '';

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(ANIMATED_PAGE);
  });

  const port = await new Promise<number>((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      resolve(address === null || typeof address === 'string' ? 0 : address.port);
    });
  });
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

const PLAN: Plan = {
  subjects: [{ subject: { id: 'page/animated', kind: 'route' } }],
  notObserved: [],
  warnings: [],
};

/**
 * Two collections of one unchanging page, a second apart.
 *
 * **One page, read twice — not two page loads.** The first draft of this used a
 * fresh collector per reading and did not reproduce anything, for a reason worth
 * recording: an animation's phase is measured from the navigation that started
 * it, so two identical loads collected after two identical delays land on the
 * *same* frame. What varies in the field is the gap between the page starting
 * and the subject being read — a slow ready selector, a busy runner, a session
 * that collected nine other subjects first — and reading one live page at two
 * moments is that variance, reproduced rather than argued about.
 *
 * It is also the arrangement a Storybook run is always in: one navigation, N
 * subjects, each read whenever its turn comes.
 */
async function collectTwice(stabilize?: readonly string[]): Promise<readonly Collected[]> {
  const collector: Collector = await (
    await routeCollector({
      routes: { 'page/animated': `${base}/animated` },
      roots: ['#app'],
      ...(stabilize !== undefined ? { stabilize } : {}),
    })
  )({
    config: {
      viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
      fonts: [],
    },
    plan: PLAN,
  });

  try {
    const first = await collector.collect(PLAN.subjects[0]!);

    // Slightly over a quarter of the period, so the second sample lands
    // somewhere the first was not, whatever phase the first caught.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    return [first, await collector.collect(PLAN.subjects[0]!)];
  } finally {
    await collector.close();
  }
}

function hashesOf(readings: readonly Collected[]): readonly string[] {
  return readings.map((reading) => {
    if (!reading.ok) throw new Error(`collection failed: ${reading.because}`);
    if (reading.snapshot === undefined) throw new Error('no snapshot in a successful collection');
    return reading.snapshot.renderHash;
  });
}

describe.skipIf(!BROWSER_AVAILABLE)('an animation in flight, observed twice', () => {
  it('moves the render hash when the page is observed untouched', async () => {
    const [first, second] = hashesOf(await collectTwice([]));

    // The reproduction. If this ever passes, the rest of this file is asserting
    // that a stationary page stays stationary, and the fix it guards has
    // silently stopped being needed for a reason nobody wrote down.
    expect(first).not.toBe(second);
  }, 60_000);

  it('holds still under the default collection recipe', async () => {
    const [first, second] = hashesOf(await collectTwice());

    expect(first).toBe(second);
  }, 60_000);

  it('records the recipe in the environment, so the two are not compared', async () => {
    const [held] = await collectTwice();
    const [untouched] = await collectTwice([]);

    if (!held?.ok || !untouched?.ok) throw new Error('collection failed');

    // The other half of the fix, and the half that matters on the day somebody
    // turns the recipe off. Without this field the two runs above are one
    // baseline and their disagreement is a change with a component's name on it;
    // with it they are two baselines that never meet.
    expect(held.snapshot?.environment.inputs.stabilization).toBeDefined();
    expect(untouched.snapshot?.environment.inputs.stabilization).toBeUndefined();
    expect(held.snapshot?.environment.semanticDigest).not.toBe(
      untouched.snapshot?.environment.semanticDigest,
    );
  }, 60_000);

  it('leaves no trace of itself in the subject', async () => {
    const [held] = await collectTwice();
    if (!held?.ok) throw new Error('collection failed');

    // The injected sheet is `*, *::before, *::after`. If it were collected like
    // any other stylesheet it would attach a matched rule to every node in every
    // subject and put declarations nobody wrote into the attribution of a
    // component that did not write them.
    const style = JSON.stringify(held.snapshot?.root ?? {});
    expect(style).not.toContain('animation-play-state');
    expect(style).not.toContain('scroll-behavior');
  }, 60_000);
});
