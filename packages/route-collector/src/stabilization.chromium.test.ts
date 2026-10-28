import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';
import { DEFAULT_STABILIZE, routeCollector, type Collector, type Collected, type Plan } from './index.js';

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

/**
 * A web font the page asks for after `load`, served by a route that never answers.
 *
 * After `load` because a font the parser meets holds `load` itself, and the
 * navigation's own timeout then refuses the route. One applied by a script is
 * what a component mounted late looks like, and it reaches `fonts.ready` with
 * the request still open. A second is declared in a sheet the page imports.
 */
const LATE_FONT_PAGE = `<!doctype html><html><head><style>
  @import url(/faces.css);
  @font-face { font-family: Stalled; src: url(/stalled.woff2) format('woff2'); }
  .mounted p { font-family: Stalled, sans-serif; }
  .mounted span { font-family: Imported, sans-serif; }
</style></head><body><main id="app"><p>Hello</p><span>there</span></main>
<script>addEventListener('load', () => document.body.classList.add('mounted'));</script>
</body></html>`;
const FACES = "@font-face { font-family: Imported; src: url(/imported.woff2) format('woff2'); }";

/**
 * The same four-second loop, driven from script and only for a visitor who did
 * not ask for reduced motion — the branch a motion library takes.
 */
const MOTION_PAGE = `<!doctype html><html><head><style>
  #mover { width: 60px; height: 60px; background: #333; }
</style></head><body><main id="app">
  <section data-testid="panel"><div id="mover"></div></section>
</main><script>
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.getElementById('mover').animate(
      [{ transform: 'translateX(0px)', opacity: 1 }, { transform: 'translateX(400px)', opacity: 0.2 }],
      { duration: 4000, iterations: Infinity, direction: 'alternate', easing: 'linear' },
    );
  }
</script></body></html>`;

/**
 * A page that prints the wall clock, and a timer it waits on before it is ready.
 *
 * The timer is the other half of the claim: a clock that answers one instant
 * by stopping time altogether would hold `new Date()` and never mark the page
 * ready, and the route would be refused for a wait rather than read.
 */
const CLOCK_PAGE = `<!doctype html><html><head></head><body><main id="app">
  <p id="now"></p>
</main><script>
  document.getElementById('now').textContent = new Date().toISOString();
  setTimeout(() => document.getElementById('app').dataset.ticked = '', 50);
</script></body></html>`;

/**
 * One field, focused by the page itself under one address and not the other.
 *
 * The markup is the same under both, so the only difference between the two
 * readings is the focus the script took.
 */
const FOCUS_PAGE = `<!doctype html><html><head><style>
  input { outline: none; border: 1px solid gray; }
  input:focus { outline: 4px solid rgb(0, 0, 200); }
</style></head><body><main id="app"><input value="search"></main><script>
  if (location.pathname === '/focused') document.querySelector('input').focus();
  document.getElementById('app').dataset.ticked = '';
</script></body></html>`;

/**
 * One box sized by the motion preference, with the `no-preference` rule last.
 *
 * Read with the preference unknown, both blocks apply and the later one wins,
 * so the record would describe a box the emulated browser never drew.
 */
const PREFERENCE_PAGE = `<!doctype html><html><head><style>
  #box { width: 60px; height: 60px; background: #333; }
  @media (prefers-reduced-motion: reduce) { #box { width: 100px; } }
  @media (prefers-reduced-motion: no-preference) { #box { width: 200px; } }
</style></head><body><main id="app" data-ticked><div id="box"></div></main></body></html>`;

let server: Server | undefined;
let base = '';

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((request, response) => {
    if (request.url?.endsWith('.woff2')) return;
    if (request.url === '/faces.css') return void response.end(FACES);
    const page =
      request.url === '/motion'
        ? MOTION_PAGE
        : request.url === '/preference'
          ? PREFERENCE_PAGE
          : request.url === '/clock'
            ? CLOCK_PAGE
            : request.url === '/focused' || request.url === '/unfocused'
              ? FOCUS_PAGE
              : request.url === '/late-font'
                ? LATE_FONT_PAGE
                : ANIMATED_PAGE;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
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
  server?.closeAllConnections();
  if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

/** Collections per timing arm. Enough to average out a stray GC pause. */
const SAMPLES = 12;

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
async function collectTwice(
  stabilize?: readonly string[],
  path = '/animated',
): Promise<readonly Collected[]> {
  const collector: Collector = await (
    await routeCollector({
      routes: { 'page/animated': `${base}${path}` },
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

  it('costs what it is worth, per subject, and says so', async () => {
    // The other half of a stabilization claim, and the one nobody publishes.
    // Holding a page still is only free if you do not measure it: the recipe
    // injects a sheet, awaits fonts and images, and waits two frames for the
    // pinned state to be in force. Every one of those is per subject unless
    // something makes it not be.
    const arms: Record<string, number> = {};

    for (const [label, stabilize] of [
      ['untouched', [] as readonly string[]],
      ['held still', undefined],
    ] as const) {
      const collector: Collector = await (
        await routeCollector({
          routes: { 'page/animated': `${base}/animated` },
          roots: ['#app'],
          network: false,
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
        // One collection outside the timing, because the first pays for the
        // navigation and the sheet insertion and every later one does not —
        // which is exactly the shape a session has, and averaging the first in
        // would report a per-subject cost no subject after it ever pays.
        await collector.collect(PLAN.subjects[0]!);

        const started = Date.now();
        for (let pass = 0; pass < SAMPLES; pass += 1) {
          await collector.collect(PLAN.subjects[0]!);
        }
        arms[label] = (Date.now() - started) / SAMPLES;
      } finally {
        await collector.close();
      }
    }

    const untouched = arms['untouched']!;
    const held = arms['held still']!;

    console.log(
      `\nSTABILIZATION COST — ${SAMPLES} collections of one subject, warm\n` +
        `  untouched    ${untouched.toFixed(1)} ms/subject\n` +
        `  held still   ${held.toFixed(1)} ms/subject\n` +
        `  difference   ${(held - untouched).toFixed(1)} ms/subject\n`,
    );

    // A bound, not an equality. What it exists to catch is the regression that
    // put two animation frames back into every subject: 32ms each, a third of a
    // second on a ten-story Storybook and six on two hundred. The sheet is
    // idempotent, so a warm subject re-applies nothing and waits for no frame.
    expect(held - untouched).toBeLessThan(20);
  }, 120_000);

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

describe.skipIf(!BROWSER_AVAILABLE)('what the default recipe leaves waiting', () => {
  // A throw is as good an answer as a refusal, provided it names the cause. The
  // collector's own bound is what each case pays, and what it is judged on.
  // With the wire on, the URL that never answered names it, before the font
  // trick's own bound would. With it off, the trick names the family and the
  // source its rule asked for; its 15000ms bound is fixed, so that case pays it.
  it.each([
    { wire: 'on', network: undefined, named: [/no answer.*\/stalled\.woff2/, /\/imported\.woff2/] },
    { wire: 'off', network: false as const, named: [/Stalled from url\(.*\/stalled\.woff2/, /Imported from url\(.*\/imported\.woff2/] },
  ])('refuses a route whose web font never answers, naming it, with the wire $wire', async ({ network, named }) => {
    const collector: Collector = await (
      await routeCollector({ routes: { 'page/late-font': `${base}/late-font` }, roots: ['#app'], ...(network === undefined ? {} : { network }) })
    )({
      config: { viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' }, fonts: [] },
      plan: { subjects: [{ subject: { id: 'page/late-font', kind: 'route' } }], notObserved: [], warnings: [] },
    });

    try {
      const outcome = await collector
        .collect({ subject: { id: 'page/late-font', kind: 'route' } })
        .catch((error: unknown) => ({ ok: false, because: String(error) }));

      for (const cause of named) expect(outcome).toMatchObject({ ok: false, because: expect.stringMatching(cause) });
    } finally {
      await collector.close();
    }
  }, 60_000);
});

/**
 * One collection of one route by a collector of its own, so two of them are two
 * page loads at two moments — which is what two runs of a suite are.
 */
async function collectOnce(
  path: string,
  options: { readonly stabilize?: readonly string[]; readonly now?: string } = {},
): Promise<Collected> {
  const collector: Collector = await (
    await routeCollector({
      routes: { 'page/animated': `${base}${path}` },
      roots: ['#app'],
      ready: { 'page/animated': '#app[data-ticked]' },
      ...options,
    })
  )({
    config: {
      viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
      fonts: [],
    },
    plan: PLAN,
  });

  try {
    return await collector.collect(PLAN.subjects[0]!);
  } finally {
    await collector.close();
  }
}

/** What the page printed, read out of the collected document rather than its hash. */
function printed(reading: Collected): string {
  if (!reading.ok) throw new Error(`collection failed: ${reading.because}`);
  return /\d{4}-\d{2}-\d{2}T[\d:.]+Z/.exec(JSON.stringify(reading.document))?.[0] ?? 'nothing';
}

describe.skipIf(!BROWSER_AVAILABLE)('what the default recipe holds still, and what it refuses', () => {
  it('holds still a script animation that honours prefers-reduced-motion', async () => {
    const [first, second] = hashesOf(await collectTwice(undefined, '/motion'));

    expect(first).toBe(second);
  }, 60_000);

  it('reads `@media (prefers-reduced-motion)` as the browser it emulated answers it', async () => {
    const reading = await collectOnce('/preference');
    if (!reading.ok) throw new Error(`collection failed: ${reading.because}`);

    // One owner for the preference: the trick told the browser `reduce`, so the
    // record declares `reduce` and the `no-preference` block is not applied.
    expect(reading.snapshot?.environment.inputs.conditions).toMatchObject({
      'prefers-reduced-motion': 'reduce',
    });
    expect(JSON.stringify(reading.document)).not.toContain('200px');
  }, 60_000);

  it('reads the same date on two runs of a page that prints the wall clock', async () => {
    const first = await collectOnce('/clock');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await collectOnce('/clock');

    expect(printed(first)).toBe('2024-06-15T12:00:00.000Z');
    expect(hashesOf([first])[0]).toBe(hashesOf([second])[0]);
  }, 60_000);

  it('paints the same pixels for the two runs', async () => {
    const renderer = await createPlaywrightRenderer();
    try {
      const [first, second] = [await collectOnce('/clock'), await collectOnce('/clock')];
      if (!first.ok || !second.ok) throw new Error('collection failed');

      const [a, b] = [await renderer.render(first.document), await renderer.render(second.document)];
      expect(a.bytes).toBeDefined();
      expect(a.bytes).toBe(b.bytes);
    } finally {
      await renderer.close();
    }
  }, 60_000);

  it('reads the instant a project chose instead', async () => {
    expect(printed(await collectOnce('/clock', { now: '2031-01-02T03:04:05Z' }))).toBe(
      '2031-01-02T03:04:05.000Z',
    );
  }, 60_000);

  it('reads the real clock when the default list is given without `freeze-clock`', async () => {
    const reading = await collectOnce('/clock', {
      stabilize: DEFAULT_STABILIZE.filter((id) => id !== 'freeze-clock'),
    });

    expect(printed(reading)).not.toBe('2024-06-15T12:00:00.000Z');
    expect(new Date(printed(reading)).getFullYear()).toBeGreaterThan(2024);
  }, 60_000);

  it('refuses an instant with no zone, before a browser opens', async () => {
    const opening = routeCollector({ routes: {}, now: '2031-01-02T03:04' })({
      config: { viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' } },
      plan: PLAN,
    });

    await expect(opening).rejects.toThrow(/`now` must be an ISO 8601 instant/);
  });

  it('reads a field the page focused as it reads with nothing focused', async () => {
    const [focused, unfocused] = [await collectOnce('/focused'), await collectOnce('/unfocused')];

    expect(hashesOf([focused])[0]).toBe(hashesOf([unfocused])[0]);
  }, 60_000);
});

// Column 0, because the describe above is skipped on a machine with no browser
// and a todo inside it would go quiet on exactly the machines running least.
it.todo(
  "a third arm pays the two frames on every subject, so the skip's saving is a measured difference rather than a remembered one — needs a way to defeat the `already` check from outside `stabilizeDocument`, because `stabilize` is fixed when the collector is built and the sheet survives every collection after the first, so no arrangement of the option reaches the unconditional path",
);
